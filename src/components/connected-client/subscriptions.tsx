"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useConnectedClient } from "./context";
import { barberSupportsServices, localToday } from "./format";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import styles from "./connected-client.module.css";

type Row = {
  id: string;
  plan_id: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  first_due_date: string | null;
  payment_method: string;
  contract_body_snapshot: string | null;
  plan: { name: string; description: string | null } | null;
  plan_version: {
    price_cents: number;
    billing_period: string;
    sessions_per_cycle: number;
    scheduling_mode: "FREE" | "FIXED";
  } | null;
};
type Cycle = {
  id: string;
  subscription_id: string;
  cycle_number: number;
  starts_on: string;
  ends_on: string;
  due_on: string;
  amount_cents: number;
  status: string;
  sessions: {
    id: string;
    session_number: number;
    status: string;
    appointment?: { status: string; service_period?: string; cancellation_outcome?: string | null; cancelled_at?: string | null } | null;
  }[];
};

function formatDate(value: string | null) {
  if (!value) return "—";
  const [year, month, day] = value.split("-").map(Number);
  return year && month && day
    ? new Intl.DateTimeFormat("pt-BR").format(new Date(year, month - 1, day))
    : value;
}

function sessionStatusLabel(status: string) {
  return ({ AVAILABLE: "Em aberto", SCHEDULED: "Agendada", COMPLETED: "Concluída", CANCELED: "Cancelada", CONSUMED: "Cancelada" } as Record<string, string>)[status] ?? status;
}

function sessionTone(status: string) {
  return status === "COMPLETED" ? "#2f7a4e" : status === "CANCELED" || status === "CONSUMED" ? "#a84136" : status === "SCHEDULED" ? "#b67816" : "#2872ad";
}

function sessionDate(period?: string) {
  const start = period?.match(/\[(.*?),/)?.[1];
  return start ? new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" }).format(new Date(start)) : "";
}
type AvailablePlan = {
  id: string;
  name: string;
  description: string | null;
  version: {
    id: string;
    version: number;
    price_cents: number;
    billing_period: string;
    duration_months: number;
    sessions_per_cycle: number;
    scheduling_mode: "FREE" | "FIXED";
  } | null;
  service_ids: string[];
};

type FixedScheduleDraft = {
  plan: AvailablePlan;
  cadenceWeeks: string;
  startDate: string;
  localTime: string;
  barberId: string;
};

const paymentMethodLabel: Record<string, string> = {
  CARD: "Cartão de crédito",
  PIX: "PIX",
  BOLETO: "Boleto",
  CASH: "Dinheiro",
  UPFRONT: "À vista",
  ONLINE: "Link de pagamento",
};

export function ConnectedSubscriptions() {
  const { context, customer, user } = useConnectedClient();
  const [rows, setRows] = useState<Row[]>([]);
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [plans, setPlans] = useState<AvailablePlan[]>([]);
  const [contractBody, setContractBody] = useState<string | null>(null);
  const [fixedScheduleDraft, setFixedScheduleDraft] = useState<FixedScheduleDraft | null>(null);
  const [message, setMessage] = useState("Carregando assinaturas…");
  useEffect(() => {
    const client = getSupabaseBrowserClient();
    if (!client || !context || !customer || !user) {
      queueMicrotask(() =>
        setMessage("Entre na sua conta para consultar assinaturas."),
      );
      return;
    }
    void Promise.all([
      client
        .from("customer_subscriptions")
        .select(
          "id,plan_id,status,start_date,end_date,first_due_date,payment_method,contract_body_snapshot,plan:subscription_plans(name,description),plan_version:subscription_plan_versions(price_cents,billing_period,sessions_per_cycle,scheduling_mode)",
        )
        .eq("organization_id", context.organization.id)
        .eq("customer_id", customer.id)
        .in("status", ["REQUESTED", "PENDING_PAYMENT", "ACTIVE"]),
      client
        .from("subscription_plans")
        .select(
          "id,name,description,version:subscription_plan_versions(id,version,price_cents,billing_period,duration_months,sessions_per_cycle,scheduling_mode)",
        )
        .eq("organization_id", context.organization.id)
        .eq("active", true),
    ]).then(async ([subscriptionsResult, plansResult]) => {
      const { data, error } = subscriptionsResult;
      if (error) {
        setMessage(error.message);
        return;
      }
      const subscriptions = (data ?? []) as unknown as Row[];
      setRows(subscriptions);
      const normalizedPlans = ((plansResult.data ?? []) as unknown as AvailablePlan[]).map((plan) => {
        const versions = Array.isArray(plan.version) ? plan.version : plan.version ? [plan.version] : [];
        return {
          ...plan,
          version: versions.sort((left, right) => right.version - left.version)[0] ?? null,
        };
      });
      const planVersionIds = normalizedPlans.map((plan) => plan.version?.id).filter((id): id is string => Boolean(id));
      if (planVersionIds.length) {
        const { data: serviceRows } = await client
          .from("subscription_plan_services")
          .select("plan_version_id,service_id")
          .eq("organization_id", context.organization.id)
          .in("plan_version_id", planVersionIds);
        setPlans(normalizedPlans.map((plan) => ({
          ...plan,
          service_ids: (serviceRows ?? [])
            .filter((row) => row.plan_version_id === plan.version?.id)
            .map((row) => row.service_id),
        })));
      } else {
        setPlans(normalizedPlans.map((plan) => ({ ...plan, service_ids: [] })));
      }
      const contract = await client
        .from("subscription_contract_versions")
        .select("body")
        .eq("active", true)
        .maybeSingle();
      if (!contract.error) setContractBody(contract.data?.body ?? null);
      setMessage(
        subscriptions.length ? "" : "Você ainda não possui assinaturas ativas.",
      );
      if (!subscriptions.length) return;
      const { data: cycleRows, error: cycleError } = await client
        .from("customer_subscription_cycles")
        .select("id,subscription_id,cycle_number,starts_on,ends_on,due_on,amount_cents,status")
        .eq("organization_id", context.organization.id)
        .in(
          "subscription_id",
          subscriptions.map((item) => item.id),
        )
        .order("cycle_number");
      if (cycleError) {
        setMessage(cycleError.message);
        return;
      }
      const normalizedCycles = (cycleRows ?? []) as unknown as Omit<Cycle, "sessions">[];
      const { data: sessionRows, error: sessionError } = await client
        .from("customer_subscription_sessions")
        .select("id,subscription_id,cycle_id,session_number,status,appointment_id")
        .eq("organization_id", context.organization.id)
        .in("subscription_id", subscriptions.map((item) => item.id))
        .order("session_number");
      if (sessionError) {
        setMessage(sessionError.message);
        return;
      }
      const appointmentIds = (sessionRows ?? []).map((session) => session.appointment_id).filter(Boolean) as string[];
      const appointmentResult = appointmentIds.length
        ? await client.from("appointments").select("id,status,service_period,cancellation_outcome,cancelled_at").in("id", appointmentIds)
        : { data: [] as Array<{ id: string; status: string; service_period?: string }> };
      setCycles(normalizedCycles.map((cycle) => ({
        ...cycle,
        sessions: (sessionRows ?? []).filter((session) => session.cycle_id === cycle.id).map((session) => ({
          id: session.id,
          session_number: session.session_number,
          status: session.status,
          appointment: session.appointment_id ? (appointmentResult.data ?? []).find((appointment) => appointment.id === session.appointment_id) ?? { status: "CONFIRMED" } : null,
        })),
      })));
    });
  }, [context, customer, user]);
  async function requestPlan(plan: AvailablePlan) {
    if (plan.version?.scheduling_mode === "FIXED") {
      const eligibleBarbers = context?.barbers.filter((barber) => barberSupportsServices(plan.service_ids, barber.service_ids)
        && (barber.subscription_plan_ids === undefined || barber.subscription_plan_ids.includes(plan.id))) ?? [];
      if (!context || eligibleBarbers.length === 0) {
        setMessage("Nenhum profissional está habilitado para todos os serviços deste plano.");
        return;
      }
      setFixedScheduleDraft({
        plan,
        cadenceWeeks: "1",
        startDate: localToday(context.organization.timezone),
        localTime: "09:00",
        barberId: eligibleBarbers[0].id,
      });
      return;
    }
    if (
      !context ||
      !customer ||
      !plan.version ||
      !window.confirm(
        `Aceitar o contrato padrão e solicitar o plano ${plan.name}? A ativação ocorrerá após aprovação do gestor e primeiro pagamento.`,
      )
    )
      return;
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const { error } = await client.rpc("request_customer_subscription", {
      p_organization_id: context.organization.id,
      p_customer_id: customer.id,
      p_plan_id: plan.id,
      p_acceptance_source: "CLIENT",
      p_accept_contract: true,
    });
    const friendlyError = error?.message?.match(/subscription module disabled/i)
      ? "Planos de Assinatura está inativo nesta barbearia."
      : error?.code === "23505" || error?.message?.match(/already has|unique constraint/i)
        ? "Você já possui uma assinatura ativa nesta barbearia."
        : error?.message;
    setMessage(
      friendlyError
        ? friendlyError
        : "Solicitação enviada. Aguarde aprovação da barbearia.",
    );
  }
  async function requestFixedPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!context || !customer || !fixedScheduleDraft) return;
    const draft = fixedScheduleDraft;
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const { error } = await client.rpc("request_customer_fixed_subscription", {
      p_organization_id: context.organization.id,
      p_customer_id: customer.id,
      p_plan_id: draft.plan.id,
      p_cadence_weeks: Number(draft.cadenceWeeks),
      p_start_date: draft.startDate,
      p_local_time: draft.localTime,
      p_barber_id: draft.barberId,
      p_acceptance_source: "CLIENT",
      p_accept_contract: true,
    });
    const message = error?.message.match(/fixed_schedule_conflict|barber|availability/i)
      ? "Não há disponibilidade para esta série. Escolha outra data, hora ou profissional."
      : error?.code === "23505" || error?.message.match(/already has|unique constraint/i)
        ? "Você já possui uma assinatura ativa nesta barbearia."
        : error?.message;
    setMessage(message ?? "Solicitação enviada. Aguarde aprovação da barbearia.");
    if (!error) {
      setFixedScheduleDraft(null);
      window.location.reload();
    }
  }
  async function cancelSubscription(subscriptionId: string) {
    if (
      !context ||
      !window.confirm(
        "Cancelar no fim do ciclo pago? Parcelas futuras serão canceladas; eventual reembolso proporcional será tratado manualmente.",
      )
    )
      return;
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const { error } = await client.rpc("cancel_customer_subscription", {
      p_organization_id: context.organization.id,
      p_subscription_id: subscriptionId,
      p_reason: "Cancelada pelo cliente",
    });
    setMessage(
      error ? error.message : "Cancelamento registrado no fim do ciclo pago.",
    );
    if (!error)
      setRows((current) =>
        current.filter((item) => item.id !== subscriptionId),
      );
  }
  async function cancelSession(sessionId: string) {
    if (
      !context ||
      !customer ||
      !window.confirm(
        "Cancelar esta sessão? A política do plano será aplicada e você receberá um aviso sobre o resultado.",
      )
    )
      return;
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const { error } = await client.rpc("cancel_customer_subscription_session", {
      p_organization_id: context.organization.id,
      p_customer_id: customer.id,
      p_subscription_session_id: sessionId,
      p_reason: "Cancelada pelo cliente",
    });
    setMessage(
      error
        ? error.message
        : "Cancelamento de sessão registrado. A política do plano foi aplicada.",
    );
    if (!error) window.location.reload();
  }
  return (
    <section className={styles.subscriptionStack}>
      <header>
        <h1>Minhas Assinaturas</h1>
        <p>Planos ativos, parcelas e sessões disponíveis.</p>
      </header>
      {message && <p>{message}</p>}
      {rows.map((row) => (
        <article className={styles.subscriptionCard} key={row.id}>
          <h2>{row.plan?.name ?? "Plano"}</h2>
          <p>{row.plan?.description ?? "Sem descrição"}</p>
          <strong>
            {row.plan_version
              ? new Intl.NumberFormat("pt-BR", {
                  style: "currency",
                  currency: "BRL",
                }).format(row.plan_version.price_cents / 100)
              : "—"}
          </strong>
          <small className={styles.subscriptionMeta}>
            {row.plan_version?.billing_period === "BIWEEKLY"
              ? "Quinzenal"
              : "Mensal"}{" "}
            · venc. {formatDate(row.first_due_date)} · pagamento:{" "}
            {paymentMethodLabel[row.payment_method] ?? row.payment_method} · {row.status}
          </small>
          <div>
            {cycles
              .filter((cycle) => cycle.subscription_id === row.id)
              .map((cycle) => (
                <div className={styles.subscriptionCycle} key={cycle.id}>
                  <p className={styles.subscriptionCycleHeader}>
                    <strong>Ciclo {cycle.cycle_number}</strong> · venc.{" "}
                    {formatDate(cycle.due_on)} · {cycle.status} ·{" "}
                    {
                      cycle.sessions.filter(
                        (session) => session.status === "AVAILABLE",
                      ).length
                    }{" "}
                    abertas ·{" "}
                    {
                      cycle.sessions.filter(
                        (session) => session.status === "SCHEDULED",
                      ).length
                    }{" "}
                    agendadas ·{" "}
                    {
                      cycle.sessions.filter(
                        (session) => session.appointment?.status === "COMPLETED",
                      ).length
                    }{" "}
                    concluídas
                  </p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: ".5rem" }}>
                    {cycle.sessions.map((session) => {
                      const date = sessionDate(session.appointment?.service_period);
                      const title = `${session.session_number} de ${cycle.sessions.length}${date ? ` | ${date}` : ""}`;
                      const tone = sessionTone(session.status);
                      if (session.status === "AVAILABLE") {
                        return (
                          <Link
                            key={session.id}
                            className={styles.subscriptionAction}
                            href={`/cliente/agendar?subscriptionSession=${encodeURIComponent(session.id)}`}
                            style={{ color: tone, borderColor: `${tone}66`, background: `${tone}14` }}
                            aria-label={sessionStatusLabel(session.status)}
                          >
                            {title}
                          </Link>
                        );
                      }
                      if (session.status === "SCHEDULED") {
                        return (
                          <button
                            key={session.id}
                            type="button"
                            className={styles.subscriptionSecondary}
                            onClick={() => void cancelSession(session.id)}
                            style={{ color: tone, borderColor: `${tone}66`, background: `${tone}14` }}
                            aria-label={sessionStatusLabel(session.status)}
                          >
                            {title}
                          </button>
                        );
                      }
                      return (
                        <span
                          key={session.id}
                          style={{ display: "inline-flex", alignItems: "center", border: `1px solid ${tone}66`, borderRadius: "999px", padding: ".55rem .75rem", color: tone, background: `${tone}14`, fontWeight: 700 }}
                          aria-label={sessionStatusLabel(session.status)}
                        >
                          {title}
                        </span>
                      );
                    })}
                  </div>
                  {cycle.status === "PAID" && cycle.sessions.every((session) => session.status !== "AVAILABLE") && <small className={styles.subscriptionHint}>Todas as sessões deste ciclo já foram utilizadas ou agendadas.</small>}
                </div>
              ))}
          </div>
          {contractBody && (
            <button className={styles.subscriptionSecondary} type="button" onClick={() => window.alert(row.contract_body_snapshot ?? contractBody)}>
              Acessar contrato
            </button>
          )}
          {row.status === "ACTIVE" && (
            <button className={styles.subscriptionSecondary}
              type="button"
              onClick={() => void cancelSubscription(row.id)}
            >
              Cancelar assinatura
            </button>
          )}
        </article>
      ))}
      {user && plans.length > 0 && (
        <div>
          <h2>Assinar novo plano</h2>
          {plans.map((plan) => (
            <article className={styles.subscriptionCard} key={plan.id}>
              <h3>{plan.name}</h3>
              <p>{plan.description ?? "Sem descrição"}</p>
              <small>
                {plan.version?.billing_period === "BIWEEKLY"
                  ? "Quinzenal"
                  : "Mensal"}{" "}
                · {plan.version?.sessions_per_cycle ?? 0} sessões por ciclo ·{" "}
                {plan.version
                  ? new Intl.NumberFormat("pt-BR", {
                      style: "currency",
                      currency: "BRL",
                    }).format(plan.version.price_cents / 100)
                : "—"}
                {plan.version?.scheduling_mode === "FIXED" ? " · Agendamento fixo" : " · Agendamento livre"}
              </small>
              <button className={styles.subscriptionAction} type="button" onClick={() => void requestPlan(plan)}>
                Solicitar plano
              </button>
            </article>
          ))}
        </div>
      )}
      {fixedScheduleDraft && context && (() => {
        const eligibleBarbers = context.barbers.filter((barber) => barberSupportsServices(fixedScheduleDraft.plan.service_ids, barber.service_ids)
          && (barber.subscription_plan_ids === undefined || barber.subscription_plan_ids.includes(fixedScheduleDraft.plan.id)));
        return <div className={styles.modalLayer} role="presentation">
          <button className={styles.backdrop} type="button" aria-label="Fechar escolha de agenda fixa" onClick={() => setFixedScheduleDraft(null)} />
          <form className={`${styles.modal} ${styles.modalWide}`} role="dialog" aria-modal="true" aria-labelledby="fixed-subscription-title" onSubmit={(event) => void requestFixedPlan(event)}>
            <h2 id="fixed-subscription-title">Agendamento fixo</h2>
            <p>Escolha a recorrência, a primeira data, o horário e o profissional. Após a aprovação e o primeiro pagamento, as sessões do plano serão agendadas automaticamente. Datas bloqueadas deslocam esta e as sessões seguintes.</p>
            <label>Frequência<select required value={fixedScheduleDraft.cadenceWeeks} onChange={(event) => setFixedScheduleDraft((draft) => draft ? { ...draft, cadenceWeeks: event.target.value } : draft)}><option value="1">Semanal</option><option value="2">Quinzenal (a cada 2 semanas)</option></select></label>
            <label>Data inicial<input required type="date" min={localToday(context.organization.timezone)} value={fixedScheduleDraft.startDate} onChange={(event) => setFixedScheduleDraft((draft) => draft ? { ...draft, startDate: event.target.value } : draft)} /></label>
            <label>Horário<input required type="time" step={900} value={fixedScheduleDraft.localTime} onChange={(event) => setFixedScheduleDraft((draft) => draft ? { ...draft, localTime: event.target.value } : draft)} /></label>
            <label>Profissional<select required value={fixedScheduleDraft.barberId} onChange={(event) => setFixedScheduleDraft((draft) => draft ? { ...draft, barberId: event.target.value } : draft)}><option value="">Selecione</option>{eligibleBarbers.map((barber) => <option key={barber.id} value={barber.id}>{barber.name}</option>)}</select></label>
            <footer><button type="button" className={styles.subscriptionSecondary} onClick={() => setFixedScheduleDraft(null)}>Cancelar</button><button type="submit" className={styles.subscriptionAction}>Solicitar plano</button></footer>
          </form>
        </div>;
      })()}
    </section>
  );
}

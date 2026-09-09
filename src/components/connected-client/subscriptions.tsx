"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useConnectedClient } from "./context";
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
    appointment?: { status: string } | null;
  }[];
};

function formatDate(value: string | null) {
  if (!value) return "—";
  const [year, month, day] = value.split("-").map(Number);
  return year && month && day
    ? new Intl.DateTimeFormat("pt-BR").format(new Date(year, month - 1, day))
    : value;
}
type AvailablePlan = {
  id: string;
  name: string;
  description: string | null;
  version: {
    id: string;
    price_cents: number;
    billing_period: string;
    duration_months: number;
    sessions_per_cycle: number;
  } | null;
};

const paymentMethodLabel: Record<string, string> = {
  CARD: "Cartão de crédito",
  PIX: "PIX",
  BOLETO: "Boleto",
  CASH: "Dinheiro",
  UPFRONT: "À vista",
  ONLINE: "Online",
};

export function ConnectedSubscriptions() {
  const { context, customer, user } = useConnectedClient();
  const [rows, setRows] = useState<Row[]>([]);
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [plans, setPlans] = useState<AvailablePlan[]>([]);
  const [contractBody, setContractBody] = useState<string | null>(null);
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
          "id,plan_id,status,start_date,end_date,first_due_date,payment_method,contract_body_snapshot,plan:subscription_plans(name,description),plan_version:subscription_plan_versions(price_cents,billing_period,sessions_per_cycle)",
        )
        .eq("organization_id", context.organization.id)
        .eq("customer_id", customer.id)
        .in("status", ["REQUESTED", "PENDING_PAYMENT", "ACTIVE"]),
      client
        .from("subscription_plans")
        .select(
          "id,name,description,version:subscription_plan_versions(id,price_cents,billing_period,duration_months,sessions_per_cycle)",
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
      setPlans(
        ((plansResult.data ?? []) as unknown as AvailablePlan[]).map(
          (plan) => ({
            ...plan,
            version: Array.isArray(plan.version)
              ? (plan.version[0] ?? null)
              : plan.version,
          }),
        ),
      );
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
        ? await client.from("appointments").select("id,status").in("id", appointmentIds)
        : { data: [] as Array<{ id: string; status: string }> };
      const appointmentStatus = new Map((appointmentResult.data ?? []).map((appointment) => [appointment.id, appointment.status]));
      setCycles(normalizedCycles.map((cycle) => ({
        ...cycle,
        sessions: (sessionRows ?? []).filter((session) => session.cycle_id === cycle.id).map((session) => ({
          id: session.id,
          session_number: session.session_number,
          status: session.status,
          appointment: session.appointment_id ? { status: appointmentStatus.get(session.appointment_id) ?? "CONFIRMED" } : null,
        })),
      })));
    });
  }, [context, customer, user]);
  async function requestPlan(plan: AvailablePlan) {
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
    setMessage(
      error
        ? error.message
        : "Solicitação enviada. Aguarde aprovação da barbearia.",
    );
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
                  {cycle.sessions
                    .filter((session) => session.status === "AVAILABLE")
                    .map((session) => (
                      <span
                        key={session.id}
                        style={{
                          display: "inline-flex",
                          gap: ".5rem",
                          marginRight: ".75rem",
                        }}
                      >
                        <Link className={styles.subscriptionAction}
                          href={`/cliente/agendar?subscriptionSession=${encodeURIComponent(session.id)}`}
                        >
                          Agendar sessão {session.session_number}
                        </Link>
                      </span>
                    ))}
                  {cycle.sessions
                    .filter((session) => session.status === "SCHEDULED")
                    .map((session) => (
                      <button
                        key={session.id}
                        type="button"
                        className={styles.subscriptionSecondary}
                        onClick={() => void cancelSession(session.id)}
                      >
                        Cancelar sessão {session.session_number}
                      </button>
                    ))}
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
              </small>
              <button className={styles.subscriptionAction} type="button" onClick={() => void requestPlan(plan)}>
                Solicitar plano
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

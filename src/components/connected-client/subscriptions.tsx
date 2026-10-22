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
  contract_accepted_at: string | null;
  start_date: string | null;
  end_date: string | null;
  first_due_date: string | null;
  payment_method: string;
  created_by: string | null;
  contract_body_snapshot: string | null;
  plan: { name: string; description: string | null } | null;
  plan_version: {
    price_cents: number;
    billing_period: string;
    sessions_per_cycle: number;
    scheduling_mode: "FREE" | "FIXED";
    duration_months: number;
    cancellation_policy: string;
    session_cancellation_policy: string;
    payment_method: string;
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
    payment_method: string;
    cancellation_policy: string;
    session_cancellation_policy: string;
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
type ProjectOffer = { id: string; project_id: string; package_id: string; status: string; contracted_cents: number; created_by: string; project: { name: string; description: string | null } | null; package: { name: string; description: string | null; sessions_count: number } | null };
type PublicProject = { id: string; name: string; description: string | null; starts_on: string | null; sales_close_on: string | null; ends_on: string | null; package: { id: string; name: string; description: string | null; price_cents: number; sessions_count: number }[] };
type SubscriptionView = "home" | "my-plans" | "my-plan" | "new-plan" | "subscription" | "project" | "subscription-offer" | "project-offer";

const paymentMethodLabel: Record<string, string> = {
  CARD: "Cartão de crédito",
  PIX: "PIX",
  BOLETO: "Boleto",
  CASH: "Dinheiro",
  UPFRONT: "À vista",
  ONLINE: "Link de pagamento",
};

export function ConnectedSubscriptions({ view = "home", itemId }: { view?: SubscriptionView; itemId?: string }) {
  const { context, customer, user } = useConnectedClient();
  const [rows, setRows] = useState<Row[]>([]);
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [plans, setPlans] = useState<AvailablePlan[]>([]);
  const [projectOffers, setProjectOffers] = useState<ProjectOffer[]>([]);
  const [publicProjects, setPublicProjects] = useState<PublicProject[]>([]);
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
          "id,plan_id,status,contract_accepted_at,start_date,end_date,first_due_date,payment_method,contract_body_snapshot,created_by,plan:subscription_plans(name,description),plan_version:subscription_plan_versions(price_cents,billing_period,sessions_per_cycle,scheduling_mode,duration_months,cancellation_policy,session_cancellation_policy,payment_method)",
        )
        .eq("organization_id", context.organization.id)
        .eq("customer_id", customer.id)
        .in("status", ["REQUESTED", "PENDING_PAYMENT", "ACTIVE", "DECLINED"]),
      client
        .from("subscription_plans")
        .select(
          "id,name,description,version:subscription_plan_versions(id,version,price_cents,billing_period,duration_months,sessions_per_cycle,scheduling_mode,payment_method,cancellation_policy,session_cancellation_policy)",
        )
        .eq("organization_id", context.organization.id)
        .eq("active", true),
      client.from("project_engagements").select("id,project_id,package_id,status,contracted_cents,created_by,project:projects(name,description),package:project_packages(name,description,sessions_count)")
        .eq("organization_id", context.organization.id).eq("customer_id", customer.id).in("status", ["PROPOSAL", "ACTIVE", "DECLINED"]),
      client.from("projects").select("id,name,description,starts_on,sales_close_on,ends_on,package:project_packages(id,name,description,price_cents,sessions_count)")
        .eq("organization_id", context.organization.id).eq("status", "PUBLISHED"),
    ]).then(async ([subscriptionsResult, plansResult, projectResult, publicProjectResult]) => {
      const { data, error } = subscriptionsResult;
      if (error) {
        setMessage(error.message);
        return;
      }
      const subscriptions = (data ?? []) as unknown as Row[];
      setRows(subscriptions);
      setProjectOffers((projectResult.data ?? []) as unknown as ProjectOffer[]);
      setPublicProjects(((publicProjectResult.data ?? []) as unknown as PublicProject[]).map((project) => ({ ...project, package: Array.isArray(project.package) ? project.package : project.package ? [project.package] : [] })));
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
      setMessage("");
      if (!subscriptions.some((item) => item.status !== "DECLINED")) return;
      const { data: cycleRows, error: cycleError } = await client
        .from("customer_subscription_cycles")
        .select("id,subscription_id,cycle_number,starts_on,ends_on,due_on,amount_cents,status")
        .eq("organization_id", context.organization.id)
        .in(
          "subscription_id",
          subscriptions.filter((item) => item.status !== "DECLINED").map((item) => item.id),
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
        .in("subscription_id", subscriptions.filter((item) => item.status !== "DECLINED").map((item) => item.id))
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
  async function acceptSubscriptionOffer(id: string) {
    if (!context) return;
    const client = getSupabaseBrowserClient(); if (!client) return;
    const { error } = await client.rpc("accept_customer_subscription_offer", { p_organization_id: context.organization.id, p_subscription_id: id });
    setMessage(error ? error.message : "Plano aceito. Aguarde a aprovação do gestor.");
    if (!error) window.location.assign(route("/cliente/assinaturas/meus-planos"));
  }
  async function acceptProjectOffer(offer: ProjectOffer) {
    if (!context) return;
    if (!window.confirm(`Confirmar o plano ${offer.project?.name ?? "oferecido"} · ${offer.package?.name ?? "pacote"}?`)) return;
    const client = getSupabaseBrowserClient(); if (!client) return;
    const { error } = await client.rpc("accept_customer_project_engagement", { p_organization_id: context.organization.id, p_engagement_id: offer.id });
    setMessage(error ? error.message : "Plano confirmado.");
    if (!error) window.location.assign(route("/cliente/assinaturas/meus-planos"));
  }
  async function declineSubscriptionOffer(id: string) {
    if (!context || !window.confirm("Recusar este plano? Ele será arquivado como recusado e o gestor será avisado.")) return;
    const client = getSupabaseBrowserClient(); if (!client) return;
    const { error } = await client.rpc("decline_customer_subscription_offer", { p_organization_id: context.organization.id, p_subscription_id: id });
    setMessage(error ? error.message : "Plano recusado e arquivado.");
    if (!error) window.location.assign(route("/cliente/assinaturas/meus-planos"));
  }
  async function declineProjectOffer(offer: ProjectOffer) {
    if (!context || !window.confirm("Recusar este plano? Ele será arquivado como recusado e o gestor será avisado.")) return;
    const client = getSupabaseBrowserClient(); if (!client) return;
    const { error } = await client.rpc("decline_customer_project_engagement", { p_organization_id: context.organization.id, p_engagement_id: offer.id });
    setMessage(error ? error.message : "Plano recusado e arquivado.");
    if (!error) window.location.assign(route("/cliente/assinaturas/meus-planos"));
  }
  async function requestProject(projectId: string, packageId: string, projectName: string, packageName: string) {
    if (!context || !window.confirm(`Solicitar o pacote ${packageName} do plano ${projectName}?`)) return;
    const client = getSupabaseBrowserClient(); if (!client) return;
    const { error } = await client.rpc("request_customer_project_engagement", { p_organization_id: context.organization.id, p_project_id: projectId, p_package_id: packageId });
    setMessage(error ? error.message : "Solicitação enviada. Aguarde contato do gestor.");
    if (!error) window.location.assign(route("/cliente/assinaturas/meus-planos"));
  }
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
    if (!friendlyError) window.location.assign(route("/cliente/assinaturas/meus-planos"));
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
      window.location.assign(route("/cliente/assinaturas/meus-planos"));
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
  const route = (path: string) => `${path}${context?.organization.slug ? `?barbearia=${encodeURIComponent(context.organization.slug)}` : ""}`;
  const money = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
  const subscriptionStatusLabel: Record<string, string> = { REQUESTED: "Aguardando aprovação", PENDING_PAYMENT: "Aguardando pagamento", ACTIVE: "Ativa", CANCELED: "Cancelada", EXPIRED: "Encerrada", DECLINED: "Recusada" };
  const dateRange = (start: string | null, end: string | null) => start || end ? `${start ? formatDate(start) : "—"} a ${end ? formatDate(end) : "—"}` : null;
  const requestedOffers = rows.filter((row) => row.status === "REQUESTED" && !row.contract_accepted_at && row.created_by !== user?.id);
  const pendingProjectOffers = projectOffers.filter((offer) => offer.status === "PROPOSAL" && offer.created_by !== user?.id);
  const selectedPlan = plans.find((plan) => plan.id === itemId);
  const selectedProject = publicProjects.find((project) => project.id === itemId);
  const selectedSubscriptionOffer = requestedOffers.find((row) => row.id === itemId);
  const selectedProjectOffer = pendingProjectOffers.find((offer) => offer.id === itemId);
  const selectedCustomerSubscription = rows.find((row) => row.id === itemId && row.status !== "DECLINED");

  if (view === "home") return <section className={styles.subscriptionStack}>
    <header><h1>Assinaturas</h1><p>Consulte seus planos e encontre novas opções deste estabelecimento.</p></header>
    {message && <p>{message}</p>}
    {(requestedOffers.length > 0 || pendingProjectOffers.length > 0) && <div className={styles.subscriptionStack}>
      <h2>Planos aguardando sua decisão</h2>
      {requestedOffers.map((row) => <Link className={styles.subscriptionCard} key={row.id} href={route(`/cliente/assinaturas/ofertas/assinatura/${row.id}`)}>
        <span className={styles.planStatus}>Aguardando aceite</span><h3>{row.plan?.name ?? "Plano"}</h3><p>O gestor enviou este plano para você aceitar.</p>
        {row.plan_version && <strong>{money(row.plan_version.price_cents)}</strong>}
        <span>Ver detalhes e decidir</span>
      </Link>)}
      {pendingProjectOffers.map((offer) => <Link className={styles.subscriptionCard} key={offer.id} href={route(`/cliente/assinaturas/ofertas/projeto/${offer.id}`)}>
        <span className={styles.planStatus}>Aguardando aceite</span><h3>{offer.project?.name ?? "Plano"} · {offer.package?.name ?? "Pacote"}</h3>
        <p>O gestor enviou este plano para você aceitar.</p><strong>{money(offer.contracted_cents)}</strong><span>Ver detalhes e decidir</span>
      </Link>)}
    </div>}
    <nav className={styles.planMenu} aria-label="Planos">
      <Link href={route("/cliente/assinaturas/meus-planos")}><strong>Meus Planos</strong><span>Assinaturas, projetos e histórico</span></Link>
      <Link href={route("/cliente/assinaturas/novo-plano")}><strong>Novo Plano</strong><span>Conheça as opções disponíveis</span></Link>
    </nav>
  </section>;

  if (view === "new-plan") return <section className={styles.subscriptionStack}>
    <header><Link href={route("/cliente/assinaturas")} className={styles.subscriptionBack}>← Assinaturas</Link><h1>Novo Plano</h1><p>Escolha um plano para conhecer os detalhes e solicitar.</p></header>
    {message && <p>{message}</p>}
    {!user && <p>Entre na sua conta para consultar e solicitar planos.</p>}
    {user && plans.map((plan) => <Link className={styles.subscriptionCard} key={plan.id} href={route(`/cliente/assinaturas/novo-plano/assinatura/${plan.id}`)}>
      <span className={styles.planKind}>Plano</span><h2>{plan.name}</h2><p>{plan.description ?? "Consulte os detalhes deste plano."}</p>
      <strong>{plan.version ? money(plan.version.price_cents) : "Valor sob consulta"}</strong><span>Ver detalhes</span>
    </Link>)}
    {user && publicProjects.filter((project) => project.package.length > 0).map((project) => {
      const prices = project.package.map((pkg) => pkg.price_cents);
      const range = Math.min(...prices) === Math.max(...prices) ? money(prices[0]) : `${money(Math.min(...prices))} a ${money(Math.max(...prices))}`;
      return <Link className={styles.subscriptionCard} key={project.id} href={route(`/cliente/assinaturas/novo-plano/projeto/${project.id}`)}>
        <span className={styles.planKind}>Plano</span><h2>{project.name}</h2><p>{project.description ?? "Plano com opções de pacote."}</p><strong>{range}</strong><small>{project.package.length} opção(ões) de pacote</small><span>Ver detalhes e pacotes</span>
      </Link>;
    })}
    {user && plans.length === 0 && !publicProjects.some((project) => project.package.length) && <p>Nenhum plano disponível neste estabelecimento no momento.</p>}
  </section>;

  if (view === "subscription" && selectedPlan) return <section className={styles.subscriptionStack}>
    <header><Link href={route("/cliente/assinaturas/novo-plano")} className={styles.subscriptionBack}>← Novo Plano</Link><span className={styles.planKind}>Plano</span><h1>{selectedPlan.name}</h1><p>{selectedPlan.description ?? "Sem descrição cadastrada."}</p></header>
    <article className={styles.subscriptionCard}>
      <h2>Detalhes do plano</h2><strong>{selectedPlan.version ? money(selectedPlan.version.price_cents) : "Valor sob consulta"}</strong>
      {selectedPlan.version && <p>{selectedPlan.version.billing_period === "BIWEEKLY" ? "Quinzenal" : "Mensal"} · {selectedPlan.version.duration_months} mês(es) · {selectedPlan.version.sessions_per_cycle} sessão(ões) por ciclo · {selectedPlan.version.scheduling_mode === "FIXED" ? "Agendamento fixo" : "Agendamento livre"} · pagamento: {paymentMethodLabel[selectedPlan.version.payment_method] ?? selectedPlan.version.payment_method}</p>}
      {selectedPlan.service_ids.length > 0 && <div><h3>Serviços incluídos</h3><ul>{selectedPlan.service_ids.map((id) => <li key={id}>{context?.services.find((service) => service.id === id)?.name ?? "Serviço incluído"}</li>)}</ul></div>}
      {selectedPlan.version?.cancellation_policy && <details><summary>Política do plano</summary><p>{selectedPlan.version.cancellation_policy}</p>{selectedPlan.version.session_cancellation_policy && <p>{selectedPlan.version.session_cancellation_policy}</p>}</details>}
      {contractBody && <details><summary>Contrato padrão</summary><p>{contractBody}</p></details>}
      <button className={styles.subscriptionAction} type="button" onClick={() => void requestPlan(selectedPlan)}>Solicitar plano</button>
    </article>
    {fixedScheduleDraft && <p role="status">Complete a escolha de agenda na janela aberta.</p>}
    {fixedScheduleDraft && context && (() => {
      const eligibleBarbers = context.barbers.filter((barber) => barberSupportsServices(fixedScheduleDraft.plan.service_ids, barber.service_ids)
        && (barber.subscription_plan_ids === undefined || barber.subscription_plan_ids.includes(fixedScheduleDraft.plan.id)));
      return <div className={styles.modalLayer} role="presentation">
        <button className={styles.backdrop} type="button" aria-label="Fechar escolha de agenda fixa" onClick={() => setFixedScheduleDraft(null)} />
        <form className={`${styles.modal} ${styles.modalWide}`} role="dialog" aria-modal="true" aria-labelledby="fixed-subscription-title" onSubmit={(event) => void requestFixedPlan(event)}>
          <h2 id="fixed-subscription-title">Agendamento fixo</h2><p>Escolha a recorrência, a primeira data, o horário e o profissional.</p>
          <label>Frequência<select required value={fixedScheduleDraft.cadenceWeeks} onChange={(event) => setFixedScheduleDraft((draft) => draft ? { ...draft, cadenceWeeks: event.target.value } : draft)}><option value="1">Semanal</option><option value="2">Quinzenal (a cada 2 semanas)</option></select></label>
          <label>Data inicial<input required type="date" min={localToday(context.organization.timezone)} value={fixedScheduleDraft.startDate} onChange={(event) => setFixedScheduleDraft((draft) => draft ? { ...draft, startDate: event.target.value } : draft)} /></label>
          <label>Horário<input required type="time" step={900} value={fixedScheduleDraft.localTime} onChange={(event) => setFixedScheduleDraft((draft) => draft ? { ...draft, localTime: event.target.value } : draft)} /></label>
          <label>Profissional<select required value={fixedScheduleDraft.barberId} onChange={(event) => setFixedScheduleDraft((draft) => draft ? { ...draft, barberId: event.target.value } : draft)}><option value="">Selecione</option>{eligibleBarbers.map((barber) => <option key={barber.id} value={barber.id}>{barber.name}</option>)}</select></label>
          <footer><button type="button" className={styles.subscriptionSecondary} onClick={() => setFixedScheduleDraft(null)}>Cancelar</button><button type="submit" className={styles.subscriptionAction}>Solicitar plano</button></footer>
        </form>
      </div>;
    })()}
  </section>;

  if (view === "project" && selectedProject) return <section className={styles.subscriptionStack}>
    <header><Link href={route("/cliente/assinaturas/novo-plano")} className={styles.subscriptionBack}>← Novo Plano</Link><span className={styles.planKind}>Plano</span><h1>{selectedProject.name}</h1><p>{selectedProject.description ?? "Consulte os pacotes disponíveis para este plano."}</p>{dateRange(selectedProject.starts_on, selectedProject.ends_on) && <small>Período: {dateRange(selectedProject.starts_on, selectedProject.ends_on)}{selectedProject.sales_close_on ? ` · Solicitações até ${formatDate(selectedProject.sales_close_on)}` : ""}</small>}</header>
    <h2>Escolha uma opção</h2>
    {selectedProject.package.map((pkg) => <article className={styles.subscriptionCard} key={pkg.id}><h3>{pkg.name}</h3><p>{pkg.description ?? selectedProject.description ?? "Detalhes do pacote."}</p><small>{pkg.sessions_count} sessão(ões)</small><strong>{money(pkg.price_cents)}</strong><button className={styles.subscriptionAction} type="button" onClick={() => void requestProject(selectedProject.id, pkg.id, selectedProject.name, pkg.name)}>Solicitar plano</button></article>)}
  </section>;

  if (view === "subscription-offer" && selectedSubscriptionOffer) return <section className={styles.subscriptionStack}>
    <header><Link href={route("/cliente/assinaturas")} className={styles.subscriptionBack}>← Assinaturas</Link><span className={styles.planKind}>Plano enviado pelo gestor</span><h1>{selectedSubscriptionOffer.plan?.name ?? "Plano"}</h1><p>{selectedSubscriptionOffer.plan?.description ?? "Confira os detalhes antes de aceitar ou recusar."}</p></header>
    <article className={styles.subscriptionCard}>{selectedSubscriptionOffer.plan_version && <><h2>{money(selectedSubscriptionOffer.plan_version.price_cents)}</h2><p>{selectedSubscriptionOffer.plan_version.billing_period === "BIWEEKLY" ? "Quinzenal" : "Mensal"} · {selectedSubscriptionOffer.plan_version.duration_months} mês(es) · {selectedSubscriptionOffer.plan_version.sessions_per_cycle} sessão(ões) por ciclo · {selectedSubscriptionOffer.plan_version.scheduling_mode === "FIXED" ? "Agendamento fixo" : "Agendamento livre"} · pagamento: {paymentMethodLabel[selectedSubscriptionOffer.plan_version.payment_method] ?? selectedSubscriptionOffer.plan_version.payment_method}</p>
      {selectedSubscriptionOffer.plan_version.cancellation_policy && <details><summary>Políticas</summary><p>{selectedSubscriptionOffer.plan_version.cancellation_policy}</p>{selectedSubscriptionOffer.plan_version.session_cancellation_policy && <p>{selectedSubscriptionOffer.plan_version.session_cancellation_policy}</p>}</details>}</>}
      {selectedSubscriptionOffer.contract_body_snapshot && <details><summary>Contrato</summary><p>{selectedSubscriptionOffer.contract_body_snapshot}</p></details>}
      <div className={styles.planActions}><button className={styles.subscriptionAction} type="button" onClick={() => void acceptSubscriptionOffer(selectedSubscriptionOffer.id)}>Confirmar assinatura</button><button className={styles.subscriptionSecondary} type="button" onClick={() => void declineSubscriptionOffer(selectedSubscriptionOffer.id)}>Recusar</button></div>
    </article>
  </section>;

  if (view === "project-offer" && selectedProjectOffer) return <section className={styles.subscriptionStack}>
    <header><Link href={route("/cliente/assinaturas")} className={styles.subscriptionBack}>← Assinaturas</Link><span className={styles.planKind}>Plano enviado pelo gestor</span><h1>{selectedProjectOffer.project?.name ?? "Plano"} · {selectedProjectOffer.package?.name ?? "Pacote"}</h1><p>{selectedProjectOffer.project?.description ?? selectedProjectOffer.package?.description ?? "Confira os detalhes antes de aceitar ou recusar."}</p></header>
    <article className={styles.subscriptionCard}><p>{selectedProjectOffer.package?.description ?? "Pacote selecionado pelo gestor."}</p><small>{selectedProjectOffer.package?.sessions_count ?? 0} sessão(ões)</small><strong>{money(selectedProjectOffer.contracted_cents)}</strong><div className={styles.planActions}><button className={styles.subscriptionAction} type="button" onClick={() => void acceptProjectOffer(selectedProjectOffer)}>Confirmar assinatura</button><button className={styles.subscriptionSecondary} type="button" onClick={() => void declineProjectOffer(selectedProjectOffer)}>Recusar</button></div></article>
  </section>;

  if (view === "my-plan" && !selectedCustomerSubscription) return <section className={styles.subscriptionStack}><Link href={route("/cliente/assinaturas/meus-planos")} className={styles.subscriptionBack}>← Meus Planos</Link><h1>{message ? "Carregando plano…" : "Plano indisponível"}</h1>{message && <p>{message}</p>}</section>;

  if (view === "subscription" || view === "project" || view === "subscription-offer" || view === "project-offer") return <section className={styles.subscriptionStack}><Link href={route(view === "subscription" || view === "project" ? "/cliente/assinaturas/novo-plano" : "/cliente/assinaturas")} className={styles.subscriptionBack}>← Voltar</Link><h1>Plano indisponível</h1><p>Este plano não está mais disponível neste estabelecimento.</p></section>;

  return (
    <section className={styles.subscriptionStack}>
      <header>
        <Link href={route(view === "my-plan" ? "/cliente/assinaturas/meus-planos" : "/cliente/assinaturas")} className={styles.subscriptionBack}>← {view === "my-plan" ? "Meus Planos" : "Assinaturas"}</Link>
        <h1>{view === "my-plan" ? selectedCustomerSubscription?.plan?.name ?? "Detalhes do plano" : "Meus Planos"}</h1>
        {view === "my-plans" && <p>Planos ativos, solicitações e histórico deste estabelecimento.</p>}
      </header>
      {message && <p>{message}</p>}
      {view === "my-plans" && rows.filter((row) => row.status === "DECLINED").length > 0 && <div className={styles.subscriptionStack}>
        <h2>Histórico · recusados</h2>
        {rows.filter((row) => row.status === "DECLINED").map((row) => <article className={styles.subscriptionCard} key={`declined-${row.id}`}><span className={styles.planStatus}>Recusado</span><h3>{row.plan?.name ?? "Plano"}</h3><p>Oferta recusada e arquivada.</p></article>)}
      </div>}
      {view === "my-plans" && projectOffers.filter((offer) => offer.created_by === user?.id || offer.status === "ACTIVE" || offer.status === "DECLINED").length > 0 && <div className={styles.subscriptionStack}>
        <h2>Planos vinculados</h2>
        {projectOffers.filter((offer) => offer.created_by === user?.id || offer.status === "ACTIVE" || offer.status === "DECLINED").map((offer) => {
          const customerRequested = offer.created_by === user?.id;
          return <article className={styles.subscriptionCard} key={offer.id}>
            <h3>{offer.project?.name ?? "Projeto"} · {offer.package?.name ?? "Pacote"}</h3>
            <p>{offer.package?.description ?? (customerRequested ? "Solicitação enviada; aguarde o gestor." : "Plano de projeto contratado.")}</p>
            <strong>{new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(offer.contracted_cents / 100)}</strong>
            {offer.status === "PROPOSAL" && customerRequested && <small>Solicitação enviada · aguardando retorno</small>}
            {offer.status === "ACTIVE" && <small>Plano confirmado</small>}
            {offer.status === "DECLINED" && <span className={styles.planStatus}>Recusado · arquivado</span>}
          </article>;
        })}
      </div>}
      {(view === "my-plan" ? rows.filter((row) => row.id === itemId && row.status !== "DECLINED") : rows.filter((row) => row.status !== "DECLINED" && !(row.status === "REQUESTED" && !row.contract_accepted_at && row.created_by !== user?.id))).map((row) => view === "my-plan" ? (
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
            {paymentMethodLabel[row.payment_method] ?? row.payment_method} · {subscriptionStatusLabel[row.status] ?? row.status}
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
      ) : (
        <Link className={`${styles.subscriptionCard} ${styles.subscriptionCardLink}`} href={route(`/cliente/assinaturas/meus-planos/${row.id}`)} key={row.id}>
          <h2>{row.plan?.name ?? "Plano"}</h2>
          <p>{row.plan?.description ?? "Sem descrição"}</p>
          <strong>{row.plan_version ? money(row.plan_version.price_cents) : "—"}</strong>
          <small className={styles.subscriptionMeta}>{row.plan_version?.billing_period === "BIWEEKLY" ? "Quinzenal" : "Mensal"} · venc. {formatDate(row.first_due_date)} · pagamento: {paymentMethodLabel[row.payment_method] ?? row.payment_method} · {subscriptionStatusLabel[row.status] ?? row.status}</small>
          <span>Ver detalhes do plano</span>
        </Link>
      ))}
      {!rows.some((row) => row.status !== "DECLINED" && !(row.status === "REQUESTED" && !row.contract_accepted_at && row.created_by !== user?.id)) && !projectOffers.some((offer) => offer.created_by === user?.id || offer.status === "ACTIVE" || offer.status === "DECLINED") && <p>Você ainda não possui planos neste estabelecimento.</p>}
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

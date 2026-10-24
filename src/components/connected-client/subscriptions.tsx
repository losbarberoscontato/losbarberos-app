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
type CancellationRequest = {
  id: string;
  subscription_id: string;
  status: "PENDING" | "CONFIRMED";
  reason: string;
  observations: string | null;
  last_session_id: string | null;
};
type CancellationDraft = { subscriptionId: string; reason: string; observations: string; lastSessionId: string };

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
type ProjectOffer = { id: string; project_id: string; package_id: string; status: string; contracted_cents: number; created_by: string; accepted_at: string | null; project: { name: string; description: string | null } | null; package: { name: string; description: string | null; sessions_count: number } | null };
type ProjectInstallment = { id: string; engagement_id: string; installment_number: number; due_on: string; amount_cents: number; status: string; paid_at: string | null };
type ProjectSession = { id: string; engagement_id: string; session_number: number; status: string; appointment_id: string | null; service_id: string | null; barber_id: string | null; appointment?: { status: string; service_period: string | null } | null };
type ProjectCancellationRequest = { id: string; engagement_id: string; status: "PENDING" | "CONFIRMED"; reason: string; observations: string | null; last_session_id: string | null; last_installment_id: string | null };
type ProjectBookingOption = { service_id: string; service_name: string; barber_id: string; barber_name: string };
type ProjectCancellationDraft = { engagementId: string; reason: string; observations: string; lastSessionId: string };
type ProjectBookingDraft = { session: ProjectSession; options: ProjectBookingOption[]; barberId: string; serviceId: string; date: string; time: string; environmentId: string; environments: Array<{ id: string; name: string; sort_order: number }>; loading: boolean };
type PublicProject = { id: string; name: string; description: string | null; starts_on: string | null; sales_close_on: string | null; ends_on: string | null; package: { id: string; name: string; description: string | null; price_cents: number; sessions_count: number }[] };
type SubscriptionView = "home" | "my-plans" | "closed-plans" | "my-plan" | "new-plan" | "subscription" | "project" | "subscription-offer" | "project-offer";

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
  const [subscriptionDetailsLoadedFor, setSubscriptionDetailsLoadedFor] = useState("");
  const [projectDetailsLoadedFor, setProjectDetailsLoadedFor] = useState("");
  const [cancellationRequests, setCancellationRequests] = useState<CancellationRequest[]>([]);
  const [cancellationDraft, setCancellationDraft] = useState<CancellationDraft | null>(null);
  const [plans, setPlans] = useState<AvailablePlan[]>([]);
  const [projectOffers, setProjectOffers] = useState<ProjectOffer[]>([]);
  const [projectInstallments, setProjectInstallments] = useState<ProjectInstallment[]>([]);
  const [projectSessions, setProjectSessions] = useState<ProjectSession[]>([]);
  const [projectCancellationRequests, setProjectCancellationRequests] = useState<ProjectCancellationRequest[]>([]);
  const [projectCancellationDraft, setProjectCancellationDraft] = useState<ProjectCancellationDraft | null>(null);
  const [projectBookingDraft, setProjectBookingDraft] = useState<ProjectBookingDraft | null>(null);
  const [publicProjects, setPublicProjects] = useState<PublicProject[]>([]);
  const [contractBody, setContractBody] = useState<string | null>(null);
  const [fixedScheduleDraft, setFixedScheduleDraft] = useState<FixedScheduleDraft | null>(null);
  const [message, setMessage] = useState("Carregando assinaturas…");
  const customerDetailsKey = context && customer && user ? `${context.organization.id}:${customer.id}:${user.id}` : "";
  const subscriptionDetailsLoaded = Boolean(customerDetailsKey) && subscriptionDetailsLoadedFor === customerDetailsKey;
  const projectDetailsLoaded = Boolean(customerDetailsKey) && projectDetailsLoadedFor === customerDetailsKey;
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
        .in("status", ["REQUESTED", "PENDING_PAYMENT", "ACTIVE", "CANCELED", "DECLINED", "EXPIRED"]),
      client.from("customer_subscription_cancellation_requests")
        .select("id,subscription_id,status,reason,observations,last_session_id")
        .eq("organization_id", context.organization.id)
        .eq("customer_id", customer.id)
        .order("requested_at", { ascending: false }),
      client
        .from("subscription_plans")
        .select(
          "id,name,description,version:subscription_plan_versions(id,version,price_cents,billing_period,duration_months,sessions_per_cycle,scheduling_mode,payment_method,cancellation_policy,session_cancellation_policy)",
        )
        .eq("organization_id", context.organization.id)
        .eq("active", true),
      client.from("project_engagements").select("id,project_id,package_id,status,contracted_cents,created_by,accepted_at,project:projects(name,description),package:project_packages(name,description,sessions_count)")
        .eq("organization_id", context.organization.id).eq("customer_id", customer.id).in("status", ["PROPOSAL", "ACTIVE", "DECLINED", "CANCELED", "CANCELED_BY_ORGANIZATION", "COMPLETED"]),
      client.from("customer_project_cancellation_requests")
        .select("id,engagement_id,status,reason,observations,last_session_id,last_installment_id")
        .eq("organization_id", context.organization.id).eq("customer_id", customer.id).order("requested_at", { ascending: false }),
      client.from("projects").select("id,name,description,starts_on,sales_close_on,ends_on,package:project_packages(id,name,description,price_cents,sessions_count)")
        .eq("organization_id", context.organization.id).eq("status", "PUBLISHED"),
    ]).then(async ([subscriptionsResult, cancellationResult, plansResult, projectResult, projectCancellationResult, publicProjectResult]) => {
      const { data, error } = subscriptionsResult;
      if (error) {
        setMessage(error.message);
        return;
      }
      if (projectResult.error || projectCancellationResult.error) {
        setMessage(projectResult.error?.message ?? projectCancellationResult.error?.message ?? "Não foi possível carregar os planos de projeto.");
        return;
      }
      const subscriptions = (data ?? []) as unknown as Row[];
      setRows(subscriptions);
      setCancellationRequests((cancellationResult.data ?? []) as CancellationRequest[]);
      const engagements = (projectResult.data ?? []) as unknown as ProjectOffer[];
      setProjectOffers(engagements);
      setProjectCancellationRequests((projectCancellationResult.data ?? []) as ProjectCancellationRequest[]);
      const engagementIds = engagements.map((item) => item.id);
      if (engagementIds.length) {
        const [installmentResult, sessionResult] = await Promise.all([
          client.from("project_installments").select("id,engagement_id,installment_number,due_on,amount_cents,status,paid_at")
            .eq("organization_id", context.organization.id).in("engagement_id", engagementIds).neq("status", "CANCELED").order("installment_number"),
          client.from("project_engagement_sessions").select("id,engagement_id,session_number,status,appointment_id,service_id,barber_id")
            .eq("organization_id", context.organization.id).in("engagement_id", engagementIds).order("session_number"),
        ]);
        if (installmentResult.error) { setMessage(installmentResult.error.message); return; }
        if (sessionResult.error) { setMessage(sessionResult.error.message); return; }
        const sessionRows = (sessionResult.data ?? []) as ProjectSession[];
        const appointmentIds = sessionRows.map((session) => session.appointment_id).filter((id): id is string => Boolean(id));
        const appointmentResult = appointmentIds.length
          ? await client.from("appointments").select("id,status,service_period").in("id", appointmentIds)
          : { data: [] as Array<{ id: string; status: string; service_period: string | null }>, error: null };
        if (appointmentResult.error) { setMessage(appointmentResult.error.message); return; }
        setProjectInstallments((installmentResult.data ?? []) as ProjectInstallment[]);
        setProjectSessions(sessionRows.map((session) => ({
          ...session,
          appointment: session.appointment_id ? (appointmentResult.data ?? []).find((appointment) => appointment.id === session.appointment_id) ?? null : null,
        })));
      } else {
        setProjectInstallments([]);
        setProjectSessions([]);
      }
      setProjectDetailsLoadedFor(customerDetailsKey);
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
      if (!subscriptions.some((item) => item.status !== "DECLINED")) {
        setCycles([]);
        setSubscriptionDetailsLoadedFor(customerDetailsKey);
        return;
      }
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
      setSubscriptionDetailsLoadedFor(customerDetailsKey);
    });
  }, [context, customer, customerDetailsKey, user]);
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
  async function requestSubscriptionCancellation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!context || !cancellationDraft) return;
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const draft = cancellationDraft;
    const { error } = await client.rpc("request_customer_subscription_cancellation", {
      p_organization_id: context.organization.id,
      p_subscription_id: draft.subscriptionId,
      p_last_session_id: draft.lastSessionId || null,
      p_reason: draft.reason,
      p_observations: draft.reason === "OTHER" ? draft.observations : null,
    });
    setMessage(error ? error.message : "Solicitação enviada. O cancelamento será concluído após a confirmação do estabelecimento.");
    if (!error) window.location.reload();
    else setCancellationDraft(draft);
  }
  async function requestProjectCancellation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!context || !projectCancellationDraft) return;
    const draft = projectCancellationDraft;
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const { error } = await client.rpc("request_customer_project_cancellation", {
      p_organization_id: context.organization.id,
      p_engagement_id: draft.engagementId,
      p_last_session_id: draft.lastSessionId || null,
      p_reason: draft.reason,
      p_observations: draft.reason === "OTHER" ? draft.observations : null,
    });
    setMessage(error ? error.message : "Solicitação enviada. O cancelamento será concluído após a confirmação do estabelecimento.");
    if (!error) window.location.reload();
  }
  async function openProjectBooking(session: ProjectSession) {
    if (!context) return;
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const { data, error } = await client.rpc("get_customer_project_booking_options", { p_organization_id: context.organization.id, p_session_id: session.id });
    if (error) { setMessage(error.message); return; }
    const options = (data ?? []) as ProjectBookingOption[];
    if (!options.length) { setMessage("Este pacote ainda não possui serviços e profissionais habilitados para agendamento."); return; }
    const first = options[0];
    setProjectBookingDraft({ session, options, barberId: first.barber_id, serviceId: first.service_id, date: localToday(context.organization.timezone), time: "09:00", environmentId: "", environments: [], loading: false });
  }
  async function refreshProjectBookingEnvironments(draft: ProjectBookingDraft) {
    if (!context || !draft.barberId || !draft.serviceId || !draft.date || !draft.time) return;
    const client = getSupabaseBrowserClient();
    if (!client) return;
    setProjectBookingDraft((current) => current ? { ...current, loading: true, environments: [], environmentId: "" } : current);
    const { data, error } = await client.rpc("get_project_session_environments", {
      p_organization_id: context.organization.id,
      p_session_id: draft.session.id,
      p_barber_id: draft.barberId,
      p_service_id: draft.serviceId,
      p_starts_at: new Date(`${draft.date}T${draft.time}:00`).toISOString(),
    });
    const environments = (data ?? []) as Array<{ id: string; name: string; sort_order: number }>;
    setProjectBookingDraft((current) => current ? { ...current, loading: false, environments: error ? [] : environments, environmentId: error ? "" : environments[0]?.id ?? "" } : current);
    if (error) setMessage(error.message);
  }
  async function bookProjectSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!context || !projectBookingDraft || projectBookingDraft.loading || !projectBookingDraft.environmentId) return;
    const draft = projectBookingDraft;
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const { error } = await client.rpc("create_project_appointment", {
      p_organization_id: context.organization.id,
      p_session_id: draft.session.id,
      p_barber_id: draft.barberId,
      p_service_id: draft.serviceId,
      p_starts_at: new Date(`${draft.date}T${draft.time}:00`).toISOString(),
      p_environment_id: draft.environmentId,
      p_override_reason: null,
      p_notes: "Atendimento de projeto agendado pelo cliente",
    });
    setMessage(error ? error.message : "Sessão do plano agendada.");
    if (!error) window.location.reload();
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
  const projectCancellationRequestByEngagement = new Map(projectCancellationRequests.map((request) => [request.engagement_id, request]));
  const projectCancellationArchiveReady = (engagement: ProjectOffer) => ["CANCELED", "CANCELED_BY_ORGANIZATION", "COMPLETED"].includes(engagement.status)
    && projectDetailsLoaded
    && !projectInstallments.some((item) => item.engagement_id === engagement.id && item.status === "OPEN")
    && !projectSessions.some((item) => item.engagement_id === engagement.id && ["OPEN", "BOOKED"].includes(item.status));
  const projectSessionLabel = (session: ProjectSession) => session.status === "BOOKED" ? "Agendada" : session.status === "COMPLETED" ? "Concluída" : session.status === "CANCELED" ? "Cancelada" : "Disponível";
  const cancellationRequestBySubscription = new Map(cancellationRequests.map((request) => [request.subscription_id, request]));
  const subscriptionHasPendingCancellation = (id: string) => cancellationRequestBySubscription.get(id)?.status === "PENDING";
  const cancellationArchiveReady = (row: Row) => {
    if (!["CANCELED", "EXPIRED"].includes(row.status) || !subscriptionDetailsLoaded) return false;
    const rowCycles = cycles.filter((cycle) => cycle.subscription_id === row.id);
    return !rowCycles.some((cycle) => cycle.status === "OPEN" || cycle.status === "OVERDUE")
      && !rowCycles.some((cycle) => cycle.sessions.some((session) => session.status === "AVAILABLE" || session.status === "SCHEDULED"));
  };
  const dateRange = (start: string | null, end: string | null) => start || end ? `${start ? formatDate(start) : "—"} a ${end ? formatDate(end) : "—"}` : null;
  const requestedOffers = rows.filter((row) => row.status === "REQUESTED" && !row.contract_accepted_at && row.created_by !== user?.id);
  const pendingProjectOffers = projectOffers.filter((offer) => offer.status === "PROPOSAL" && offer.created_by !== user?.id);
  const selectedPlan = plans.find((plan) => plan.id === itemId);
  const selectedProject = publicProjects.find((project) => project.id === itemId);
  const selectedSubscriptionOffer = requestedOffers.find((row) => row.id === itemId);
  const selectedProjectOffer = pendingProjectOffers.find((offer) => offer.id === itemId);
  const selectedCustomerProject = projectOffers.find((offer) => offer.id === itemId && offer.status !== "DECLINED" && !projectCancellationArchiveReady(offer));
  const selectedCustomerSubscription = rows.find((row) => row.id === itemId && row.status !== "DECLINED" && !cancellationArchiveReady(row));

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
    <article className={styles.subscriptionCard}><p>{selectedProjectOffer.package?.description ?? "Pacote selecionado pelo gestor."}</p><small>{selectedProjectOffer.package?.sessions_count ?? 0} sessão(ões)</small><strong>{money(selectedProjectOffer.contracted_cents)}</strong><div className={styles.planActions}><button className={styles.subscriptionAction} type="button" onClick={() => void acceptProjectOffer(selectedProjectOffer)}>Confirmar assinatura</button><button className={styles.subscriptionSecondary} type="button" onClick={() => void declineProjectOffer(selectedProjectOffer)}>Recusar contrato</button></div></article>
  </section>;

  if (view === "my-plan" && !selectedCustomerSubscription && !selectedCustomerProject) return <section className={styles.subscriptionStack}><Link href={route("/cliente/assinaturas/meus-planos")} className={styles.subscriptionBack}>← Meus Planos</Link><h1>{message ? "Carregando plano…" : "Plano indisponível"}</h1>{message && <p>{message}</p>}</section>;

  if (view === "my-plan" && selectedCustomerProject) {
    const engagement = selectedCustomerProject;
    const request = projectCancellationRequestByEngagement.get(engagement.id);
    const installments = projectInstallments.filter((item) => item.engagement_id === engagement.id).sort((a, b) => a.installment_number - b.installment_number);
    const sessions = projectSessions.filter((item) => item.engagement_id === engagement.id).sort((a, b) => a.session_number - b.session_number);
    const canBook = (session: ProjectSession) => session.status === "OPEN" && (engagement.status === "ACTIVE"
      ? request?.status !== "PENDING" || Boolean(request.last_session_id && session.session_number <= (sessions.find((item) => item.id === request.last_session_id)?.session_number ?? 0))
      : request?.status === "CONFIRMED" && request.last_session_id === session.id);
    return <section className={styles.subscriptionStack}>
      <header><Link href={route("/cliente/assinaturas/meus-planos")} className={styles.subscriptionBack}>← Meus Planos</Link><span className={styles.planKind}>Plano de projeto</span><h1>{engagement.project?.name ?? "Projeto"} · {engagement.package?.name ?? "Pacote"}</h1><p>{engagement.project?.description ?? engagement.package?.description ?? "Detalhes do plano contratado."}</p></header>
      <article className={styles.subscriptionCard}>
        {request?.status === "PENDING" && <span className={styles.planStatus}>Cancelamento pendente · aguarde confirmação</span>}
        {(engagement.status === "CANCELED" || engagement.status === "CANCELED_BY_ORGANIZATION") && <span className={styles.planStatus}>Aguardando regular pendências</span>}
        <p>{engagement.package?.description ?? "Pacote selecionado para este projeto."}</p><strong>{money(engagement.contracted_cents)}</strong>
        <small>{engagement.status === "PROPOSAL" ? "Solicitação enviada · aguardando retorno" : engagement.status === "CANCELED_BY_ORGANIZATION" ? "Contrato cancelado pelo estabelecimento" : engagement.status === "CANCELED" ? "Contrato cancelado" : engagement.status === "COMPLETED" ? "Plano concluído" : "Plano ativo"} · {engagement.package?.sessions_count ?? sessions.length} sessão(ões)</small>
        <div className={styles.subscriptionStack}><h2>Parcelas</h2>{installments.length ? installments.map((installment) => <div className={styles.subscriptionCycle} key={installment.id}><p><strong>{installment.installment_number === 0 ? "Entrada" : `Parcela ${installment.installment_number}`}</strong> · venc. {formatDate(installment.due_on)}</p><strong>{money(installment.amount_cents)}</strong><small>{installment.status === "PAID" ? `Pago${installment.paid_at ? ` em ${formatDate(installment.paid_at.slice(0, 10))}` : ""}` : installment.status === "CANCELED" ? "Cobrança encerrada" : installment.due_on < new Date().toISOString().slice(0, 10) ? "Em atraso · em aberto" : "Em aberto"}</small></div>) : <p>Sem parcelas cadastradas.</p>}</div>
        <div className={styles.subscriptionStack}><h2>Sessões do plano</h2>{sessions.length ? sessions.map((session) => <div className={styles.subscriptionCycle} key={session.id}><p><strong>Sessão {session.session_number}</strong> · {projectSessionLabel(session)}{session.appointment?.service_period ? ` · ${sessionDate(session.appointment.service_period)}` : ""}</p>{canBook(session) && <button className={styles.subscriptionAction} type="button" onClick={() => void openProjectBooking(session)}>Agendar sessão</button>}</div>) : <p>As sessões serão liberadas após a confirmação do contrato.</p>}</div>
        <div className={styles.planActions}>
          {engagement.status === "ACTIVE" && request?.status !== "PENDING" && <button className={styles.subscriptionSecondary} type="button" onClick={() => setProjectCancellationDraft({ engagementId: engagement.id, reason: "", observations: "", lastSessionId: "" })}>Solicitar cancelamento</button>}
          {request?.status === "PENDING" && <span className={styles.planStatus}>Solicitação aguardando confirmação do estabelecimento</span>}
        </div>
      </article>
      {projectCancellationDraft && projectCancellationDraft.engagementId === engagement.id && <div className={styles.modalLayer} role="presentation"><button className={styles.backdrop} type="button" aria-label="Fechar solicitação de cancelamento" onClick={() => setProjectCancellationDraft(null)} /><form className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="project-cancellation-title" onSubmit={(event) => void requestProjectCancellation(event)}>
        <h2 id="project-cancellation-title">Solicitar cancelamento</h2><p>O cancelamento será concluído após o estabelecimento confirmar o contrato.</p>
        <label>Motivo do cancelamento<select required value={projectCancellationDraft.reason} onChange={(event) => setProjectCancellationDraft((current) => current ? { ...current, reason: event.target.value } : current)}><option value="">Selecione</option><option value="FINANCIAL_DIFFICULTY">Dificuldade Financeira</option><option value="LACK_OF_TIME">Falta de tempo</option><option value="ADDRESS_CHANGE">Mudança de endereço</option><option value="OTHER">Outros</option></select></label>
        {projectCancellationDraft.reason === "OTHER" && <label>Observações<textarea required maxLength={2000} value={projectCancellationDraft.observations} onChange={(event) => setProjectCancellationDraft((current) => current ? { ...current, observations: event.target.value } : current)} /></label>}
        <label>Última sessão que pretende comparecer<select value={projectCancellationDraft.lastSessionId} onChange={(event) => setProjectCancellationDraft((current) => current ? { ...current, lastSessionId: event.target.value } : current)}><option value="">Nenhuma sessão adicional</option>{sessions.filter((session) => session.status === "OPEN" || session.status === "BOOKED").map((session) => <option key={session.id} value={session.id}>Sessão {session.session_number} · {projectSessionLabel(session)}</option>)}</select></label>
        <footer><button className={styles.subscriptionSecondary} type="button" onClick={() => setProjectCancellationDraft(null)}>Cancelar</button><button className={styles.subscriptionAction} type="submit">Enviar solicitação</button></footer>
      </form></div>}
      {projectBookingDraft && projectBookingDraft.session.engagement_id === engagement.id && <div className={styles.modalLayer} role="presentation"><button className={styles.backdrop} type="button" aria-label="Fechar agendamento" onClick={() => setProjectBookingDraft(null)} /><form className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="project-booking-title" onSubmit={(event) => void bookProjectSession(event)}>
        <h2 id="project-booking-title">Agendar sessão {projectBookingDraft.session.session_number}</h2>
        <label>Profissional<select value={projectBookingDraft.barberId} onChange={(event) => setProjectBookingDraft((current) => current ? { ...current, barberId: event.target.value, environmentId: "", environments: [] } : current)}>{[...new Map(projectBookingDraft.options.map((option) => [option.barber_id, option.barber_name])).entries()].map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label>Serviço<select value={projectBookingDraft.serviceId} onChange={(event) => setProjectBookingDraft((current) => current ? { ...current, serviceId: event.target.value, environmentId: "", environments: [] } : current)}>{projectBookingDraft.options.filter((option) => option.barber_id === projectBookingDraft.barberId).map((option) => <option key={option.service_id} value={option.service_id}>{option.service_name}</option>)}</select></label>
        <label>Data<input required type="date" min={context ? localToday(context.organization.timezone) : undefined} value={projectBookingDraft.date} onChange={(event) => setProjectBookingDraft((current) => current ? { ...current, date: event.target.value, environmentId: "", environments: [] } : current)} /></label>
        <label>Horário<input required type="time" step={900} value={projectBookingDraft.time} onChange={(event) => setProjectBookingDraft((current) => current ? { ...current, time: event.target.value, environmentId: "", environments: [] } : current)} /></label>
        <button className={styles.subscriptionSecondary} type="button" disabled={projectBookingDraft.loading} onClick={() => void refreshProjectBookingEnvironments(projectBookingDraft)}>{projectBookingDraft.loading ? "Consultando…" : "Ver horários disponíveis"}</button>
        <label>Ambiente<select required value={projectBookingDraft.environmentId} onChange={(event) => setProjectBookingDraft((current) => current ? { ...current, environmentId: event.target.value } : current)}><option value="">{projectBookingDraft.environments.length ? "Selecione" : "Consulte os horários"}</option>{projectBookingDraft.environments.map((environment) => <option key={environment.id} value={environment.id}>{environment.name}</option>)}</select></label>
        <footer><button className={styles.subscriptionSecondary} type="button" onClick={() => setProjectBookingDraft(null)}>Cancelar</button><button className={styles.subscriptionAction} type="submit" disabled={!projectBookingDraft.environmentId || projectBookingDraft.loading}>Agendar sessão</button></footer>
      </form></div>}
    </section>;
  }

  if (view === "subscription" || view === "project" || view === "subscription-offer" || view === "project-offer") return <section className={styles.subscriptionStack}><Link href={route(view === "subscription" || view === "project" ? "/cliente/assinaturas/novo-plano" : "/cliente/assinaturas")} className={styles.subscriptionBack}>← Voltar</Link><h1>Plano indisponível</h1><p>Este plano não está mais disponível neste estabelecimento.</p></section>;

  return (
    <section className={styles.subscriptionStack}>
      <header>
        <Link href={route(view === "my-plan" || view === "closed-plans" ? "/cliente/assinaturas/meus-planos" : "/cliente/assinaturas")} className={styles.subscriptionBack}>← {view === "my-plan" || view === "closed-plans" ? "Meus Planos" : "Assinaturas"}</Link>
        <h1>{view === "my-plan" ? selectedCustomerSubscription?.plan?.name ?? "Detalhes do plano" : view === "closed-plans" ? "Planos Encerrados" : "Meus Planos"}</h1>
        {(view === "my-plans" || view === "closed-plans") && <p>Planos ativos, solicitações e histórico deste estabelecimento.</p>}
      </header>
      {message && <p>{message}</p>}
      {view === "my-plans" && rows.filter((row) => row.status === "DECLINED").length > 0 && <div className={styles.subscriptionStack}>
        <h2>Histórico · recusados</h2>
        {rows.filter((row) => row.status === "DECLINED").map((row) => <article className={styles.subscriptionCard} key={`declined-${row.id}`}><span className={styles.planStatus}>Recusado</span><h3>{row.plan?.name ?? "Plano"}</h3><p>Oferta recusada e arquivada.</p></article>)}
      </div>}
      {view === "my-plans" && projectOffers.some((offer) => !projectCancellationArchiveReady(offer) && (offer.created_by === user?.id || ["ACTIVE", "COMPLETED", "CANCELED", "CANCELED_BY_ORGANIZATION", "DECLINED"].includes(offer.status))) && <div className={styles.subscriptionStack}>
        <h2>Planos vinculados</h2>
        {projectOffers.filter((offer) => !projectCancellationArchiveReady(offer) && (offer.created_by === user?.id || ["ACTIVE", "COMPLETED", "CANCELED", "CANCELED_BY_ORGANIZATION", "DECLINED"].includes(offer.status))).map((offer) => {
          const customerRequested = offer.created_by === user?.id;
          if (offer.status === "DECLINED") return <article className={styles.subscriptionCard} key={offer.id}><span className={styles.planStatus}>Cliente Recusou</span><h3>{offer.project?.name ?? "Projeto"} · {offer.package?.name ?? "Pacote"}</h3><p>Contrato recusado e arquivado.</p></article>;
          return <Link className={`${styles.subscriptionCard} ${styles.subscriptionCardLink}`} href={route(`/cliente/assinaturas/meus-planos/${offer.id}`)} key={offer.id}>
            {projectCancellationRequestByEngagement.get(offer.id)?.status === "PENDING" && <span className={styles.planStatus}>Cancelamento pendente</span>}
            {(offer.status === "CANCELED" || offer.status === "CANCELED_BY_ORGANIZATION") && <span className={styles.planStatus}>Aguardando regular pendências</span>}
            <h3>{offer.project?.name ?? "Projeto"} · {offer.package?.name ?? "Pacote"}</h3>
            <p>{offer.package?.description ?? (customerRequested ? "Solicitação enviada; aguarde o gestor." : "Plano de projeto contratado.")}</p>
            <strong>{new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(offer.contracted_cents / 100)}</strong>
            {offer.status === "PROPOSAL" && customerRequested && <small>Solicitação enviada · aguardando retorno</small>}
            {offer.status === "ACTIVE" && <small>Plano ativo · {projectInstallments.filter((row) => row.engagement_id === offer.id).length} cobrança(s) · {projectSessions.filter((row) => row.engagement_id === offer.id).length} sessão(ões)</small>}
            {offer.status === "COMPLETED" && <small>Plano concluído</small>}
            <span>Ver detalhes do plano</span>
          </Link>;
        })}
      </div>}
      {view === "closed-plans" && <div className={styles.subscriptionStack}>
        <h2>Planos Encerrados</h2>
        {projectOffers.filter(projectCancellationArchiveReady).map((offer) => <article className={styles.subscriptionCard} key={`closed-project-${offer.id}`}><span className={styles.planStatus}>Encerrado</span><h3>{offer.project?.name ?? "Projeto"} · {offer.package?.name ?? "Pacote"}</h3><p>Plano de projeto encerrado. Não há parcelas ou sessões pendentes.</p><strong>{money(offer.contracted_cents)}</strong></article>)}
        {rows.filter(cancellationArchiveReady).map((row) => <article className={styles.subscriptionCard} key={`closed-subscription-${row.id}`}><span className={styles.planStatus}>Encerrado</span><h3>{row.plan?.name ?? "Plano"}</h3><p>{row.plan?.description ?? "Assinatura encerrada sem pendências."}</p><strong>{row.plan_version ? money(row.plan_version.price_cents) : "—"}</strong></article>)}
        {!projectOffers.some(projectCancellationArchiveReady) && !rows.some(cancellationArchiveReady) && <p>Nenhum plano encerrado disponível.</p>}
      </div>}
      {(view === "my-plan" ? rows.filter((row) => row.id === itemId && row.status !== "DECLINED" && !cancellationArchiveReady(row)) : view === "closed-plans" ? [] : rows.filter((row) => row.status !== "DECLINED" && !cancellationArchiveReady(row) && !(row.status === "REQUESTED" && !row.contract_accepted_at && row.created_by !== user?.id))).map((row) => view === "my-plan" ? (
        <article className={styles.subscriptionCard} key={row.id}>
          {subscriptionHasPendingCancellation(row.id) && <span className={styles.planStatus}>Cancelamento pendente</span>}
          {row.status === "CANCELED" && <span className={styles.planStatus}>Aguardando regular pendências</span>}
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
          <div className={styles.planActions}>
            {contractBody && <button className={styles.subscriptionSecondary} type="button" onClick={() => window.alert(row.contract_body_snapshot ?? contractBody)}>Acessar contrato</button>}
            {(row.status === "ACTIVE" || row.status === "PENDING_PAYMENT") && !subscriptionHasPendingCancellation(row.id) && <button className={styles.subscriptionSecondary} type="button" onClick={() => setCancellationDraft({ subscriptionId: row.id, reason: "", observations: "", lastSessionId: "" })}>Solicitar cancelamento</button>}
            {subscriptionHasPendingCancellation(row.id) && <span className={styles.planStatus} role="status">Cancelamento pendente · aguarde confirmação</span>}
          </div>
        </article>
      ) : (
        <Link className={`${styles.subscriptionCard} ${styles.subscriptionCardLink}`} href={route(`/cliente/assinaturas/meus-planos/${row.id}`)} key={row.id}>
          <h2>{row.plan?.name ?? "Plano"}</h2>
          {subscriptionHasPendingCancellation(row.id) && <span className={styles.planStatus}>Cancelamento pendente</span>}
          {row.status === "CANCELED" && <span className={styles.planStatus}>Cancelada · finalizando pendências</span>}
          <p>{row.plan?.description ?? "Sem descrição"}</p>
          <strong>{row.plan_version ? money(row.plan_version.price_cents) : "—"}</strong>
          <small className={styles.subscriptionMeta}>{row.plan_version?.billing_period === "BIWEEKLY" ? "Quinzenal" : "Mensal"} · venc. {formatDate(row.first_due_date)} · pagamento: {paymentMethodLabel[row.payment_method] ?? row.payment_method} · {subscriptionStatusLabel[row.status] ?? row.status}</small>
          <span>Ver detalhes do plano</span>
        </Link>
      ))}
      {!rows.some((row) => row.status !== "DECLINED" && !cancellationArchiveReady(row) && !(row.status === "REQUESTED" && !row.contract_accepted_at && row.created_by !== user?.id)) && !projectOffers.some((offer) => offer.created_by === user?.id || offer.status === "ACTIVE" || offer.status === "DECLINED") && <p>Você ainda não possui planos neste estabelecimento.</p>}
      {view === "my-plans" && <Link className={styles.subscriptionCard} href={route("/cliente/assinaturas/meus-planos/encerrados")}><h2>Planos Encerrados</h2><p>Planos e assinaturas sem pendências financeiras ou sessões abertas.</p><span>Acessar planos encerrados</span></Link>}
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
      {cancellationDraft && (() => {
        const rowCycles = cycles.filter((cycle) => cycle.subscription_id === cancellationDraft.subscriptionId);
        const finalSessions = rowCycles.flatMap((cycle) => cycle.sessions
          .filter((session) => session.status === "AVAILABLE" || session.status === "SCHEDULED")
          .map((session) => ({ ...session, cycleNumber: cycle.cycle_number })));
        return <div className={styles.modalLayer} role="presentation">
          <button className={styles.backdrop} type="button" aria-label="Fechar solicitação de cancelamento" onClick={() => setCancellationDraft(null)} />
          <form className={`${styles.modal} ${styles.modalWide}`} role="dialog" aria-modal="true" aria-labelledby="subscription-cancellation-title" onSubmit={(event) => void requestSubscriptionCancellation(event)}>
            <h2 id="subscription-cancellation-title">Solicitar cancelamento</h2>
            <p>O cancelamento será concluído somente após a confirmação do estabelecimento.</p>
            <label>Motivo do cancelamento<select required value={cancellationDraft.reason} onChange={(event) => setCancellationDraft((draft) => draft ? { ...draft, reason: event.target.value } : draft)}><option value="">Selecione</option><option value="FINANCIAL_DIFFICULTY">Dificuldade Financeira</option><option value="LACK_OF_TIME">Falta de tempo</option><option value="ADDRESS_CHANGE">Mudança de endereço</option><option value="OTHER">Outros</option></select></label>
            {cancellationDraft.reason === "OTHER" && <label>Observações<textarea required maxLength={2000} value={cancellationDraft.observations} onChange={(event) => setCancellationDraft((draft) => draft ? { ...draft, observations: event.target.value } : draft)} /></label>}
            <label>Última sessão que pretende comparecer<select value={cancellationDraft.lastSessionId} onChange={(event) => setCancellationDraft((draft) => draft ? { ...draft, lastSessionId: event.target.value } : draft)}><option value="">Nenhuma sessão adicional</option>{finalSessions.map((session) => <option key={session.id} value={session.id}>Ciclo {session.cycleNumber} · Sessão {session.session_number}</option>)}</select></label>
            <footer><button type="button" className={styles.subscriptionSecondary} onClick={() => setCancellationDraft(null)}>Cancelar</button><button type="submit" className={styles.subscriptionAction} disabled={!cancellationDraft.reason}>Enviar solicitação</button></footer>
          </form>
        </div>;
      })()}
    </section>
  );
}

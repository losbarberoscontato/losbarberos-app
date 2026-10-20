"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  Building2,
  CalendarClock,
  CheckCircle2,
  CircleOff,
  Filter,
  History,
  LockKeyhole,
  RefreshCw,
  Search,
  ShieldCheck,
  UnlockKeyhole,
  X,
} from "lucide-react";
import { Brand } from "@/components/brand";
import { BILLING_STATUSES, type BillingStatus } from "@/lib/domain/types";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { formatAdminInstant, formatAdminStatus, organizationInitials } from "./format";
import type { AdminControlPlaneData, AdminOrganization, AdminSubscription } from "./types";
import styles from "./control-plane.module.css";

type AccessChange = {
  organization: AdminOrganization;
  currentStatus: BillingStatus;
  targetStatus: "ACTIVE" | "BLOCKED";
};

function StatusChip({ status }: { status: BillingStatus | null | undefined }) {
  const cssStatus = status?.toLowerCase().replaceAll("_", "-") ?? "missing";
  return <span className={`${styles.status} ${styles[`status_${cssStatus}`] ?? ""}`}><i />{formatAdminStatus(status)}</span>;
}

function SubscriptionDates({ subscription }: { subscription: AdminSubscription | undefined }) {
  const dates = [
    ["Trial", subscription?.trial_ends_at],
    ["Período", subscription?.current_period_ends_at],
    ["Carência", subscription?.grace_ends_at],
    ["Retenção", subscription?.retention_ends_at],
  ] as const;

  return <dl className={styles.milestones}>{dates.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{formatAdminInstant(value)}</dd></div>)}</dl>;
}

function formatModuleCents(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value / 100);
}

export function AdminControlPlane({ data }: { data: AdminControlPlaneData }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [auditOrganizationId, setAuditOrganizationId] = useState("ALL");
  const [statusOverrides, setStatusOverrides] = useState<Record<string, BillingStatus>>({});
  const [accessChange, setAccessChange] = useState<AccessChange | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [modulePriceDrafts, setModulePriceDrafts] = useState<Record<string, string>>({});
  const [moduleSaving, setModuleSaving] = useState<string | null>(null);
  const [kanbanProduct, setKanbanProduct] = useState("los-barberos");
  const [kanbanPrice, setKanbanPrice] = useState("");
  const [kanbanTestId, setKanbanTestId] = useState("");
  const [kanbanLiveId, setKanbanLiveId] = useState("");
  const [kanbanContractVersion, setKanbanContractVersion] = useState("");
  const [kanbanContractBody, setKanbanContractBody] = useState("");

  const subscriptionByOrganization = useMemo(
    () => new Map(data.subscriptions.map((subscription) => [subscription.organization_id, subscription])),
    [data.subscriptions],
  );
  const organizationById = useMemo(
    () => new Map(data.organizations.map((organization) => [organization.id, organization])),
    [data.organizations],
  );
  const getStatus = (organizationId: string) =>
    statusOverrides[organizationId] ?? subscriptionByOrganization.get(organizationId)?.status ?? null;

  const organizations = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
    return data.organizations.filter((organization) => {
      const status = statusOverrides[organization.id] ?? subscriptionByOrganization.get(organization.id)?.status ?? null;
      const matchesQuery = !normalizedQuery || `${organization.name} ${organization.slug} ${organization.id}`.toLocaleLowerCase("pt-BR").includes(normalizedQuery);
      const matchesStatus = statusFilter === "ALL"
        || (statusFilter === "MISSING" ? status === null : status === statusFilter);
      return matchesQuery && matchesStatus;
    });
  }, [data.organizations, query, statusFilter, statusOverrides, subscriptionByOrganization]);

  const events = useMemo(
    () => data.accessEvents.filter((event) => auditOrganizationId === "ALL" || event.organization_id === auditOrganizationId),
    [auditOrganizationId, data.accessEvents],
  );
  const counts = useMemo(() => {
    const statuses = data.organizations.map((organization) =>
      statusOverrides[organization.id] ?? subscriptionByOrganization.get(organization.id)?.status ?? null);
    return {
      total: data.organizations.length,
      active: statuses.filter((status) => status === "ACTIVE").length,
      trials: statuses.filter((status) => status === "TRIALING").length,
      attention: statuses.filter((status) => status === "GRACE" || status === "BLOCKED").length,
    };
  }, [data.organizations, statusOverrides, subscriptionByOrganization]);

  function prepareAccessChange(organization: AdminOrganization, currentStatus: BillingStatus) {
    const targetStatus = currentStatus === "BLOCKED" ? "ACTIVE" : "BLOCKED";
    setReason("");
    setFeedback(null);
    setMutationError(null);
    setAccessChange({ organization, currentStatus, targetStatus });
  }

  async function submitAccessChange() {
    if (!accessChange || !reason.trim() || submitting) return;
    setSubmitting(true);
    setFeedback(null);
    setMutationError(null);
    try {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) throw new Error("Supabase não configurado.");
      const result = await supabase.rpc("set_platform_organization_access_status", {
        p_organization_id: accessChange.organization.id,
        p_status: accessChange.targetStatus,
        p_reason: reason.trim(),
      });
      if (result.error) throw new Error(result.error.message);

      setStatusOverrides((current) => ({
        ...current,
        [accessChange.organization.id]: accessChange.targetStatus,
      }));
      setFeedback({
        kind: "success",
        message: `${accessChange.organization.name}: acesso alterado para ${formatAdminStatus(accessChange.targetStatus)}. Auditoria registrada.`,
      });
      setAccessChange(null);
      setReason("");
      router.refresh();
    } catch {
      setMutationError("Não foi possível alterar o acesso. Confirme sua sessão e tente novamente.");
    } finally {
      setSubmitting(false);
    }
  }

  async function saveModulePrice(moduleKey: string) {
    const raw = modulePriceDrafts[moduleKey];
    const cents = Math.round(Number(String(raw ?? "").trim().replace(/\./gu, "").replace(",", ".")) * 100);
    if (!Number.isFinite(cents) || cents < 0) { setMutationError("Informe um preço válido."); return; }
    setModuleSaving(moduleKey); setMutationError(null);
    try {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) throw new Error("Supabase não configurado.");
      const result = await supabase.rpc("set_platform_module_price", { p_module_key: moduleKey, p_monthly_price_cents: cents, p_effective_from: new Date().toISOString().slice(0, 10) });
      if (result.error) throw new Error(result.error.message);
      setFeedback({ kind: "success", message: "Preço do módulo atualizado." });
      router.refresh();
    } catch { setMutationError("Não foi possível atualizar o preço do módulo."); }
    finally { setModuleSaving(null); }
  }

  async function publishKanbanPrice(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cents = Math.round(Number(kanbanPrice.trim().replace(/\./gu, "").replace(",", ".")) * 100);
    if (!Number.isSafeInteger(cents) || cents <= 0) { setMutationError("Informe um valor mensal válido."); return; }
    setModuleSaving("kanban"); setMutationError(null);
    try {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) throw new Error("Supabase não configurado.");
      const result = await supabase.rpc("publish_platform_kanban_price", {
        p_product_key: kanbanProduct, p_monthly_price_cents: cents,
        p_stripe_test_price_id: kanbanTestId.trim(), p_stripe_live_price_id: kanbanLiveId.trim(),
        p_contract_version: kanbanContractVersion.trim(), p_contract_body: kanbanContractBody.trim(),
      });
      if (result.error) throw new Error(result.error.message);
      setFeedback({ kind: "success", message: "Preço e aditivo do Kanban publicados para novas ativações." });
      router.refresh();
    } catch { setMutationError("Não foi possível publicar a configuração do Kanban."); }
    finally { setModuleSaving(null); }
  }

  useEffect(() => {
    if (!accessChange) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) setAccessChange(null);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [accessChange, submitting]);

  const completeFailure = data.errors.length === 3;

  return <div className={styles.shell}>
    <header className={styles.topbar}>
      <Brand href="/admin" light />
      <span><ShieldCheck size={15} /> Platform admin · ambiente conectado</span>
    </header>
    <main className={styles.main}>
      <header className={styles.heading}>
        <div><span>Control plane</span><h1>Operação Los Barberos</h1><p>Tenants, billing SaaS, recuperação de acesso e auditoria. Nenhum dado de cliente ou perfil é consultado.</p></div>
        <time dateTime={data.loadedAt}>Atualizado {formatAdminInstant(data.loadedAt)}</time>
      </header>

      {data.errors.length > 0 && <section className={styles.errorState} role="alert">
        <AlertTriangle size={20} />
        <div><strong>{completeFailure ? "Control plane indisponível" : "Dados parciais"}</strong>{data.errors.map((error) => <p key={error}>{error}</p>)}</div>
        <button type="button" onClick={() => router.refresh()}><RefreshCw size={15} /> Tentar novamente</button>
      </section>}

      {!completeFailure && <>
        {feedback && <p className={`${styles.feedback} ${feedback.kind === "error" ? styles.feedbackError : ""}`} role={feedback.kind === "error" ? "alert" : "status"}>{feedback.kind === "success" ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}{feedback.message}</p>}

        <section className={styles.kpis} aria-label="Resumo de tenants">
          <article><span><Building2 size={18} /></span><small>Tenants</small><strong>{counts.total}</strong><p>organizações cadastradas</p></article>
          <article><span><CheckCircle2 size={18} /></span><small>Ativas</small><strong>{counts.active}</strong><p>acesso operacional</p></article>
          <article><span><CalendarClock size={18} /></span><small>Trials</small><strong>{counts.trials}</strong><p>período de avaliação</p></article>
          <article><span><AlertTriangle size={18} /></span><small>Atenção</small><strong>{counts.attention}</strong><p>carência ou bloqueio</p></article>
        </section>

        <section className={styles.revenueNotice}>
          <CircleOff size={18} />
          <div><strong>MRR não calculado</strong><p>Banco guarda Stripe Price ID, não valor monetário do Price. Receita não será inferida nem hardcoded.</p></div>
        </section>

        <section className={styles.panel} aria-labelledby="modules-title">
          <div className={styles.panelHeading}><div><h2 id="modules-title">Módulos e preços futuros</h2><p>Configuração exclusiva do Platform Admin. Ainda não altera o Stripe.</p></div></div>
          {(data.modules ?? []).length === 0 ? <div className={styles.empty}><CircleOff size={28} /><strong>Nenhum módulo cadastrado</strong></div> : <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Módulo</th><th>Preço mensal</th><th>Vigência</th><th /></tr></thead><tbody>{(data.modules ?? []).filter((module) => module.key !== "kanban").map((module) => { const current = (data.modulePrices ?? []).find((price) => price.module_key === module.key && !price.effective_until) ?? (data.modulePrices ?? []).find((price) => price.module_key === module.key); return <tr key={module.key}><td><strong>{module.name}</strong><small>{module.description}</small></td><td><input aria-label={`Preço de ${module.name}`} inputMode="decimal" defaultValue={current ? (current.monthly_price_cents / 100).toFixed(2).replace(".", ",") : ""} onChange={(event) => setModulePriceDrafts((drafts) => ({ ...drafts, [module.key]: event.target.value }))} /></td><td>{current?.effective_from ?? "—"}</td><td><button type="button" disabled={moduleSaving === module.key} onClick={() => void saveModulePrice(module.key)}>{moduleSaving === module.key ? "Salvando…" : "Salvar preço"}</button>{current && <small>{formatModuleCents(current.monthly_price_cents)}</small>}</td></tr>; })}</tbody></table></div>}
          <form onSubmit={(event) => void publishKanbanPrice(event)}>
            <h3>Kanban por sistema</h3>
            <p>Publique valor, IDs Stripe de teste e produção e aditivo. A nova versão vale para novas ativações.</p>
            <label>Sistema <select value={kanbanProduct} onChange={(event) => setKanbanProduct(event.target.value)}><option value="los-barberos">Los Barberos</option><option value="le-gras">Le Gras</option><option value="pro-stetic">Pro Stetic</option><option value="music-pro">Music Pro</option></select></label>
            <label>Valor mensal em R$ <input value={kanbanPrice} onChange={(event) => setKanbanPrice(event.target.value)} inputMode="decimal" required /></label>
            <label>Stripe Price ID de teste <input value={kanbanTestId} onChange={(event) => setKanbanTestId(event.target.value)} required /></label>
            <label>Stripe Price ID de produção <input value={kanbanLiveId} onChange={(event) => setKanbanLiveId(event.target.value)} required /></label>
            <label>Versão do aditivo <input value={kanbanContractVersion} onChange={(event) => setKanbanContractVersion(event.target.value)} required /></label>
            <label>Texto do aditivo <textarea value={kanbanContractBody} onChange={(event) => setKanbanContractBody(event.target.value)} minLength={20} required /></label>
            <button type="submit" disabled={moduleSaving === "kanban"}>Publicar Kanban</button>
            {(data.kanbanPrices ?? []).filter((price) => price.product_key === kanbanProduct && !price.retired_at).map((price) => <p key={price.id}>Vigente: {formatModuleCents(price.monthly_price_cents)}/mês · {price.contract_version} · {new Date(price.published_at).toLocaleDateString("pt-BR")}<br />Teste: {price.stripe_test_price_id} · Produção: {price.stripe_live_price_id}</p>)}
          </form>
        </section>

        <section className={styles.panel} aria-labelledby="organizations-title">
          <div className={styles.panelHeading}><div><h2 id="organizations-title">Organizações e assinaturas</h2><p>Status e marcos temporais vindos do banco.</p></div><span>{organizations.length} resultado(s)</span></div>
          <div className={styles.filters}>
            <label><span>Buscar tenant</span><div><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nome, slug ou UUID" /></div></label>
            <label><span>Filtrar por status</span><div><Filter size={16} /><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="ALL">Todos os status</option>{BILLING_STATUSES.map((status) => <option key={status} value={status}>{formatAdminStatus(status)}</option>)}<option value="MISSING">Sem assinatura</option></select></div></label>
          </div>

          {organizations.length === 0 ? <div className={styles.empty}><Search size={28} /><strong>Nenhuma organização encontrada</strong><p>Ajuste filtros ou aguarde primeiro tenant.</p></div> : <div className={styles.tableWrap}><table className={styles.table}>
            <thead><tr><th>Organização</th><th>Status / Stripe Price</th><th>Trial, período, carência e retenção</th><th>Acesso</th></tr></thead>
            <tbody>{organizations.map((organization) => {
              const subscription = subscriptionByOrganization.get(organization.id);
              const status = getStatus(organization.id);
              const immutableStatus = status === "CLOSED" || status === "CANCELED_RETENTION";
              return <tr key={organization.id}>
                <td data-label="Organização"><div className={styles.organization}><span>{organizationInitials(organization.name)}</span><div><strong>{organization.name}</strong><small>{organization.slug}</small><code>{organization.id}</code></div></div></td>
                <td data-label="Status"><StatusChip status={status} /><small className={styles.priceId}>Price: {subscription?.stripe_price_id ?? "não informado"}</small></td>
                <td data-label="Datas"><SubscriptionDates subscription={subscription} /></td>
                <td data-label="Acesso"><div className={styles.actions}><button type="button" aria-label={`Ver auditoria de ${organization.name}`} onClick={() => setAuditOrganizationId(organization.id)}><History size={15} /> Auditoria</button>{status && !immutableStatus && <button type="button" aria-label={`${status === "BLOCKED" ? "Reativar" : "Bloquear"} acesso de ${organization.name}`} className={status === "BLOCKED" ? styles.recoverButton : styles.blockButton} onClick={() => prepareAccessChange(organization, status)}>{status === "BLOCKED" ? <UnlockKeyhole size={15} /> : <LockKeyhole size={15} />}{status === "BLOCKED" ? "Reativar" : "Bloquear"}</button>}</div></td>
              </tr>;
            })}</tbody>
          </table></div>}
        </section>

        <section className={styles.panel} aria-labelledby="audit-title">
          <div className={styles.panelHeading}><div><h2 id="audit-title">Auditoria de acesso</h2><p>Eventos append-only. Últimos {data.accessEventLimit} registros no máximo.</p></div><label className={styles.auditFilter}><span>Organização</span><select value={auditOrganizationId} onChange={(event) => setAuditOrganizationId(event.target.value)}><option value="ALL">Todas</option>{data.organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select></label></div>
          {events.length === 0 ? <div className={styles.empty}><Activity size={28} /><strong>Nenhum evento de acesso</strong><p>Alterações de billing e bloqueios aparecerão aqui.</p></div> : <ol className={styles.auditList}>{events.map((event) => <li key={String(event.id)}><span><Activity size={16} /></span><div><strong>{organizationById.get(event.organization_id)?.name ?? event.organization_id}</strong><p><StatusChip status={event.from_status} /><b>→</b><StatusChip status={event.to_status} /></p><small>{event.reason}</small></div><time dateTime={event.created_at}>{formatAdminInstant(event.created_at)}</time></li>)}</ol>}
        </section>
      </>}
    </main>

    {accessChange && <div className={styles.dialogBackdrop} role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !submitting) setAccessChange(null); }}>
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="access-dialog-title">
        <button type="button" className={styles.dialogClose} aria-label="Fechar" disabled={submitting} onClick={() => setAccessChange(null)}><X size={18} /></button>
        <span className={accessChange.targetStatus === "BLOCKED" ? styles.dialogDangerIcon : styles.dialogSuccessIcon}>{accessChange.targetStatus === "BLOCKED" ? <LockKeyhole size={21} /> : <UnlockKeyhole size={21} />}</span>
        <h2 id="access-dialog-title">{accessChange.targetStatus === "BLOCKED" ? "Bloquear acesso" : "Reativar acesso"}</h2>
        <p><strong>{accessChange.organization.name}</strong> mudará de {formatAdminStatus(accessChange.currentStatus)} para {formatAdminStatus(accessChange.targetStatus)}. Evento será gravado na auditoria.</p>
        {mutationError && <p className={styles.dialogError} role="alert"><AlertTriangle size={15} />{mutationError}</p>}
        <label><span>Motivo obrigatório</span><textarea autoFocus maxLength={500} rows={4} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Descreva causa e referência operacional" /></label>
        <div className={styles.dialogActions}><button type="button" disabled={submitting} onClick={() => setAccessChange(null)}>Cancelar</button><button type="button" className={accessChange.targetStatus === "BLOCKED" ? styles.confirmDanger : styles.confirmSuccess} disabled={!reason.trim() || submitting} onClick={submitAccessChange}>{submitting ? "Salvando…" : "Confirmar e auditar"}</button></div>
      </section>
    </div>}
  </div>;
}

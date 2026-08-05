"use client";

import { Check, Download, LoaderCircle, LogOut, MessageCircle, Save, ShieldCheck, Trash2, UserRound, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getCustomerPrivacy,
  recordWhatsappConsent,
  submitPrivacyRequest,
  toClientError,
  upsertMyCustomer,
} from "@/components/connected-client/api";
import { useConnectedClient } from "@/components/connected-client/context";
import { formatInstant, initials, locationLabel } from "@/components/connected-client/format";
import { AuthPrompt, ConnectedClientGate } from "@/components/connected-client/state";
import type { PrivacyRequest } from "@/components/connected-client/types";
import styles from "@/components/connected-client/connected-client.module.css";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

export function ConnectedProfile() {
  return <ConnectedClientGate><ProfileContent /></ConnectedClientGate>;
}

function ProfileContent() {
  const { context, user, customer, authLoading, reloadCustomer, signOut } = useConnectedClient();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [whatsappGranted, setWhatsappGranted] = useState(false);
  const [requests, setRequests] = useState<PrivacyRequest[]>([]);
  const [loadingPrivacy, setLoadingPrivacy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [initializedIdentity, setInitializedIdentity] = useState("");
  const [confirmDeletion, setConfirmDeletion] = useState(false);

  useEffect(() => {
    if (!user) return;
    const identity = `${user.id}:${customer?.id ?? "new"}`;
    if (initializedIdentity === identity) return;
    queueMicrotask(() => {
      setFullName(customer?.full_name ?? String(user.user_metadata?.full_name ?? user.user_metadata?.name ?? ""));
      setPhone(customer?.phone_e164 ?? "");
      setEmail(customer?.email ?? user.email ?? "");
      setBirthDate(customer?.birth_date ?? "");
      setInitializedIdentity(identity);
    });
  }, [customer, initializedIdentity, user]);

  const loadPrivacy = useCallback(async () => {
    if (!supabase || !context || !customer) {
      setRequests([]);
      setWhatsappGranted(false);
      return;
    }
    setLoadingPrivacy(true);
    try {
      const result = await getCustomerPrivacy(supabase, context.organization.id, customer.id);
      setWhatsappGranted(result.whatsappGranted);
      setRequests(result.requests);
    } catch (cause: unknown) {
      setError(toClientError(cause, "Não foi possível carregar privacidade."));
    } finally {
      setLoadingPrivacy(false);
    }
  }, [context, customer, supabase]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) void loadPrivacy(); });
    return () => { active = false; };
  }, [loadPrivacy]);

  if (!context) return null;
  if (authLoading) return <div className={styles.state} role="status"><LoaderCircle className={styles.spin} /> Validando sessão…</div>;
  if (!user) return <AuthPrompt description="Entre para gerenciar seus dados, consentimentos e direitos LGPD." />;
  const organizationId = context.organization.id;

  async function saveProfile() {
    if (!supabase) return;
    if (fullName.trim().length < 2) {
      setError("Informe nome completo.");
      return;
    }
    if (!/^\+[1-9][0-9]{7,14}$/u.test(phone.trim())) {
      setError("Telefone deve estar em E.164. Exemplo: +5511999999999.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await upsertMyCustomer(supabase, {
        organizationId,
        fullName: fullName.trim(),
        phoneE164: phone.trim(),
        email: email.trim() || null,
        birthDate: birthDate || null,
      });
      await reloadCustomer();
      setNotice("Perfil atualizado.");
    } catch (cause: unknown) {
      setError(toClientError(cause, "Não foi possível salvar perfil."));
    } finally {
      setBusy(false);
    }
  }

  async function updateWhatsapp(next: boolean) {
    if (!supabase || !customer) {
      setError("Salve dados pessoais antes de alterar consentimento.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await recordWhatsappConsent(supabase, { organizationId, customerId: customer.id, granted: next });
      setWhatsappGranted(next);
      setNotice(next ? "WhatsApp transacional autorizado." : "WhatsApp transacional retirado imediatamente.");
      await loadPrivacy();
    } catch (cause: unknown) {
      setError(toClientError(cause, "Não foi possível atualizar consentimento."));
    } finally {
      setBusy(false);
    }
  }

  async function requestPrivacy(kind: PrivacyRequest["kind"]) {
    if (!supabase || !customer) {
      setError("Salve dados pessoais antes de abrir solicitação.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await submitPrivacyRequest(supabase, { organizationId, customerId: customer.id, kind });
      setNotice(kind === "EXPORT" ? "Pedido de exportação aberto." : "Pedido de exclusão aberto. Dados não são apagados imediatamente.");
      setConfirmDeletion(false);
      await loadPrivacy();
    } catch (cause: unknown) {
      setError(toClientError(cause, "Não foi possível abrir solicitação."));
    } finally {
      setBusy(false);
    }
  }

  const displayName = (customer?.full_name ?? fullName) || "Cliente";
  const exportPending = requests.some((request) => request.kind === "EXPORT" && ["OPEN", "IN_PROGRESS"].includes(request.status));
  const deletionPending = requests.some((request) => request.kind === "DELETION" && ["OPEN", "IN_PROGRESS"].includes(request.status));
  return (
    <div className={styles.profile}>
      <header className={styles.pageHeading}><span>Sua conta · {context.organization.name}</span><h1>Perfil e privacidade</h1><p>Dados ficam isolados neste tenant. Marketing não nasce de data de nascimento.</p></header>
      {notice && <div className={styles.notice} role="status"><Check size={17} /><span>{notice}</span><button type="button" onClick={() => setNotice("")} aria-label="Fechar aviso"><X size={15} /></button></div>}
      {error && <div className={styles.errorBox} role="alert"><strong>Ação não concluída</strong><span>{error}</span></div>}
      <div className={styles.profileGrid}>
        <aside className={styles.profileAside}>
          <span className={styles.profileAvatar}>{initials(displayName)}</span>
          <h2>{displayName}</h2>
          <p>{user.email}</p>
          <dl><div><dt>Barbearia</dt><dd>{context.organization.name}</dd></div><div><dt>Unidade</dt><dd>{context.location?.name ?? "Unidade"}</dd></div><div><dt>Endereço</dt><dd>{locationLabel(context.location?.address)}</dd></div></dl>
          <button type="button" className={styles.signOut} onClick={() => void signOut()}><LogOut size={16} /> Sair</button>
        </aside>
        <div className={styles.profileMain}>
          <section className={styles.panel}>
            <div className={styles.sectionTitle}><UserRound /><div><h2>Dados pessoais</h2><p>Usados para identificar reservas neste tenant.</p></div></div>
            <div className={styles.formGrid}><label>Nome completo<input value={fullName} onChange={(event) => setFullName(event.target.value)} autoComplete="name" /></label><label>Telefone E.164<input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+5511999999999" inputMode="tel" autoComplete="tel" /></label><label>E-mail<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" /></label><label>Nascimento <small>opcional</small><input type="date" value={birthDate} onChange={(event) => setBirthDate(event.target.value)} /></label></div>
            <button type="button" className={styles.primaryButton} disabled={busy} onClick={() => void saveProfile()}><Save size={16} /> {busy ? "Salvando…" : "Salvar dados"}</button>
          </section>
          <section className={styles.panel}>
            <div className={styles.sectionTitle}><MessageCircle /><div><h2>Comunicação</h2><p>Somente mensagens transacionais sobre reserva.</p></div></div>
            <div className={styles.consent}><div><strong>WhatsApp transacional</strong><p>Confirmação, lembrete e alteração de horário. Opt-out imediato.</p></div><label className={styles.switch}><input type="checkbox" checked={whatsappGranted} disabled={busy || loadingPrivacy || !customer} onChange={(event) => void updateWhatsapp(event.target.checked)} /><span /></label></div>
            <p className={styles.privacyNote}><ShieldCheck size={16} /> Marketing permanece desativado. Consentimento transacional não habilita campanhas.</p>
          </section>
          <section className={styles.panel}>
            <div className={styles.sectionTitle}><ShieldCheck /><div><h2>Direitos LGPD</h2><p>Pedidos ficam auditados e têm prazo operacional.</p></div></div>
            <div className={styles.privacyActions}><button type="button" className={styles.secondaryButton} disabled={busy || !customer || exportPending} onClick={() => void requestPrivacy("EXPORT")}><Download size={16} /> {exportPending ? "Exportação em andamento" : "Solicitar exportação"}</button><button type="button" className={styles.dangerOutline} disabled={busy || !customer || deletionPending} onClick={() => setConfirmDeletion(true)}><Trash2 size={16} /> {deletionPending ? "Exclusão em análise" : "Solicitar exclusão"}</button></div>
            {loadingPrivacy ? <p className={styles.loadingLine}><LoaderCircle className={styles.spin} /> Carregando solicitações…</p> : requests.length > 0 && <div className={styles.requestList}><h3>Solicitações</h3>{requests.map((request) => <article key={request.id}><span>{request.kind}</span><strong>{request.status.replaceAll("_", " ")}</strong><small>{formatInstant(request.requested_at, context.organization.timezone)}</small></article>)}</div>}
          </section>
        </div>
      </div>
      {confirmDeletion && <div className={styles.modalLayer}><button type="button" className={styles.backdrop} onClick={() => setConfirmDeletion(false)} aria-label="Fechar confirmação" /><section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="delete-request-title"><button type="button" className={styles.modalClose} onClick={() => setConfirmDeletion(false)} aria-label="Fechar"><X /></button><Trash2 className={styles.warning} /><h2 id="delete-request-title">Solicitar exclusão?</h2><p>Isso abre pedido LGPD. Retenção legal e compromissos ativos serão avaliados; exclusão não ocorre neste clique.</p><footer><button type="button" className={styles.secondaryButton} onClick={() => setConfirmDeletion(false)}>Voltar</button><button type="button" className={styles.dangerButton} disabled={busy} onClick={() => void requestPrivacy("DELETION")}>Abrir solicitação</button></footer></section></div>}
    </div>
  );
}

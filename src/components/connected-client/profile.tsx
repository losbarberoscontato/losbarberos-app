"use client";

import { Check, ChevronRight, Download, LoaderCircle, LogOut, MessageCircle, Pencil, Save, Search, ShieldCheck, Trash2, UserRound, UserPlus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getCustomerPrivacy,
  listCustomerDependents,
  createCustomerDependent,
  updateCustomerDependent,
  deleteCustomerDependent,
  recordWhatsappConsent,
  submitPrivacyRequest,
  toClientError,
  upsertMyClientAccount,
} from "@/components/connected-client/api";
import { useConnectedClient } from "@/components/connected-client/context";
import { formatInstant, initials, locationLabel } from "@/components/connected-client/format";
import { AuthPrompt, ConnectedClientGate } from "@/components/connected-client/state";
import type { CustomerDependent, PrivacyRequest } from "@/components/connected-client/types";
import styles from "@/components/connected-client/connected-client.module.css";
import { formatBirthDateInput, normalizeBirthDateInput, parseBirthDateInput } from "@/lib/birth-date";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cpfCnpjDigits, formatCpfCnpj, isCpfCnpjValid } from "@/lib/cpf-cnpj";

export function ConnectedProfile() {
  return <ConnectedClientGate><ProfileContent /></ConnectedClientGate>;
}

function ProfileContent() {
  const { context, user, account, customer, organizations, authLoading, reloadCustomer, selectTenant, signOut } = useConnectedClient();
  const profileIdentity = user ? `${user.id}:${account?.auth_user_id ?? "new"}` : "";
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [whatsappGranted, setWhatsappGranted] = useState(false);
  const [marketingGranted, setMarketingGranted] = useState(false);
  const [requests, setRequests] = useState<PrivacyRequest[]>([]);
  const [loadingPrivacy, setLoadingPrivacy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [initializedIdentity, setInitializedIdentity] = useState("");
  const [confirmDeletion, setConfirmDeletion] = useState(false);
  const [searchSlug, setSearchSlug] = useState("");
  const [cpfCnpj, setCpfCnpj] = useState("");
  const [personalOpen, setPersonalOpen] = useState(true);
  const [dependents, setDependents] = useState<CustomerDependent[]>([]);
  const [dependentsOpen, setDependentsOpen] = useState(false);
  const [dependentDraft, setDependentDraft] = useState<{ id?: string; fullName: string; birthDate: string; relationship: CustomerDependent["relationship"] }>({ fullName: "", birthDate: "", relationship: "CHILD" });

  useEffect(() => {
    if (!user) return;
    if (initializedIdentity === profileIdentity) return;
    queueMicrotask(() => {
      setFullName(account?.full_name ?? String(user.user_metadata?.full_name ?? user.user_metadata?.name ?? ""));
      setPhone(account?.phone_e164 ?? "");
      setBirthDate(formatBirthDateInput(account?.birth_date));
      setCpfCnpj(account?.cpf_cnpj ?? "");
      setInitializedIdentity(profileIdentity);
    });
  }, [account, initializedIdentity, profileIdentity, user]);

  const loadDependents = useCallback(async () => {
    if (!supabase || !context || !customer) return setDependents([]);
    try { setDependents(await listCustomerDependents(supabase, context.organization.id, customer.id)); }
    catch (cause: unknown) { setError(toClientError(cause, "Não foi possível carregar dependentes.")); }
  }, [context, customer, supabase]);

  useEffect(() => { queueMicrotask(() => { void loadDependents(); }); }, [loadDependents]);

  const loadPrivacy = useCallback(async () => {
    if (!supabase || !context || !customer) {
      setRequests([]);
      setWhatsappGranted(false);
      setMarketingGranted(false);
      return;
    }
    setLoadingPrivacy(true);
    try {
      const result = await getCustomerPrivacy(supabase, context.organization.id, customer.id);
      setWhatsappGranted(result.whatsappGranted);
      setMarketingGranted(result.marketingGranted);
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
  if (initializedIdentity !== profileIdentity) return <div className={styles.state} role="status"><LoaderCircle className={styles.spin} /> Carregando dados do perfil…</div>;
  const organizationId = context.organization.id;

  async function saveProfile() {
    if (!supabase || !account) return;
    const phoneE164 = phone.trim() || account.phone_e164;
    const parsedBirthDate = birthDate ? parseBirthDateInput(birthDate) : null;
    if (fullName.trim().length < 2) {
      setError("Informe nome completo.");
      return;
    }
    if (!/^\+[1-9][0-9]{7,14}$/u.test(phoneE164)) {
      setError("Telefone deve estar em E.164. Exemplo: +5511999999999.");
      return;
    }
    if (birthDate && !parsedBirthDate) {
      setError("Informe a data de nascimento no formato DD/MM/AAAA.");
      return;
    }
    if (!isCpfCnpjValid(cpfCnpj)) { setError("CPF/CNPJ deve ter 11 ou 14 dígitos."); return; }
    setBusy(true);
    setError("");
    try {
      await upsertMyClientAccount(supabase, {
        fullName: fullName.trim(),
        phoneE164,
        birthDate: parsedBirthDate,
        termsPolicyVersion: account.terms_policy_version,
        cpfCnpj: cpfCnpjDigits(cpfCnpj) || null,
      });
      await reloadCustomer();
      setNotice("Perfil atualizado.");
    } catch (cause: unknown) {
      setError(toClientError(cause, "Não foi possível salvar perfil."));
    } finally {
      setBusy(false);
    }
  }

  function dependentAge(value: string) {
    if (!value) return "—";
    const birth = new Date(`${value}T12:00:00`); const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    if (today < new Date(today.getFullYear(), birth.getMonth(), birth.getDate())) age -= 1;
    return `${Math.max(0, age)} ${Math.max(0, age) === 1 ? "ano" : "anos"}`;
  }
  async function saveDependent() {
    if (!supabase || !context || !customer || !dependentDraft.fullName.trim() || !dependentDraft.birthDate) return;
    setBusy(true); setError("");
    try {
      const input = { organizationId: context.organization.id, customerId: customer.id, fullName: dependentDraft.fullName.trim(), birthDate: dependentDraft.birthDate, relationship: dependentDraft.relationship };
      if (dependentDraft.id) await updateCustomerDependent(supabase, { ...input, dependentId: dependentDraft.id }); else await createCustomerDependent(supabase, input);
      setDependentDraft({ fullName: "", birthDate: "", relationship: "CHILD" }); await loadDependents(); setNotice("Dependente salvo.");
    } catch (cause: unknown) { setError(toClientError(cause, "Não foi possível salvar dependente.")); }
    finally { setBusy(false); }
  }
  async function removeDependent(id: string) {
    if (!supabase || !context) return; setBusy(true); setError("");
    try { await deleteCustomerDependent(supabase, context.organization.id, id); await loadDependents(); setNotice("Dependente removido."); }
    catch (cause: unknown) { setError(toClientError(cause, "Não foi possível excluir dependente.")); }
    finally { setBusy(false); }
  }

  async function updateWhatsapp(next: boolean, marketing = false) {
    if (!supabase || !customer) {
      setError("Salve dados pessoais antes de alterar consentimento.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await recordWhatsappConsent(supabase, { organizationId, customerId: customer.id, granted: next, kind: marketing ? "MARKETING" : "WHATSAPP_TRANSACTIONAL" });
      if (marketing) setMarketingGranted(next); else setWhatsappGranted(next);
      setNotice(next ? "Preferência de comunicação ativada." : "Preferência de comunicação desativada.");
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
  const logoUrl = (path: string | null | undefined) => path
    ? supabase?.storage.from("organization-logos").getPublicUrl(path).data.publicUrl ?? null
    : null;
  return (
    <div className={styles.profile}>
      <header className={styles.pageHeading}><span>Sua conta · {context.organization.name}</span><h1>Perfil e privacidade</h1><p>Gerencie seus dados e preferências de comunicação nesta barbearia.</p></header>
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
            <button type="button" className={styles.sectionToggle} onClick={() => setPersonalOpen((value) => !value)} aria-expanded={personalOpen}><ChevronRight size={18} className={personalOpen ? styles.sectionToggleOpen : ""} /> <UserRound /><span><strong>Dados pessoais</strong><small>Aplicados em todas as barbearias vinculadas à sua conta.</small></span></button>
            {personalOpen && <><div className={styles.formGrid}><label>Nome completo<input value={fullName} onChange={(event) => setFullName(event.target.value)} autoComplete="name" /></label><label>CPF/CNPJ<input value={cpfCnpj} onChange={(event) => setCpfCnpj(formatCpfCnpj(event.target.value))} placeholder="CPF ou CNPJ" inputMode="numeric" /></label><label>Telefone E.164<input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+5511999999999" inputMode="tel" autoComplete="tel" /></label><label>E-mail <small>gerenciado pela autenticação</small><input type="email" value={user.email ?? ""} disabled autoComplete="email" /></label><label>Data de nascimento <small>opcional · DD/MM/AAAA</small><input type="text" value={birthDate} onChange={(event) => setBirthDate(normalizeBirthDateInput(event.target.value))} placeholder="DD/MM/AAAA" inputMode="numeric" autoComplete="bday" maxLength={10} /></label></div><button type="button" className={styles.primaryButton} disabled={busy} onClick={() => void saveProfile()}><Save size={16} /> {busy ? "Salvando…" : "Salvar dados"}</button></>}
          </section>
          <section className={`${styles.panel} ${styles.dependentsPanel}`}>
            <button type="button" className={styles.sectionToggle} onClick={() => setDependentsOpen((value) => !value)} aria-expanded={dependentsOpen}><span className={styles.sectionToggleLead}><ChevronRight size={18} className={dependentsOpen ? styles.sectionToggleOpen : ""} /><UserPlus /></span><span><strong>Dependentes</strong><small>Até 8 pessoas cadastradas para atendimento.</small></span><span className={styles.dependentsCount}>{dependents.length}/8</span></button>
            {dependentsOpen && <div className={styles.dependentsContent}>
              <div className={styles.dependentsForm}>
                <label>Nome<input value={dependentDraft.fullName} onChange={(event) => setDependentDraft((d) => ({ ...d, fullName: event.target.value }))} placeholder="Nome completo" /></label>
                <label>Data de nascimento<input aria-label="Data de nascimento do dependente" type="date" value={dependentDraft.birthDate} onChange={(event) => setDependentDraft((d) => ({ ...d, birthDate: event.target.value }))} /></label>
                <span className={styles.dependentAge}><small>Idade calculada</small><strong>{dependentDraft.birthDate ? `${dependentAge(dependentDraft.birthDate)} anos` : "—"}</strong></span>
                <label>Parentesco<select value={dependentDraft.relationship} onChange={(event) => setDependentDraft((d) => ({ ...d, relationship: event.target.value as CustomerDependent["relationship"] }))}><option value="CHILD">Filho(a)</option><option value="SPOUSE">Cônjuge</option><option value="EMPLOYEE">Funcionário</option><option value="PARENT">Pai/Mãe</option><option value="OTHER">Outros</option></select></label>
                <button type="button" className={styles.primaryButton} disabled={busy || dependents.length >= 8 && !dependentDraft.id} onClick={() => void saveDependent()}><Save size={16} /> {dependentDraft.id ? "Salvar alteração" : "Adicionar dependente"}</button>
              </div>
              {dependents.length > 0 ? <div className={styles.dependentsTable} role="table" aria-label="Dependentes cadastrados">
                <div className={styles.dependentsTableHead} role="row"><span>Nome</span><span>Nascimento</span><span>Idade</span><span>Parentesco</span><span className="sr-only">Ações</span></div>
                {dependents.map((item) => <div className={styles.dependentsTableRow} role="row" key={item.id}><span><strong>{item.full_name}</strong></span><span>{item.birth_date}</span><span>{dependentAge(item.birth_date)} anos</span><span>{({ CHILD: "Filho(a)", SPOUSE: "Cônjuge", EMPLOYEE: "Funcionário", PARENT: "Pai/Mãe", OTHER: "Outros" } as Record<string, string>)[item.relationship]}</span><span className={styles.dependentActions}><button type="button" className={styles.iconButtonSmall} aria-label={`Editar ${item.full_name}`} onClick={() => setDependentDraft({ id: item.id, fullName: item.full_name, birthDate: item.birth_date, relationship: item.relationship })}><Pencil size={15} /></button><button type="button" className={`${styles.iconButtonSmall} ${styles.iconButtonDanger}`} aria-label={`Excluir ${item.full_name}`} onClick={() => void removeDependent(item.id)}><Trash2 size={15} /></button></span></div>)}
              </div> : <div className={styles.dependentsEmpty}><UserPlus size={19} /><span><strong>Nenhum dependente cadastrado</strong><small>Adicione alguém que poderá ser atendido no lugar do cliente.</small></span></div>}
            </div>}
          </section>
          <section className={styles.panel} aria-labelledby="linked-organizations-title">
            <div className={styles.sectionTitle}><Search /><div><h2 id="linked-organizations-title">Minhas barbearias</h2><p>Conecte-se às barbearias que você já usa no Los Barberos.</p></div></div>
            <form className={styles.formGrid} onSubmit={(event) => { event.preventDefault(); if (searchSlug.trim()) selectTenant(searchSlug); }}>
              <label>Conectar a outra barbearia<input value={searchSlug} onChange={(event) => setSearchSlug(event.target.value)} placeholder="slug-da-barbearia" autoComplete="off" /></label>
              <button type="submit" className={styles.primaryButton}>Pesquisar por slug</button>
            </form>
            <div className={styles.organizationList}>
              {organizations.map((item) => <article className={styles.organizationCard} key={item.organization_id}>
                {logoUrl(item.logo_path) ? <img src={logoUrl(item.logo_path)!} alt="" /> : <span className={styles.organizationLogoFallback}>{initials(item.organization_name)}</span>}
                <div><strong>{item.organization_name}</strong><small>{item.location?.name ?? "Unidade"}</small><small>{locationLabel(item.location?.address)}</small>{item.public_contact_phone_e164 && <small>WhatsApp: {item.public_contact_phone_e164}</small>}</div>
                <button type="button" className={styles.secondaryButton} disabled={item.organization_slug === context.organization.slug} onClick={() => selectTenant(item.organization_slug)}>{item.organization_slug === context.organization.slug ? "Conectado" : "Conectar"}</button>
              </article>)}
              {!organizations.length && <p className={styles.empty}>Nenhuma barbearia conectada ainda.</p>}
            </div>
          </section>
          <section className={styles.panel}>
            <div className={styles.sectionTitle}><MessageCircle /><div><h2>Comunicação</h2><p>Controle avisos da reserva e mensagens personalizadas separadamente.</p></div></div>
            <div className={styles.consent}><div><strong>WhatsApp transacional</strong><p>Confirmação, lembrete e alteração de horário. Opt-out imediato.</p></div><label className={styles.switch}><input type="checkbox" checked={whatsappGranted} disabled={busy || loadingPrivacy || !customer} onChange={(event) => void updateWhatsapp(event.target.checked)} /><span /></label></div>
            <div className={styles.consent}><div><strong>Marketing e mensagens personalizadas</strong><p>Felicitações, retorno após atendimento e promoções. Pode desativar a qualquer momento.</p></div><label className={styles.switch}><input aria-label="Marketing e mensagens personalizadas" type="checkbox" checked={marketingGranted} disabled={busy || loadingPrivacy || !customer} onChange={(event) => void updateWhatsapp(event.target.checked, true)} /><span /></label></div>
            <p className={styles.privacyNote}><ShieldCheck size={16} /> Preferências independentes. Desativar marketing mantém seus avisos de reserva.</p>
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

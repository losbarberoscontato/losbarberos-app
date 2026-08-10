"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Scissors } from "lucide-react";
import styles from "@/components/connected-client/connected-client.module.css";
import { clientAuthDestination, clientSignupSchema } from "@/lib/client-auth";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

const termsPolicyVersion = "client-access-2026-08";
const clientProfileSchema = clientSignupSchema.pick({
  fullName: true,
  phoneE164: true,
  birthDate: true,
  acceptedTerms: true,
});

type AuthMode = "signin" | "signup" | "recovery" | "complete";

type ClientProfile = {
  fullName: string;
  phoneE164: string;
  birthDate: string;
  termsPolicyVersion: string;
};

function safeMetadataProfile(metadata: unknown): ClientProfile | null {
  if (!metadata || typeof metadata !== "object") return null;
  const value = metadata as Record<string, unknown>;
  const fullName = typeof value.full_name === "string" ? value.full_name : "";
  const phoneE164 = typeof value.phone_e164_candidate === "string" ? value.phone_e164_candidate : "";
  const birthDate = typeof value.birth_date === "string" ? value.birth_date : "";
  const metadataTermsPolicy = typeof value.terms_policy_version === "string"
    ? value.terms_policy_version.trim()
    : "";
  const parsed = clientProfileSchema.safeParse({
    fullName,
    phoneE164,
    birthDate,
    acceptedTerms: true,
  });

  if (!parsed.success || metadataTermsPolicy !== termsPolicyVersion) return null;
  return { ...parsed.data, termsPolicyVersion };
}

export function ClientAuthForm({
  initialSlug,
  initialNext,
}: {
  initialSlug: string | null;
  initialNext: string | null;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phoneE164, setPhoneE164] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  const destination = clientAuthDestination({ next: initialNext, slug: initialSlug });

  function clearMessages() {
    setError("");
    setSuccess("");
  }

  function selectMode(nextMode: "signin" | "signup") {
    clearMessages();
    setMode(nextMode);
  }

  function callbackUrl(): string {
    const resolved = new URL(destination, "https://cliente.local");
    const callbackParams = new URLSearchParams({ next: resolved.pathname });
    const slug = resolved.searchParams.get("barbearia");
    if (slug) callbackParams.set("barbearia", slug);
    return `${window.location.origin}/auth/callback?${callbackParams.toString()}`;
  }

  function onlineClient() {
    const supabase = getSupabaseBrowserClient();
    if (supabase) return supabase;
    setError("Acesso online indisponível.");
    return null;
  }

  async function saveGlobalAccount(profile: ClientProfile) {
    const supabase = onlineClient();
    if (!supabase) return;
    const { error: rpcError } = await supabase.rpc("upsert_my_client_account", {
      p_full_name: profile.fullName,
      p_phone_e164: profile.phoneE164,
      p_birth_date: profile.birthDate,
      p_terms_policy_version: profile.termsPolicyVersion,
    });
    if (rpcError) {
      setError("Não foi possível concluir acesso. Tente novamente.");
      return;
    }
    router.push(destination);
  }

  async function submitSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearMessages();
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !password) {
      setError("Informe e-mail e senha para continuar.");
      return;
    }
    const supabase = onlineClient();
    if (!supabase) return;

    setBusy(true);
    const { data, error: authError } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });
    setBusy(false);
    if (authError || !data.session || !data.user) {
      setError("Não foi possível concluir acesso. Verifique seus dados ou tente novamente.");
      return;
    }

    const profile = safeMetadataProfile(data.user.user_metadata);
    if (!profile) {
      setEmail(typeof data.user.email === "string" ? data.user.email : normalizedEmail);
      setFullName(typeof data.user.user_metadata.full_name === "string" ? data.user.user_metadata.full_name : "");
      setMode("complete");
      setSuccess("Confirme seus dados para concluir o cadastro.");
      return;
    }

    await saveGlobalAccount(profile);
  }

  async function submitSignUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearMessages();
    const parsed = clientSignupSchema.safeParse({
      fullName,
      phoneE164,
      email,
      password,
      birthDate,
      acceptedTerms,
    });
    if (!parsed.success) {
      setError("Revise os dados cadastrais e tente novamente.");
      return;
    }
    const supabase = onlineClient();
    if (!supabase) return;

    setBusy(true);
    const { error: authError } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        data: {
          full_name: parsed.data.fullName,
          phone_e164_candidate: parsed.data.phoneE164,
          birth_date: parsed.data.birthDate,
          terms_policy_version: termsPolicyVersion,
        },
        emailRedirectTo: callbackUrl(),
      },
    });
    setBusy(false);
    if (authError) {
      setError("Não foi possível criar ou acessar a conta. Tente novamente.");
      return;
    }
    setEmail(parsed.data.email);
    setSuccess("Confira seu e-mail para confirmar sua conta antes de entrar.");
  }

  async function submitRecovery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearMessages();
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setError("Informe um e-mail válido para continuar.");
      return;
    }
    const supabase = onlineClient();
    if (!supabase) return;

    setBusy(true);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
      redirectTo: callbackUrl(),
    });
    setBusy(false);
    if (resetError) {
      setError("Não foi possível concluir solicitação. Tente novamente.");
      return;
    }
    setSuccess("Se houver uma conta elegível, enviaremos instruções para seu e-mail.");
  }

  async function resendConfirmation() {
    clearMessages();
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setError("Informe um e-mail válido para continuar.");
      return;
    }
    const supabase = onlineClient();
    if (!supabase) return;

    setBusy(true);
    const { error: resendError } = await supabase.auth.resend({
      type: "signup",
      email: normalizedEmail,
      options: { emailRedirectTo: callbackUrl() },
    });
    setBusy(false);
    if (resendError) {
      setError("Não foi possível concluir solicitação. Tente novamente.");
      return;
    }
    setSuccess("Se houver uma conta pendente, enviaremos nova confirmação.");
  }

  async function submitCompletion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearMessages();
    const parsed = clientProfileSchema.safeParse({ fullName, phoneE164, birthDate, acceptedTerms });
    if (!parsed.success) {
      setError("Revise os dados cadastrais e tente novamente.");
      return;
    }
    setBusy(true);
    await saveGlobalAccount({ ...parsed.data, termsPolicyVersion });
    setBusy(false);
  }

  const isSignUp = mode === "signup";
  const isRecovery = mode === "recovery";
  const isComplete = mode === "complete";
  const formName = isSignUp ? "Criar conta" : isRecovery ? "Recuperar senha" : isComplete ? "Completar cadastro" : "Entrar";

  return (
    <section className={styles.authForm} aria-labelledby="client-auth-title">
      <span className={styles.userMark} aria-hidden="true"><Scissors size={22} /></span>
      <p className={styles.authKicker}>Acesso do cliente</p>
      <h1 id="client-auth-title">{isComplete ? "Complete seu cadastro" : "Acesse sua barbearia"}</h1>
      <p className={styles.authDescription}>
        {isRecovery
          ? "Enviaremos instruções apenas se houver uma conta elegível."
          : isComplete
            ? "Seus dados globais são usados somente após confirmação segura."
            : "Entre ou crie sua conta com e-mail e senha."}
      </p>

      {!isComplete && (
        <div className={styles.authTabs} role="tablist" aria-label="Modo de acesso">
          <button type="button" role="tab" aria-selected={mode === "signin"} onClick={() => selectMode("signin")}>Entrar</button>
          <button type="button" role="tab" aria-selected={isSignUp} onClick={() => selectMode("signup")}>Criar conta</button>
        </div>
      )}

      {error && <p className={styles.error} role="alert" aria-live="assertive">{error}</p>}
      {success && <p className={styles.notice} role="status" aria-live="polite">{success}</p>}

      <form className={styles.authFields} aria-label={formName} onSubmit={isSignUp ? submitSignUp : isRecovery ? submitRecovery : isComplete ? submitCompletion : submitSignIn}>
        {(isSignUp || isComplete) && (
          <>
            <label htmlFor="client-full-name">Nome completo
              <input id="client-full-name" value={fullName} onChange={(event) => setFullName(event.target.value)} required autoComplete="name" />
            </label>
            <label htmlFor="client-phone">Telefone (E.164)
              <input id="client-phone" value={phoneE164} onChange={(event) => setPhoneE164(event.target.value)} required placeholder="+5511999999999" autoComplete="tel" />
            </label>
          </>
        )}
        {!isComplete && (
          <label htmlFor="client-email">E-mail
            <input id="client-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" />
          </label>
        )}
        {!isRecovery && !isComplete && (
          <label htmlFor="client-password">Senha
            <input id="client-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete={isSignUp ? "new-password" : "current-password"} />
          </label>
        )}
        {(isSignUp || isComplete) && (
          <>
            <label htmlFor="client-birth-date">Data de nascimento
              <input id="client-birth-date" type="date" value={birthDate} onChange={(event) => setBirthDate(event.target.value)} required autoComplete="bday" />
            </label>
            <label className={styles.authTerms} htmlFor="client-terms">
              <input id="client-terms" type="checkbox" checked={acceptedTerms} onChange={(event) => setAcceptedTerms(event.target.checked)} required />
              Aceito os termos de uso e a política de privacidade
            </label>
          </>
        )}
        <button className={styles.primaryButton} type="submit" disabled={busy} aria-busy={busy}>{busy ? "Aguarde…" : formName}</button>
      </form>

      {mode === "signin" && <button className={styles.textButton} type="button" onClick={() => { clearMessages(); setMode("recovery"); }}>Esqueci minha senha</button>}
      {isSignUp && <button className={styles.textButton} type="button" disabled={busy} onClick={() => void resendConfirmation()}>Reenviar confirmação</button>}
      {(isRecovery || isComplete) && <button className={styles.textButton} type="button" onClick={() => selectMode("signin")}>Voltar para entrar</button>}
    </section>
  );
}

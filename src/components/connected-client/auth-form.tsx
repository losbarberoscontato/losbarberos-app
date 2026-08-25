"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, LoaderCircle, MessageCircle, Scissors } from "lucide-react";
import styles from "@/components/connected-client/connected-client.module.css";
import { getMyClientAccount } from "@/components/connected-client/api";
import { GoogleMark } from "@/components/google-mark";
import { formatBirthDateInput, normalizeBirthDateInput, parseBirthDateInput } from "@/lib/birth-date";
import { clientAuthDestination, clientPasswordSchema, clientSignupSchema } from "@/lib/client-auth";
import { normalizePhoneE164 } from "@/lib/phone";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

const termsPolicyVersion = "client-access-2026-08";
const neutralSignupMessage = "Se o cadastro puder ser concluído, enviaremos instruções para seu e-mail.";
const neutralRecoveryMessage = "Se houver uma conta elegível, enviaremos instruções para seu e-mail.";
const neutralResendMessage = "Se houver uma conta pendente, enviaremos nova confirmação.";
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

function metadataString(metadata: unknown, field: string): string {
  if (!metadata || typeof metadata !== "object") return "";
  const value = (metadata as Record<string, unknown>)[field];
  return typeof value === "string" ? value : "";
}

function useExclusiveMutation() {
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);

  const runMutation = useCallback(async (
    mutation: () => Promise<void>,
    onRejected: () => void,
  ) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await mutation();
    } catch {
      onRejected();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, []);

  return { busy, runMutation };
}

export function ClientAuthForm({
  initialSlug,
  initialNext,
  oauthCompletion = false,
}: {
  initialSlug: string | null;
  initialNext: string | null;
  oauthCompletion?: boolean;
}) {
  const { push } = useRouter();
  const [mode, setMode] = useState<AuthMode>(oauthCompletion ? "complete" : "signin");
  const [oauthChecking, setOauthChecking] = useState(oauthCompletion);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [fullName, setFullName] = useState("");
  const [phoneE164, setPhoneE164] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const { busy, runMutation } = useExclusiveMutation();

  const destination = clientAuthDestination({ next: initialNext, slug: initialSlug });

  function clearMessages() {
    setError("");
    setSuccess("");
  }

  function selectMode(nextMode: "signin" | "signup") {
    clearMessages();
    setMode(nextMode);
  }

  function callbackUrl(provider?: "google"): string {
    const currentDestination = new URL(destination, "https://cliente.local");
    const safeDestination = clientAuthDestination({
      next: `${currentDestination.pathname}${currentDestination.search}`,
      slug: currentDestination.searchParams.get("barbearia"),
    });
    const resolved = new URL(safeDestination, "https://cliente.local");
    const nextParams = new URLSearchParams(resolved.searchParams);
    nextParams.delete("barbearia");
    const nextQuery = nextParams.toString();
    const callbackParams = new URLSearchParams({
      next: nextQuery ? `${resolved.pathname}?${nextQuery}` : resolved.pathname,
    });
    const slug = resolved.searchParams.get("barbearia");
    if (slug) callbackParams.set("barbearia", slug);
    if (provider) callbackParams.set("provider", provider);
    return `${window.location.origin}/auth/callback?${callbackParams.toString()}`;
  }

  function recoveryRedirectUrl(): string {
    const currentDestination = new URL(destination, "https://cliente.local");
    const recoveryUrl = new URL("/cliente/redefinir-senha", window.location.origin);
    const slug = currentDestination.searchParams.get("barbearia");
    if (slug) recoveryUrl.searchParams.set("barbearia", slug);
    return recoveryUrl.toString();
  }

  function onlineClient() {
    const supabase = getSupabaseBrowserClient();
    if (supabase) return supabase;
    setError("Acesso online indisponível.");
    return null;
  }

  async function saveGlobalAccount(
    supabase: NonNullable<ReturnType<typeof getSupabaseBrowserClient>>,
    profile: ClientProfile,
  ) {
    const { error: rpcError } = await supabase.rpc("upsert_my_client_account", {
      p_full_name: profile.fullName,
      p_phone_e164: profile.phoneE164,
      p_birth_date: profile.birthDate,
      p_terms_policy_version: profile.termsPolicyVersion,
    });
    if (rpcError) {
      setError("Não foi possível concluir acesso. Tente novamente.");
      return false;
    }
    push(destination);
    return true;
  }

  useEffect(() => {
    if (!oauthCompletion) return;
    const supabase = getSupabaseBrowserClient();
    let active = true;

    if (!supabase) {
      queueMicrotask(() => {
        if (!active) return;
        setMode("signin");
        setOauthChecking(false);
        setError("Acesso online indisponível.");
      });
      return () => { active = false; };
    }

    void (async () => {
      const { data, error: userError } = await supabase.auth.getUser();
      if (userError || !data.user) throw new Error("Sessão Google não encontrada.");
      const existingAccount = await getMyClientAccount(supabase, data.user.id);
      if (!active) return;
      if (existingAccount) {
        push(destination);
        return;
      }

      const metadata = data.user.user_metadata;
      const metadataTerms = metadataString(metadata, "terms_policy_version") === termsPolicyVersion;
      setEmail(typeof data.user.email === "string" ? data.user.email : "");
      setFullName(metadataString(metadata, "full_name") || metadataString(metadata, "name"));
      setPhoneE164(metadataString(metadata, "phone_e164_candidate"));
      setBirthDate(formatBirthDateInput(metadataString(metadata, "birth_date")));
      setAcceptedTerms(metadataTerms);
      setMode("complete");
      setSuccess("Informe WhatsApp e data de nascimento para concluir seu primeiro acesso.");
      setOauthChecking(false);
    })().catch(() => {
      if (!active) return;
      setMode("signin");
      setOauthChecking(false);
      setError("Não foi possível validar sua conta Google. Tente novamente.");
    });

    return () => { active = false; };
  }, [destination, oauthCompletion, push]);

  async function continueWithGoogle() {
    clearMessages();
    const supabase = onlineClient();
    if (!supabase) return;

    await runMutation(async () => {
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: callbackUrl("google") },
      });
      if (oauthError) setError("Não foi possível iniciar o Google. Tente novamente.");
    }, () => setError("Não foi possível iniciar o Google. Tente novamente."));
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

    await runMutation(async () => {
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });
      if (authError || !data.session || !data.user) {
        setError("Não foi possível concluir acesso. Verifique seus dados ou tente novamente.");
        return;
      }

      const existingAccount = typeof (supabase as unknown as { from?: unknown }).from === "function"
        ? await getMyClientAccount(supabase, data.user.id)
        : null;
      if (existingAccount) {
        push(destination);
        return;
      }

      const profile = safeMetadataProfile(data.user.user_metadata);
      if (!profile) {
        setEmail(typeof data.user.email === "string" ? data.user.email : normalizedEmail);
        setFullName(metadataString(data.user.user_metadata, "full_name"));
        setBirthDate(formatBirthDateInput(metadataString(data.user.user_metadata, "birth_date")));
        setMode("complete");
        setSuccess("Confirme seus dados para concluir o cadastro.");
        return;
      }

      await saveGlobalAccount(supabase, profile);
    }, () => setError("Não foi possível concluir acesso. Tente novamente."));
  }

  async function submitSignUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearMessages();
    const normalizedPhone = normalizePhoneE164(phoneE164);
    const parsedBirthDate = parseBirthDateInput(birthDate);
    const parsed = clientSignupSchema.safeParse({
      fullName,
      phoneE164: normalizedPhone ?? phoneE164,
      email,
      password,
      birthDate: parsedBirthDate ?? birthDate,
      acceptedTerms,
    });
    if (!parsed.success) {
      setError("Revise os dados cadastrais e tente novamente.");
      return;
    }
    const supabase = onlineClient();
    if (!supabase) return;

    const showNeutralSignupResult = () => {
      setEmail(parsed.data.email);
      setSuccess(neutralSignupMessage);
    };
    await runMutation(async () => {
      await supabase.auth.signUp({
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
      showNeutralSignupResult();
    }, showNeutralSignupResult);
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

    const showNeutralRecoveryResult = () => setSuccess(neutralRecoveryMessage);
    await runMutation(async () => {
      await supabase.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo: recoveryRedirectUrl(),
      });
      showNeutralRecoveryResult();
    }, showNeutralRecoveryResult);
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

    const showNeutralResendResult = () => setSuccess(neutralResendMessage);
    await runMutation(async () => {
      await supabase.auth.resend({
        type: "signup",
        email: normalizedEmail,
        options: { emailRedirectTo: callbackUrl() },
      });
      showNeutralResendResult();
    }, showNeutralResendResult);
  }

  async function submitCompletion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearMessages();
    const normalizedPhone = normalizePhoneE164(phoneE164);
    const parsedBirthDate = parseBirthDateInput(birthDate);
    const parsed = clientProfileSchema.safeParse({ fullName, phoneE164: normalizedPhone ?? phoneE164, birthDate: parsedBirthDate ?? birthDate, acceptedTerms });
    if (!parsed.success) {
      setError("Revise os dados cadastrais e tente novamente.");
      return;
    }
    const supabase = onlineClient();
    if (!supabase) return;
    await runMutation(
      () => saveGlobalAccount(supabase, { ...parsed.data, termsPolicyVersion }).then(() => undefined),
      () => setError("Não foi possível concluir acesso. Tente novamente."),
    );
  }

  const isSignUp = mode === "signup";
  const isRecovery = mode === "recovery";
  const isComplete = mode === "complete";
  const formName = isSignUp ? "Criar conta" : isRecovery ? "Recuperar senha" : isComplete ? "Completar cadastro" : "Entrar";

  if (oauthChecking) {
    return (
      <section className={styles.authForm} aria-label="Validando acesso Google">
        <div className={styles.oauthChecking} role="status">
          <LoaderCircle className={styles.spin} aria-hidden="true" />
          <strong>Validando sua conta Google…</strong>
          <span>Estamos conferindo se seu cadastro já está completo.</span>
        </div>
      </section>
    );
  }

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
            : "Continue com Google ou use seu e-mail e senha."}
      </p>

      {!isComplete && (
        <div className={styles.authTabs} role="tablist" aria-label="Modo de acesso">
          <button type="button" role="tab" aria-selected={mode === "signin"} disabled={busy} onClick={() => selectMode("signin")}>Entrar</button>
          <button type="button" role="tab" aria-selected={isSignUp} disabled={busy} onClick={() => selectMode("signup")}>Criar conta</button>
        </div>
      )}

      {!isComplete && !isRecovery && (
        <>
          <button className={styles.oauthButton} type="button" onClick={() => void continueWithGoogle()} disabled={busy}>
            <GoogleMark />
            {busy ? "Abrindo Google…" : "Continuar com Google"}
          </button>
          <div className={styles.oauthDivider}><span>ou continue com e-mail</span></div>
        </>
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
            <input id="client-phone" value={phoneE164} onChange={(event) => setPhoneE164(event.target.value)} onBlur={() => { const normalized = normalizePhoneE164(phoneE164); if (normalized) setPhoneE164(normalized); }} required placeholder="11999999999 ou +5511999999999" autoComplete="tel" />
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
            <span className={styles.passwordControl}><input id="client-password" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete={isSignUp ? "new-password" : "current-password"} /><button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"} aria-pressed={showPassword}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></span>
          </label>
        )}
        {(isSignUp || isComplete) && (
          <>
            <label htmlFor="client-birth-date">Data de nascimento
              <input id="client-birth-date" type="text" value={birthDate} onChange={(event) => setBirthDate(normalizeBirthDateInput(event.target.value))} required placeholder="DD/MM/AAAA" inputMode="numeric" autoComplete="bday" maxLength={10} />
            </label>
            <label className={styles.authTerms} htmlFor="client-terms">
              <input id="client-terms" type="checkbox" checked={acceptedTerms} onChange={(event) => setAcceptedTerms(event.target.checked)} required />
              Aceito os termos de uso e a política de privacidade
            </label>
            <p className={styles.authWhatsappDefault}>
              <MessageCircle size={17} aria-hidden="true" />
              <span><strong>Avisos no WhatsApp começam ativos.</strong> Você pode desativá-los depois no perfil.</span>
            </p>
          </>
        )}
        <button className={styles.primaryButton} type="submit" disabled={busy} aria-busy={busy}>{busy ? "Aguarde…" : formName}</button>
      </form>

      {mode === "signin" && <button className={styles.textButton} type="button" disabled={busy} onClick={() => { clearMessages(); setMode("recovery"); }}>Esqueci minha senha</button>}
      {isSignUp && <button className={styles.textButton} type="button" disabled={busy} onClick={() => void resendConfirmation()}>Reenviar confirmação</button>}
      {(isRecovery || isComplete) && <button className={styles.textButton} type="button" disabled={busy} onClick={() => selectMode("signin")}>Voltar para entrar</button>}
    </section>
  );
}

type RecoverySessionState = "checking" | "ready" | "invalid" | "unavailable";

type RuntimeRecoveryExchange = {
  session: object;
  redirectType: "recovery";
};

function isRuntimeRecoveryExchange(value: unknown): value is RuntimeRecoveryExchange {
  return value !== null
    && typeof value === "object"
    && "session" in value
    && value.session !== null
    && typeof value.session === "object"
    && "redirectType" in value
    && value.redirectType === "recovery";
}

export function ClientPasswordResetForm({
  initialSlug,
  recoveryCode,
  recoveryFlowId,
}: {
  initialSlug: string | null;
  recoveryCode: string | null;
  recoveryFlowId: string | null;
}) {
  const router = useRouter();
  const [sessionState, setSessionState] = useState<RecoverySessionState>("checking");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const { busy, runMutation } = useExclusiveMutation();
  const destination = clientAuthDestination({ next: "/cliente", slug: initialSlug });
  const exchangeRef = useRef<{
    code: string;
    flowId: string | null;
    promise: Promise<"ready" | "invalid">;
  } | null>(null);

  useEffect(() => {
    if (!recoveryCode || !recoveryFlowId) {
      queueMicrotask(() => setSessionState("invalid"));
      return;
    }

    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      queueMicrotask(() => setSessionState("unavailable"));
      return;
    }

    if (!exchangeRef.current
      || exchangeRef.current.code !== recoveryCode
      || exchangeRef.current.flowId !== recoveryFlowId) {
      const cleanUrl = new URL(window.location.pathname, window.location.origin);
      const safeDestination = new URL(destination, "https://cliente.local");
      const slug = safeDestination.searchParams.get("barbearia");
      if (slug) cleanUrl.searchParams.set("barbearia", slug);
      window.history.replaceState(
        window.history.state,
        "",
        `${cleanUrl.pathname}${cleanUrl.search}`,
      );

      const promise = (async (): Promise<"ready" | "invalid"> => {
        try {
          const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(
            recoveryCode,
            { flowId: recoveryFlowId },
          );
          const isRecovery = exchangeError === null && isRuntimeRecoveryExchange(data);
          if (!isRecovery && data.session) {
            try {
              await supabase.auth.signOut({ scope: "local" });
            } catch {
              // The recovery form stays locked even when local cleanup fails.
            }
          }
          return isRecovery ? "ready" : "invalid";
        } catch {
          return "invalid";
        }
      })();
      exchangeRef.current = { code: recoveryCode, flowId: recoveryFlowId, promise };
    }

    let active = true;
    void exchangeRef.current.promise
      .then((result) => {
        if (!active) return;
        setSessionState(result);
      });

    return () => {
      active = false;
    };
  }, [destination, recoveryCode, recoveryFlowId]);

  async function submitPasswordReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");
    const parsedPassword = clientPasswordSchema.safeParse(password);
    if (!parsedPassword.success) {
      setError("Use uma senha com pelo menos 8 caracteres, letra, número e símbolo.");
      return;
    }
    if (password !== confirmation) {
      setError("As senhas precisam ser iguais.");
      return;
    }
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setSessionState("unavailable");
      return;
    }

    const showInvalidSession = () => setSessionState("invalid");
    await runMutation(async () => {
      const { error: updateError } = await supabase.auth.updateUser({
        password: parsedPassword.data,
      });
      if (updateError) {
        showInvalidSession();
        return;
      }
      setSuccess("Senha atualizada com sucesso.");
      router.push(destination);
    }, showInvalidSession);
  }

  if (sessionState === "checking") {
    return <div className={styles.state} role="status">Validando link de recuperação…</div>;
  }

  if (sessionState !== "ready") {
    const message = sessionState === "unavailable"
      ? "Acesso online indisponível."
      : "Link inválido ou sessão expirada. Solicite uma nova recuperação de senha.";
    return (
      <section className={styles.authForm} aria-labelledby="client-reset-title">
        <span className={styles.userMark} aria-hidden="true"><Scissors size={22} /></span>
        <h1 id="client-reset-title">Redefinir senha</h1>
        <p className={styles.error} role="alert">{message}</p>
        <button className={styles.textButton} type="button" onClick={() => router.push(destination)}>Voltar para cliente</button>
      </section>
    );
  }

  return (
    <section className={styles.authForm} aria-labelledby="client-reset-title">
      <span className={styles.userMark} aria-hidden="true"><Scissors size={22} /></span>
      <p className={styles.authKicker}>Recuperação segura</p>
      <h1 id="client-reset-title">Redefinir senha</h1>
      <p className={styles.authDescription}>Crie uma nova senha para sua conta de cliente.</p>
      {error && <p className={styles.error} role="alert" aria-live="assertive">{error}</p>}
      {success && <p className={styles.notice} role="status" aria-live="polite">{success}</p>}
      <form className={styles.authFields} aria-label="Redefinir senha" onSubmit={submitPasswordReset}>
        <label htmlFor="client-new-password">Nova senha
          <input id="client-new-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="new-password" />
        </label>
        <label htmlFor="client-new-password-confirmation">Confirmar nova senha
          <input id="client-new-password-confirmation" type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required autoComplete="new-password" />
        </label>
        <button className={styles.primaryButton} type="submit" disabled={busy} aria-busy={busy}>{busy ? "Aguarde…" : "Redefinir senha"}</button>
      </form>
    </section>
  );
}

"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck } from "lucide-react";
import { GoogleMark } from "@/components/google-mark";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  resolveSystemAuthDestination,
  systemLoginHref,
  type SystemAuthMode,
} from "@/lib/system-auth";

export function DemoLogin({
  demoMode = false,
  initialMode = "signin",
  nextPath = "/gestor",
}: {
  demoMode?: boolean;
  initialMode?: SystemAuthMode;
  nextPath?: string;
}) {
  const router = useRouter();
  const destination = resolveSystemAuthDestination(nextPath);
  const [showPassword, setShowPassword] = useState(false);
  const [authMode, setAuthMode] = useState<SystemAuthMode>(initialMode);
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [authNotice, setAuthNotice] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const supabase = getSupabaseBrowserClient();
    const postAuthDestination = authMode === "signup" ? "/onboarding" : destination;
    setLoading(true);

    if (!supabase) {
      window.setTimeout(() => router.push(postAuthDestination), 350);
      return;
    }

    if (authMode === "signup") {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent("/onboarding")}`,
        },
      });
      setLoading(false);
      if (error) {
        setAuthNotice(error.message);
        return;
      }
      setAuthNotice("Conta criada. Confira seu e-mail para confirmar o cadastro antes de entrar.");
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setAuthNotice("E-mail ou senha inválidos. Confirme o e-mail da conta e tente novamente.");
      return;
    }
    router.push(destination);
  }

  async function continueWithGoogle() {
    const postAuthDestination = authMode === "signup" ? "/onboarding" : destination;
    const supabase = getSupabaseBrowserClient();

    if (!supabase) {
      setAuthNotice("Supabase não configurado. Abrindo a demonstração local.");
      window.setTimeout(() => router.push(postAuthDestination), 450);
      return;
    }

    setOauthLoading(true);
    const params = new URLSearchParams({
      next: postAuthDestination,
      provider: "google",
    });
    const redirectTo = `${window.location.origin}/auth/callback?${params.toString()}`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });

    if (error) {
      setOauthLoading(false);
      setAuthNotice("Não foi possível iniciar o Google. Tente novamente.");
    }
  }

  function toggleAuthMode() {
    const nextMode = authMode === "signin" ? "signup" : "signin";
    setAuthMode(nextMode);
    setAuthNotice("");
    router.replace(systemLoginHref(nextMode, destination), { scroll: false });
  }

  const isSignup = authMode === "signup";

  return (
    <div className="login-card">
      <div className="login-card__heading">
        <h1>{isSignup ? "Crie sua barbearia" : "Entre na sua barbearia"}</h1>
        <p>
          {isSignup
            ? "Configure sua operação e comece seus 14 dias grátis."
            : "Acompanhe sua operação em tempo real."}
        </p>
      </div>

      <button className="google-button" type="button" onClick={continueWithGoogle} disabled={oauthLoading}>
        <GoogleMark />
        {oauthLoading ? "Abrindo Google..." : "Continuar com Google"}
      </button>

      {authNotice && <p className="login-notice" role="status">{authNotice}</p>}
      {demoMode && <div className="login-divider"><span>ou use os dados demo</span></div>}

      <form onSubmit={submit} aria-label={isSignup ? "Criar conta" : "Entrar"}>
        <label htmlFor="system-auth-email">
          E-mail
          <span className="input-shell">
            <Mail size={19} />
            <input
              id="system-auth-email"
              name="email"
              type="email"
              required
              autoComplete="email"
            />
          </span>
        </label>
        <label htmlFor="system-auth-password">
          Senha
          <span className="input-shell">
            <LockKeyhole size={19} />
            <input
              id="system-auth-password"
              name="password"
              type={showPassword ? "text" : "password"}
              required
              minLength={4}
              autoComplete={isSignup ? "new-password" : "current-password"}
            />
            <button
              type="button"
              onClick={() => setShowPassword((current) => !current)}
              aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
            >
              {showPassword ? <EyeOff size={19} /> : <Eye size={19} />}
            </button>
          </span>
        </label>
        <button className="button button--dark button--block login-submit" type="submit" disabled={loading}>
          {loading ? "Aguarde..." : isSignup ? "Criar conta" : demoMode ? "Entrar na demonstração" : "Entrar"}
          <ArrowRight size={18} />
        </button>
      </form>

      <button type="button" className="login-mode-switch" onClick={toggleAuthMode}>
        {isSignup ? "Já tenho conta. Entrar" : "Ainda não tenho conta. Criar conta"}
      </button>

      <p className="login-security">
        <ShieldCheck size={16} /> Seus dados protegidos com criptografia e isolamento por barbearia.
      </p>
    </div>
  );
}

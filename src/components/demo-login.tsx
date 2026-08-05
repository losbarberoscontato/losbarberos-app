"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

type DemoRole = "manager" | "customer" | "admin";

export function DemoLogin({ demoMode = false }: { demoMode?: boolean }) {
  const router = useRouter();
  const [role, setRole] = useState<DemoRole>("manager");
  const [showPassword, setShowPassword] = useState(false);
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [authNotice, setAuthNotice] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const supabase = getSupabaseBrowserClient();
    setLoading(true);
    const routes: Record<DemoRole, string> = {
      manager: "/onboarding",
      customer: "/cliente/agendar",
      admin: "/admin",
    };
    if (!supabase) {
      window.setTimeout(() => router.push(routes[role]), 350);
      return;
    }

    if (authMode === "signup") {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent("/onboarding")}` },
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
    router.push(routes[role]);
  }

  async function continueWithGoogle() {
    const routes: Record<DemoRole, string> = {
      manager: "/onboarding",
      customer: "/cliente/agendar",
      admin: "/admin",
    };
    const supabase = getSupabaseBrowserClient();

    if (!supabase) {
      setAuthNotice("Supabase não configurado. Abrindo a demonstração local.");
      window.setTimeout(() => router.push(routes[role]), 450);
      return;
    }

    setOauthLoading(true);
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(routes[role])}`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });

    if (error) {
      setOauthLoading(false);
      setAuthNotice("Não foi possível iniciar o Google. Tente novamente.");
    }
  }

  return (
    <div className="login-card">
      <div className="login-role-switch" role="tablist" aria-label="Perfil de demonstração">
        <button type="button" role="tab" aria-selected={role === "manager"} onClick={() => setRole("manager")}>Gestor</button>
        <button type="button" role="tab" aria-selected={role === "customer"} onClick={() => setRole("customer")}>Cliente</button>
        <button type="button" role="tab" aria-selected={role === "admin"} onClick={() => setRole("admin")}>Admin</button>
      </div>
      <div className="login-card__heading">
        <span className="login-card__welcome">Que bom ter você aqui</span>
        <h1>{role === "manager" ? "Entre na sua barbearia" : role === "customer" ? "Cuide do seu horário" : "Acesse o control plane"}</h1>
        <p>{role === "manager" ? "Acompanhe sua operação em tempo real." : role === "customer" ? "Agende, acompanhe e gerencie suas reservas." : "Ambiente restrito aos administradores Los Barberos."}</p>
      </div>

      <button className="google-button" type="button" onClick={continueWithGoogle} disabled={oauthLoading}>
        <span className="google-mark">G</span>
        {oauthLoading ? "Abrindo Google..." : "Continuar com Google"}
      </button>
      {authNotice && <p className="login-notice" role="status">{authNotice}</p>}
      <>{demoMode && <div className="login-divider"><span>ou use os dados demo</span></div>}

      <form onSubmit={submit}>
        <label>
          E-mail
          <span className="input-shell"><Mail size={18} /><input name="email" type="email" defaultValue={role === "manager" ? "guilherme@losbarberos.com.br" : role === "admin" ? "admin@losbarberos.com.br" : "rafael@email.com"} required autoComplete="email" /></span>
        </label>
        <label>
          <span className="label-row"><span>Senha</span><button type="button">Esqueci minha senha</button></span>
          <span className="input-shell"><LockKeyhole size={18} /><input name="password" type={showPassword ? "text" : "password"} defaultValue="demo1234" required minLength={4} autoComplete="current-password" /><button type="button" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></span>
        </label>
        <button className="button button--dark button--block login-submit" type="submit" disabled={loading}>
          {loading ? "Aguarde..." : authMode === "signup" ? "Criar conta" : demoMode ? "Entrar na demonstração" : "Entrar"}<ArrowRight size={17} />
        </button>
      </form>
      {!demoMode && <><p className="login-real-mode"><ShieldCheck size={16} /><span><strong>{authMode === "signup" ? "Crie sua conta de gestor" : "Acesso seguro por e-mail"}</strong><small>Você receberá um link de confirmação no primeiro cadastro.</small></span></p>{role === "manager" && <button type="button" className="login-mode-switch" onClick={() => { setAuthMode((mode) => mode === "signin" ? "signup" : "signin"); setAuthNotice(""); }}>{authMode === "signup" ? "Já tenho conta. Entrar" : "Ainda não tenho conta. Criar conta"}</button>}</>}
      </>
      <p className="login-security"><ShieldCheck size={15} /> Seus dados protegidos com criptografia e isolamento por barbearia.</p>
    </div>
  );
}

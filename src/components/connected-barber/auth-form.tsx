"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck } from "lucide-react";
import { barberAuthDestination } from "@/lib/barber-auth";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { GoogleMark } from "@/components/google-mark";
import type { ProductKey } from "@/lib/product-context";
import type { ProductIdentityConfig } from "@/lib/product-identity";
import { productLoginPath } from "@/lib/product-routes";

export function BarberAuthForm({ next, slug, error, productKey = "los-barberos", identity }: { next?: string | null; slug?: string | null; error?: string | null; productKey?: ProductKey; identity?: ProductIdentityConfig | null }) {
  const router = useRouter();
  const [message, setMessage] = useState(error ? "Não foi possível concluir o acesso. Faça login novamente." : "");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const destination = barberAuthDestination({ next, slug });
  const appName = identity?.vocabulary.teamApp ?? "App do Barbeiro";
  const loginHeading = productKey === "music-pro" ? "Entre na sua escola" : productKey === "le-gras" || productKey === "pro-stetic" ? "Entre no seu estúdio" : "Entre na sua barbearia";
  const createAccountHref = `${productLoginPath(productKey)}?modo=cadastro&next=${encodeURIComponent(destination)}`;

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const supabase = getSupabaseBrowserClient();
    setLoading(true);
    if (!supabase) { setLoading(false); setMessage("Sistema indisponível: configuração do Supabase ausente."); return; }
    const data = new FormData(event.currentTarget);
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: String(data.get("email") ?? "").trim(),
      password: String(data.get("password") ?? ""),
    });
    if (authError) { setLoading(false); setMessage("E-mail ou senha inválidos. Confirme o e-mail da conta e tente novamente."); return; }
    router.replace(destination);
    router.refresh();
  }

  async function signInWithGoogle() {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) { setMessage("Sistema indisponível: configuração do Supabase ausente."); return; }
    setOauthLoading(true);
    const callback = new URL("/auth/callback", window.location.origin);
    callback.searchParams.set("next", new URL(destination, window.location.origin).pathname);
    callback.searchParams.set("provider", "google");
    callback.searchParams.set("produto", productKey);
    const slugValue = new URL(destination, window.location.origin).searchParams.get("barbearia");
    if (slugValue) callback.searchParams.set("barbearia", slugValue);
    const { error: authError } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: callback.toString() } });
    if (authError) { setOauthLoading(false); setMessage("Não foi possível iniciar o Google. Tente novamente."); }
  }

  return (
    <div className="login-card">
      <div className="login-card__heading">
        <h1>{loginHeading}</h1>
        <p>Acompanhe seus atendimentos e sua agenda em um só lugar.</p>
      </div>

      <button className="google-button" type="button" onClick={() => void signInWithGoogle()} disabled={oauthLoading}>
        <GoogleMark />
        {oauthLoading ? "Abrindo Google..." : "Continuar com Google"}
      </button>

      {message && <p className="login-notice" role="status">{message}</p>}

      <form onSubmit={signIn} aria-label={`Entrar no ${appName}`}>
        <label htmlFor="barber-auth-email">
          E-mail
          <span className="input-shell">
            <Mail size={19} />
            <input id="barber-auth-email" name="email" type="email" autoComplete="email" required />
          </span>
        </label>
        <label htmlFor="barber-auth-password">
          Senha
          <span className="input-shell">
            <LockKeyhole size={19} />
            <input id="barber-auth-password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" required minLength={4} />
            <button type="button" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}>
              {showPassword ? <EyeOff size={19} /> : <Eye size={19} />}
            </button>
          </span>
        </label>
        <button className="button button--dark button--block login-submit" type="submit" disabled={loading}>
          {loading ? "Aguarde..." : "Entrar"}
          <ArrowRight size={18} />
        </button>
      </form>

      <Link className="login-mode-switch" href={createAccountHref}>
        Ainda não tenho conta. Criar conta
      </Link>

      <p className="login-security">
        <ShieldCheck size={16} /> Seus dados protegidos e separados por estabelecimento.
      </p>
    </div>
  );
}

"use client";

import Link from "next/link";
import { AlertCircle, Camera, LoaderCircle, Scissors } from "lucide-react";
import { useState } from "react";
import { useConnectedClient } from "@/components/connected-client/context";
import styles from "@/components/connected-client/connected-client.module.css";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

export function ConnectedClientGate({ children }: { children: React.ReactNode }) {
  const {
    slug,
    context,
    user,
    authLoading,
    linkStatus,
    organizations,
    loading,
    error,
    selectTenant,
    confirmTenantLink,
  } = useConnectedClient();
  const [value, setValue] = useState("");

  if (loading) {
    return <div className={styles.state} role="status"><LoaderCircle className={styles.spin} aria-hidden="true" /><strong>Carregando estabelecimento…</strong></div>;
  }
  if (!slug) {
    return (
      <section className={styles.resolver}>
        <Scissors size={28} aria-hidden="true" />
        <span>Agendamento online</span>
        <h1>Qual estabelecimento?</h1>
        <p>Digite o endereço recebido do estabelecimento.</p>
        <form onSubmit={(event) => { event.preventDefault(); selectTenant(value); }}>
          <label htmlFor="tenant-slug">Endereço do estabelecimento</label>
          <div><input id="tenant-slug" value={value} onChange={(event) => setValue(event.target.value)} placeholder="endereco-do-estabelecimento" autoComplete="off" /><button type="submit">Continuar</button></div>
        </form>
        {error && <p className={styles.error} role="alert">{error}</p>}
      </section>
    );
  }
  if (!context) {
    return <div className={styles.state} role="alert"><AlertCircle aria-hidden="true" /><strong>{error ?? "Estabelecimento não encontrado."}</strong><button type="button" onClick={() => selectTenant("")}>Tentar outro estabelecimento</button></div>;
  }
  if (user && (authLoading || linkStatus === "IDLE" || linkStatus === "LOADING")) {
    return <div className={styles.state} role="status"><LoaderCircle className={styles.spin} aria-hidden="true" /><strong>Validando vínculo com estabelecimento…</strong></div>;
  }
  if (user && linkStatus !== "LINKED") {
    const pendingReview = linkStatus === "REVIEW_REQUIRED";
    const claimRequired = linkStatus === "CLAIM_REQUIRED";
    const profileRequired = linkStatus === "PROFILE_REQUIRED";
    const completeProfileHref = `/cliente/entrar?barbearia=${encodeURIComponent(context.organization.slug)}&complete=1`;
    const promptDescription = pendingReview
      ? "Vínculo enviado para revisão pelo estabelecimento."
      : profileRequired
        ? "Complete seus dados de cliente antes de entrar neste estabelecimento."
        : claimRequired
          ? "Encontramos um cadastro existente. Confirme que este cadastro é seu para continuar."
          : organizations.length
            ? `Você está conectado a ${organizations[0].organization_name}. Confirme para trocar para ${context.organization.name}.`
            : null;
    return (
      <section className={styles.authPrompt}>
        <UserMark />
        <h2>{context.organization.name}</h2>
        {promptDescription && <p>{promptDescription}</p>}
        {profileRequired ? (
          <Link href={completeProfileHref} className={styles.primaryButton}>Completar cadastro</Link>
        ) : !pendingReview && (
          <button
            type="button"
            disabled={linkStatus === "LINKING"}
            onClick={() => void confirmTenantLink().catch(() => undefined)}
          >
            {linkStatus === "LINKING"
              ? "Entrando…"
              : claimRequired
                ? "Confirmar cadastro encontrado"
                : "Entrar"}
          </button>
        )}
        {error && <p className={styles.error} role="alert">{error}</p>}
      </section>
    );
  }
  return <>{children}</>;
}

export function AuthPrompt({ description }: { description: string }) {
  const { slug } = useConnectedClient();
  const href = slug
    ? `/cliente/entrar?barbearia=${encodeURIComponent(slug)}`
    : "/cliente/entrar";
  return (
    <section className={styles.authPrompt}>
      <UserMark />
      <h2>Entre para continuar</h2>
      <p>{description}</p>
      <Link href={href} className={styles.primaryButton}>Entrar ou criar conta</Link>
      <small>Use Google ou e-mail. Sua sessão é protegida pelo Supabase.</small>
    </section>
  );
}

function UserMark() {
  const { entry, identity } = useConnectedClient();
  const supabase = getSupabaseBrowserClient();
  const logoUrl = entry?.logo_path && supabase
    ? supabase.storage.from("organization-logos").getPublicUrl(entry.logo_path).data.publicUrl
    : identity?.brand.logoUrl;
  const Icon = entry?.product_key === "le-gras" ? Camera : Scissors;
  return <span className={styles.userMark}>{logoUrl ? <img src={logoUrl} alt={`Logo de ${entry?.logo_path ? entry.organization_name : identity?.brand.name}`} /> : <Icon size={22} aria-hidden="true" />}</span>;
}

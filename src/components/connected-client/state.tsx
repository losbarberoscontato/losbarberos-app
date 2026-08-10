"use client";

import Link from "next/link";
import { AlertCircle, LoaderCircle, Scissors } from "lucide-react";
import { useState } from "react";
import { useConnectedClient } from "@/components/connected-client/context";
import styles from "@/components/connected-client/connected-client.module.css";

export function ConnectedClientGate({ children }: { children: React.ReactNode }) {
  const {
    slug,
    context,
    user,
    authLoading,
    linkStatus,
    loading,
    error,
    selectTenant,
    confirmTenantLink,
  } = useConnectedClient();
  const [value, setValue] = useState("");

  if (loading) {
    return <div className={styles.state} role="status"><LoaderCircle className={styles.spin} aria-hidden="true" /><strong>Carregando barbearia…</strong></div>;
  }
  if (!slug) {
    return (
      <section className={styles.resolver}>
        <Scissors size={28} aria-hidden="true" />
        <span>Agendamento online</span>
        <h1>Qual barbearia?</h1>
        <p>Digite slug recebido da barbearia. Exemplo: <strong>barbearia-do-bairro</strong>.</p>
        <form onSubmit={(event) => { event.preventDefault(); selectTenant(value); }}>
          <label htmlFor="tenant-slug">Identificador da barbearia</label>
          <div><input id="tenant-slug" value={value} onChange={(event) => setValue(event.target.value)} placeholder="barbearia-do-bairro" autoComplete="off" /><button type="submit">Continuar</button></div>
        </form>
        {error && <p className={styles.error} role="alert">{error}</p>}
      </section>
    );
  }
  if (!context) {
    return <div className={styles.state} role="alert"><AlertCircle aria-hidden="true" /><strong>{error ?? "Barbearia não encontrada."}</strong><button type="button" onClick={() => selectTenant("")}>Tentar outro slug</button></div>;
  }
  if (user && (authLoading || linkStatus === "IDLE" || linkStatus === "LOADING")) {
    return <div className={styles.state} role="status"><LoaderCircle className={styles.spin} aria-hidden="true" /><strong>Validando vínculo com barbearia…</strong></div>;
  }
  if (user && linkStatus !== "LINKED") {
    const pendingReview = linkStatus === "REVIEW_REQUIRED";
    const claimRequired = linkStatus === "CLAIM_REQUIRED";
    return (
      <section className={styles.authPrompt}>
        <UserMark />
        <h2>{context.organization.name}</h2>
        <p>
          {pendingReview
            ? "Vínculo enviado para revisão pela barbearia."
            : claimRequired
              ? "Encontramos um cadastro existente. Confirmação adicional será necessária."
              : "Confirme para criar sua relação com esta barbearia. Visitar o link não cria vínculo."}
        </p>
        {!pendingReview && !claimRequired && (
          <button
            type="button"
            disabled={linkStatus === "LINKING"}
            onClick={() => void confirmTenantLink().catch(() => undefined)}
          >
            {linkStatus === "LINKING" ? "Entrando…" : "Entrar nesta barbearia"}
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
      <Link href={href} className={styles.primaryButton}>Entrar com e-mail</Link>
      <small>Autenticação por e-mail e senha protegida pelo Supabase.</small>
    </section>
  );
}

function UserMark() {
  return <span className={styles.userMark} aria-hidden="true"><Scissors size={22} /></span>;
}

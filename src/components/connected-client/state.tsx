"use client";

import { AlertCircle, LoaderCircle, Scissors } from "lucide-react";
import { useState } from "react";
import { useConnectedClient } from "@/components/connected-client/context";
import styles from "@/components/connected-client/connected-client.module.css";

export function ConnectedClientGate({ children }: { children: React.ReactNode }) {
  const { slug, context, loading, error, selectTenant } = useConnectedClient();
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
  return <>{children}</>;
}

export function AuthPrompt({ description }: { description: string }) {
  const { authLoading, signInWithGoogle } = useConnectedClient();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <section className={styles.authPrompt}>
      <UserMark />
      <h2>Entre para continuar</h2>
      <p>{description}</p>
      <button type="button" disabled={busy || authLoading} onClick={() => {
        setBusy(true);
        setError("");
        void signInWithGoogle().catch((cause: unknown) => {
          setBusy(false);
          setError(cause instanceof Error ? cause.message : "Falha ao iniciar Google.");
        });
      }}>
        <span className={styles.googleMark}>G</span>
        {busy ? "Abrindo Google…" : "Continuar com Google"}
      </button>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <small>Autenticação protegida pelo Supabase. Nenhuma senha Google passa pelo Los Barberos.</small>
    </section>
  );
}

function UserMark() {
  return <span className={styles.userMark} aria-hidden="true"><Scissors size={22} /></span>;
}

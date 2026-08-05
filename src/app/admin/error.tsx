"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { Brand } from "@/components/brand";
import styles from "@/components/connected-admin/control-plane.module.css";

export default function AdminError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <div className={styles.shell}>
    <header className={styles.topbar}><Brand href="/admin" light /><span>Platform admin</span></header>
    <main className={styles.main}>
      <section className={styles.errorState} role="alert">
        <AlertTriangle size={20} />
        <div><strong>Control plane indisponível</strong><p>Erro inesperado ao montar interface autorizada.</p></div>
        <button type="button" onClick={retry}><RefreshCw size={15} /> Tentar novamente</button>
      </section>
    </main>
  </div>;
}

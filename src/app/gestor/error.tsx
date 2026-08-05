"use client";

import styles from "@/components/connected-manager/connected-manager.module.css";

export default function ManagerError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <section className={`${styles.panel} ${styles.empty}`} role="alert"><strong>Não foi possível carregar o painel</strong><p>{error.message || "Falha ao consultar os dados reais. Tente novamente."}</p><button className={styles.button} type="button" onClick={reset}>Tentar novamente</button></section>;
}


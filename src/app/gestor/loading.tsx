import styles from "@/components/connected-manager/connected-manager.module.css";

export default function ManagerLoading() {
  return <div className={`${styles.panel} ${styles.loading}`} role="status"><span><i className={styles.spinner} />Carregando dados reais da organização…</span></div>;
}


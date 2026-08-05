import { Brand } from "@/components/brand";
import styles from "@/components/connected-admin/control-plane.module.css";

export default function AdminLoading() {
  return <div className={styles.shell} aria-busy="true" aria-label="Carregando control plane">
    <header className={styles.topbar}><Brand href="/admin" light /><span>Carregando dados autorizados…</span></header>
    <main className={styles.main}>
      <header className={styles.heading}><div><span>Control plane</span><h1>Operação Los Barberos</h1><p>Consultando tenants, assinaturas e auditoria.</p></div></header>
      <section className={styles.loadingPanel}><div className={styles.loadingLine} /><div className={styles.loadingLine} /><div className={styles.loadingLine} /></section>
    </main>
  </div>;
}

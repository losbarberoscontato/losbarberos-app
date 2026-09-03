import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Building2, ShieldCheck } from "lucide-react";
import { Brand } from "@/components/brand";
import { BarberAccountProfileForm } from "./account-profile";
import type { BarberAccountProfile, BarberAppContext } from "./types";
import styles from "./access.module.css";

function initials(value: string) {
  return value.split(/\s+/u).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

export function BarberConnectionScreen({ organizations }: { organizations: BarberAppContext[] }) {
  return (
    <main className={styles.page}>
      <header className={styles.header}><Brand light /></header>
      <section className={styles.panel} aria-labelledby="barber-connection-title">
        <div className={styles.panelHeading}>
          <span className={styles.headingIcon}><Building2 size={24} /></span>
          <div>
            <h1 id="barber-connection-title">Escolha uma barbearia</h1>
            <p>Você está conectado a {organizations.length} barbearias. Entre no ambiente que deseja operar agora.</p>
          </div>
        </div>
        <ul className={styles.organizationList} aria-label="Barbearias conectadas">
          {organizations.map((organization) => (
            <li className={styles.organizationItem} key={organization.organization_id}>
              {organization.organization_logo_url ? (
                <Image className={styles.organizationLogo} src={organization.organization_logo_url} alt={`Logo da ${organization.organization_name}`} width={76} height={76} sizes="76px" />
              ) : (
                <span className={styles.organizationFallback} aria-hidden="true">{initials(organization.organization_name)}</span>
              )}
              <strong>{organization.organization_name}</strong>
              <Link className={styles.enterButton} href={`/barbeiro/agenda?barbearia=${encodeURIComponent(organization.organization_slug)}`}>
                Entrar <ArrowRight size={18} />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

export function BarberDisconnectedScreen({ profile, email }: { profile: BarberAccountProfile; email: string | null }) {
  return (
    <main className={styles.page}>
      <header className={styles.header}><Brand light /></header>
      <section className={`${styles.panel} ${styles.disconnectedPanel}`} aria-labelledby="barber-disconnected-title">
        <div className={styles.panelHeading}>
          <span className={styles.headingIcon}><ShieldCheck size={24} /></span>
          <div>
            <h1 id="barber-disconnected-title">Você não está conectado a nenhuma barbearia no momento.</h1>
            <p>Quando um gestor liberar seu acesso novamente, a barbearia aparecerá aqui.</p>
          </div>
        </div>
        <BarberAccountProfileForm profile={profile} email={email} />
      </section>
    </main>
  );
}

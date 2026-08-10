"use client";

import Link from "next/link";
import { CalendarPlus2, CheckCircle2, ChevronRight, MapPin, Store } from "lucide-react";
import { useState } from "react";
import { useConnectedClient } from "@/components/connected-client/context";
import { locationLabel } from "@/components/connected-client/format";
import { ConnectedClientGate } from "@/components/connected-client/state";
import styles from "@/components/connected-client/connected-client.module.css";

export function ConnectedClientHome() {
  return <ConnectedClientGate><HomeContent /></ConnectedClientGate>;
}

function HomeContent() {
  const { context, organizations, slug, switchTenant } = useConnectedClient();
  const [targetSlug, setTargetSlug] = useState<string | null>(null);
  if (!context || !slug) return null;

  const current = organizations.find((item) => item.organization_slug === slug) ?? null;
  const target = targetSlug
    ? organizations.find((item) => item.organization_slug === targetSlug) ?? null
    : null;
  const address = locationLabel(context.location?.address);
  const linkedElsewhere = organizations.filter((item) => item.organization_slug !== slug);

  return (
    <section className={styles.clientHome} aria-labelledby="client-home-title">
      <div className={styles.homeHero}>
        <span className={styles.homeMark} aria-hidden="true"><Store size={22} /></span>
        <p>Minha barbearia</p>
        <h1 id="client-home-title">{context.organization.name}</h1>
        <span className={context.organization.accepting_bookings ? styles.homeOpen : styles.homeClosed}>
          <CheckCircle2 size={14} aria-hidden="true" />
          {context.organization.accepting_bookings ? "Reservas abertas" : "Reservas pausadas"}
        </span>
        <div className={styles.homeAddress}><MapPin size={16} aria-hidden="true" /><span>{address || "Endereço a confirmar"}</span></div>
        <Link className={styles.primaryButton} href={`/cliente/agendar?barbearia=${encodeURIComponent(slug)}`}>
          <CalendarPlus2 size={17} aria-hidden="true" /> Agendar
        </Link>
      </div>

      <section className={styles.homePanel} aria-label="Próximo atendimento">
        <span>Próximo atendimento</span>
        <strong>Nenhum horário futuro confirmado</strong>
        <p>Escolha um serviço e horário para sua próxima visita.</p>
      </section>

      {linkedElsewhere.length > 0 && (
        <section className={styles.homePanel} aria-label="Trocar de barbearia">
          <span>Outras barbearias</span>
          <strong>Troque apenas entre vínculos confirmados</strong>
          <div className={styles.organizationChoices}>
            {linkedElsewhere.map((item) => (
              <button key={item.organization_id} type="button" onClick={() => setTargetSlug(item.organization_slug)}>
                <span>{item.organization_name}</span><ChevronRight size={16} aria-hidden="true" />
              </button>
            ))}
          </div>
        </section>
      )}

      {target && (
        <section className={styles.switchConfirm} role="dialog" aria-modal="true" aria-labelledby="switch-title">
          <p>Trocar de barbearia</p>
          <h2 id="switch-title">Abrir {target.organization_name}?</h2>
          <span>Você sairá de {current?.organization_name ?? context.organization.name}. Agenda e histórico exibidos passarão a pertencer à nova barbearia.</span>
          <div>
            <button type="button" className={styles.secondaryButton} onClick={() => setTargetSlug(null)}>Cancelar</button>
            <button type="button" className={styles.primaryButton} onClick={() => {
              switchTenant(target.organization_slug);
              setTargetSlug(null);
            }}>Confirmar troca</button>
          </div>
        </section>
      )}
    </section>
  );
}

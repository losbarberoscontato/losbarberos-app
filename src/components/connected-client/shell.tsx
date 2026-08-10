"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, CalendarPlus2, ChevronRight, LogOut, MapPin, Menu, UserRound, X } from "lucide-react";
import { useState } from "react";
import { Brand } from "@/components/brand";
import { ConnectedClientProvider, useConnectedClient } from "@/components/connected-client/context";
import { initials, locationLabel } from "@/components/connected-client/format";
import styles from "@/components/connected-client/connected-client.module.css";

const navigation = [
  { href: "/cliente/agendar", label: "Agendar", icon: CalendarPlus2 },
  { href: "/cliente/reservas", label: "Reservas", icon: CalendarDays },
  { href: "/cliente/perfil", label: "Perfil", icon: UserRound },
];

function ShellContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const { context, customer, organizations, user, slug, signOut, switchTenant } = useConnectedClient();
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [targetSlug, setTargetSlug] = useState<string | null>(null);
  const suffix = slug ? `?barbearia=${encodeURIComponent(slug)}` : "";
  const displayName = customer?.full_name ?? user?.user_metadata?.full_name ?? user?.email ?? "Cliente";
  const target = targetSlug
    ? organizations.find((item) => item.organization_slug === targetSlug) ?? null
    : null;

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.topbarInner}>
          <Brand href={`/cliente/agendar${suffix}`} />
          <nav className={styles.desktopNav} aria-label="Navegação do cliente">
            {navigation.map((item) => {
              const Icon = item.icon;
              const active = pathname.startsWith(item.href);
              return (
                <Link key={item.href} href={`${item.href}${suffix}`} aria-current={active ? "page" : undefined} className={active ? styles.active : undefined}>
                  <Icon size={17} aria-hidden="true" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
          {user && organizations.length > 1 && (
            <button type="button" className={styles.tenantMenuButton} onClick={() => setSwitcherOpen((open) => !open)} aria-expanded={switcherOpen} aria-controls="client-tenant-menu">
              {switcherOpen ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}
              <span>Barbearias</span>
            </button>
          )}
          {user ? (
            <button type="button" className={styles.account} onClick={() => void signOut()} aria-label="Sair da conta">
              <span>{initials(displayName)}</span>
              <LogOut size={18} aria-hidden="true" />
            </button>
          ) : <span className={styles.guest}>Visitante</span>}
        </div>
      </header>
      <div className={styles.locationStrip}>
        <MapPin size={15} aria-hidden="true" />
        <span>
          {context
            ? `${context.organization.name} · ${context.location?.name ?? "Unidade"} · ${locationLabel(context.location?.address)}`
            : "Selecione uma barbearia"}
        </span>
        {context && (
          <strong className={context.organization.accepting_bookings ? styles.open : styles.closed}>
            {context.organization.accepting_bookings ? "Aceitando reservas" : "Reservas pausadas"}
          </strong>
        )}
      </div>
      <main className={styles.main}>{children}</main>
      {switcherOpen && (
        <section id="client-tenant-menu" className={styles.tenantMenu} aria-label="Trocar de barbearia">
          <strong>Suas barbearias</strong>
          {organizations.filter((item) => item.organization_slug !== slug).map((item) => (
            <button key={item.organization_id} type="button" onClick={() => setTargetSlug(item.organization_slug)}>
              <span>{item.organization_name}</span><ChevronRight size={16} aria-hidden="true" />
            </button>
          ))}
        </section>
      )}
      {target && (
        <section className={styles.switchConfirm} role="dialog" aria-modal="true" aria-labelledby="shell-switch-title">
          <p>Trocar de barbearia</p>
          <h2 id="shell-switch-title">Abrir {target.organization_name}?</h2>
          <span>Agenda e histórico exibidos passarão a pertencer à nova barbearia.</span>
          <div>
            <button type="button" className={styles.secondaryButton} onClick={() => setTargetSlug(null)}>Cancelar</button>
            <button type="button" className={styles.primaryButton} onClick={() => {
              switchTenant(target.organization_slug);
              setTargetSlug(null);
              setSwitcherOpen(false);
            }}>Confirmar troca</button>
          </div>
        </section>
      )}
      <nav className={styles.bottomNav} aria-label="Navegação do cliente">
        {navigation.map((item) => {
          const Icon = item.icon;
          const active = pathname.startsWith(item.href);
          return (
            <Link key={item.href} href={`${item.href}${suffix}`} aria-current={active ? "page" : undefined} className={active ? styles.active : undefined}>
              <Icon size={21} aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export function ConnectedClientShell({
  children,
  initialSlug = null,
}: {
  children: React.ReactNode;
  initialSlug?: string | null;
}) {
  return (
    <ConnectedClientProvider initialSlug={initialSlug}>
      <ShellContent>{children}</ShellContent>
    </ConnectedClientProvider>
  );
}

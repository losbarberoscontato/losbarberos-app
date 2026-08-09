"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, CalendarPlus2, LogOut, MapPin, UserRound } from "lucide-react";
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
  const { context, customer, user, slug, signOut } = useConnectedClient();
  const suffix = slug ? `?barbearia=${encodeURIComponent(slug)}` : "";
  const displayName = customer?.full_name ?? user?.user_metadata?.full_name ?? user?.email ?? "Cliente";

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

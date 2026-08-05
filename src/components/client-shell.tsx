"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, CalendarPlus2, LogOut, MapPin, UserRound } from "lucide-react";
import { Brand } from "@/components/brand";

const clientNavigation = [
  { href: "/cliente/agendar", label: "Agendar", icon: CalendarPlus2 },
  { href: "/cliente/reservas", label: "Reservas", icon: CalendarDays },
  { href: "/cliente/perfil", label: "Perfil", icon: UserRound },
];

export function ClientShell({ children, demoMode = false }: { children: React.ReactNode; demoMode?: boolean }) {
  const pathname = usePathname();

  return (
    <div className="client-shell">
      <header className="client-topbar">
        <div className="client-topbar__inner">
          <Brand href="/cliente/agendar" />
          <nav aria-label="Navegação do cliente">
            {clientNavigation.map((item) => {
              const Icon = item.icon;
              const active = pathname.startsWith(item.href);
              return (
                <Link key={item.href} href={item.href} className={active ? "is-active" : ""}>
                  <Icon size={17} />
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <Link href="/" className="client-exit" aria-label="Sair">
            <span className="client-avatar">{demoMode ? "RM" : "C"}</span>
            <LogOut size={18} />
          </Link>
        </div>
      </header>
      <div className="client-location-strip">
        <MapPin size={15} />
        <span>{demoMode ? "Vila Madalena · Rua Harmonia, 214" : "Unidade selecionada no contexto da reserva"}</span>
        {demoMode && <span className="client-location-strip__status">Aberto agora</span>}
      </div>
      <main className="client-main">{children}</main>
      <nav className="client-bottom-nav" aria-label="Navegação do cliente">
        {clientNavigation.map((item) => {
          const Icon = item.icon;
          const active = pathname.startsWith(item.href);
          return (
            <Link key={item.href} href={item.href} className={active ? "is-active" : ""}>
              <Icon size={21} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

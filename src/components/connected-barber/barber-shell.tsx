"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  Banknote,
  Bell,
  CalendarDays,
  ChevronDown,
  LogOut,
  Menu,
  Search,
  UserRound,
  X,
} from "lucide-react";
import { Brand } from "@/components/brand";
import { Avatar } from "@/components/ui";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { BarberAppContext } from "./types";

type BarberNavigationItem = { href: string; label: string; icon: typeof CalendarDays };

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "BB";
}

function BarberNavigation({ navigation, profile, pathname, suffix, onNavigate }: { navigation: BarberNavigationItem[]; profile: BarberNavigationItem; pathname: string; suffix: string; onNavigate?: () => void }) {
  const isActive = (href: string) => pathname.startsWith(href);
  const link = (href: string) => `${href}${suffix}`;
  return <nav className="manager-nav" aria-label="Navegação do Barbeiro">
    <p className="manager-nav__label">Operação</p>
    {navigation.map((item) => {
      const Icon = item.icon;
      const active = isActive(item.href);
      return <Link href={link(item.href)} key={item.href} className={active ? "is-active" : ""} aria-current={active ? "page" : undefined} onClick={onNavigate}><Icon size={19} strokeWidth={1.8} /><span>{item.label}</span></Link>;
    })}
    <p className="manager-nav__label manager-nav__label--second">Sistema</p>
    <Link href={link(profile.href)} className={isActive(profile.href) ? "is-active" : ""} aria-current={isActive(profile.href) ? "page" : undefined} onClick={onNavigate}><UserRound size={19} strokeWidth={1.8} /><span>Meu perfil</span></Link>
  </nav>;
}

export function BarberShell({ context, children }: { context: BarberAppContext; children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const suffix = `?barbearia=${encodeURIComponent(context.organization_slug)}`;
  const navigation: BarberNavigationItem[] = [
    { href: "/barbeiro/agenda", label: "Agenda", icon: CalendarDays },
    ...(context.cash_access_enabled ? [{ href: "/barbeiro/caixa", label: "Caixa", icon: Banknote }] : []),
  ];
  const profile = { href: "/barbeiro/perfil", label: "Meu perfil", icon: UserRound };
  const currentInitials = initials(context.barber_name);

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    const supabase = getSupabaseBrowserClient();
    await supabase?.auth.signOut({ scope: "local" });
    router.replace("/barbeiro/entrar");
    router.refresh();
  }

  function isActive(href: string) {
    return pathname.startsWith(href);
  }

  function link(href: string) {
    return `${href}${suffix}`;
  }

  const organizationSwitcher = <Link className="organization-switcher" href="/barbeiro" aria-label="Trocar barbearia">
    <span className={`organization-switcher__mark${context.organization_logo_url ? " organization-switcher__mark--logo" : ""}`} role={context.organization_logo_url ? "img" : undefined} aria-label={context.organization_logo_url ? `Logo de ${context.organization_name}` : undefined} style={context.organization_logo_url ? { backgroundImage: `url("${context.organization_logo_url}")` } : undefined}>{!context.organization_logo_url && "LB"}</span>
    <span><strong>{context.organization_name}</strong><small>Acesso profissional</small></span><ChevronDown size={16} />
  </Link>;

  const accountFooter = <div className="manager-profile">
    <Link className="manager-profile__identity" href={link(profile.href)}><Avatar initials={currentInitials} tone="amber" /><span><strong>{context.barber_name}</strong><small>Barbeiro</small></span></Link>
    <button type="button" className="manager-profile__signout" onClick={() => void signOut()} disabled={signingOut} aria-label="Sair da conta" aria-busy={signingOut} title="Sair da conta"><LogOut size={17} aria-hidden="true" /></button>
  </div>;

  return <div className="manager-shell barber-manager-shell">
    <aside className="manager-sidebar">
      <div className="manager-sidebar__brand"><Brand href={link("/barbeiro/agenda")} light /></div>
      {organizationSwitcher}
      <BarberNavigation navigation={navigation} profile={profile} pathname={pathname} suffix={suffix} />
      <div className="manager-sidebar__footer">{accountFooter}</div>
    </aside>

    {menuOpen && <button className="mobile-overlay" type="button" aria-label="Fechar menu" onClick={() => setMenuOpen(false)} />}
    <aside className={`manager-drawer ${menuOpen ? "is-open" : ""}`} aria-hidden={!menuOpen}>
      <div className="manager-drawer__head"><Brand href={link("/barbeiro/agenda")} light /><button type="button" className="icon-button icon-button--dark" onClick={() => setMenuOpen(false)} aria-label="Fechar menu"><X size={20} /></button></div>
      {organizationSwitcher}
      <BarberNavigation navigation={navigation} profile={profile} pathname={pathname} suffix={suffix} onNavigate={() => setMenuOpen(false)} />
      <div className="manager-sidebar__footer">{accountFooter}</div>
    </aside>

    <div className="manager-workspace">
      <header className="manager-topbar">
        <button className="icon-button manager-topbar__menu" type="button" onClick={() => setMenuOpen(true)} aria-label="Abrir menu"><Menu size={21} /></button>
        <div className="manager-topbar__mobile-brand"><Brand href={link("/barbeiro/agenda")} compact /><span><strong>{context.organization_name}</strong><small>Acesso profissional</small></span></div>
        <button type="button" className="global-search" aria-label="Buscar na agenda"><Search size={18} /><span>Buscar cliente, agendamento...</span><kbd>Ctrl K</kbd></button>
        <div className="manager-topbar__actions"><button type="button" className="icon-button notification-button" aria-label="Notificações"><Bell size={19} /></button><Avatar initials={currentInitials} tone="amber" size="sm" /></div>
      </header>
      <main className="manager-main">{children}</main>
    </div>

    <nav className="manager-bottom-nav" aria-label="Navegação rápida">
      {[...navigation, profile].map((item) => { const Icon = item.icon; const active = isActive(item.href); return <Link key={item.href} href={link(item.href)} className={active ? "is-active" : ""} aria-current={active ? "page" : undefined}><Icon size={20} /><span>{item.label.split(" ")[0]}</span></Link>; })}
      <button type="button" onClick={() => setMenuOpen(true)} aria-label="Mais opções"><Menu size={20} /><span>Mais</span></button>
    </nav>
  </div>;
}

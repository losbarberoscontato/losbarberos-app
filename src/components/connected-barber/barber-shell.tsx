"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  Banknote,
  Bell,
  CalendarDays,
  BriefcaseBusiness,
  FolderKanban,
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
import { productIdentityStyle } from "@/lib/product-identity";
import type { BarberAppContext } from "./types";

type BarberNavigationItem = { href: string; label: string; icon: typeof CalendarDays };

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "BB";
}

function BarberNavigation({ navigation, profile, pathname, suffix, professionalName, onNavigate }: { navigation: BarberNavigationItem[]; profile: BarberNavigationItem; pathname: string; suffix: string; professionalName: string; onNavigate?: () => void }) {
  const isActive = (href: string) => pathname.startsWith(href);
  const link = (href: string) => `${href}${suffix}`;
  return <nav className="manager-nav" aria-label={`Navegação do ${professionalName}`}>
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
  const [moreOpen, setMoreOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const suffix = `?barbearia=${encodeURIComponent(context.organization_slug)}`;
  const identity = context.product_identity;
  const brandName = identity?.brand.name ?? "Los Barberos";
  const professionalName = identity?.vocabulary.professional ?? "barbeiro";
  const organizationName = identity?.vocabulary.organization ?? "barbearia";
  const organizationPlural = identity?.vocabulary.organizationPicker ?? "Trocar barbearia";
  const customerPlural = identity?.vocabulary.customerPlural ?? "clientes";
  const navigation: BarberNavigationItem[] = [
    { href: "/barbeiro/agenda", label: "Agenda", icon: CalendarDays },
    ...(context.projects_access_enabled ? [{ href: "/barbeiro/projetos", label: "Projetos", icon: BriefcaseBusiness }] : []),
    ...(context.kanban_access_enabled ? [{ href: "/barbeiro/kanban", label: "Kanban", icon: FolderKanban }] : []),
    ...(context.cash_access_enabled ? [{ href: "/barbeiro/caixa", label: "Caixa", icon: Banknote }] : []),
  ];
  const profile = { href: "/barbeiro/perfil", label: "Meu perfil", icon: UserRound };
  const moreNavigation = [
    ...navigation.filter((item) => item.href !== "/barbeiro/agenda" && item.href !== "/barbeiro/caixa"),
    ...(context.cash_access_enabled ? [{ href: "/barbeiro/financeiro", label: "Financeiro", icon: Banknote }] : []),
  ];
  const currentInitials = initials(context.barber_name);

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    const supabase = getSupabaseBrowserClient();
    await supabase?.auth.signOut({ scope: "local" });
    router.replace(`/barbeiro/entrar?barbearia=${encodeURIComponent(context.organization_slug)}`);
    router.refresh();
  }

  function isActive(href: string) {
    return pathname.startsWith(href);
  }

  function link(href: string) {
    return `${href}${suffix}`;
  }

  const organizationSwitcher = <Link className="organization-switcher" href="/barbeiro" aria-label={organizationPlural}>
    <span className={`organization-switcher__mark${context.organization_logo_url ? " organization-switcher__mark--logo" : ""}`} role={context.organization_logo_url ? "img" : undefined} aria-label={context.organization_logo_url ? `Logo de ${context.organization_name}` : undefined} style={context.organization_logo_url ? { backgroundImage: `url("${context.organization_logo_url}")` } : undefined}>{!context.organization_logo_url && (identity?.brand.mark ?? "LB")}</span>
    <span><strong>{context.organization_name}</strong><small>Acesso ao {organizationName}</small></span><ChevronDown size={16} />
  </Link>;

  const accountFooter = <div className="manager-profile">
    <Link className="manager-profile__identity" href={link(profile.href)}><Avatar initials={currentInitials} tone="amber" /><span><strong>{context.barber_name}</strong><small>{professionalName[0]?.toLocaleUpperCase("pt-BR")}{professionalName.slice(1)}</small></span></Link>
    <button type="button" className="manager-profile__signout" onClick={() => void signOut()} disabled={signingOut} aria-label="Sair da conta" aria-busy={signingOut} title="Sair da conta"><LogOut size={17} aria-hidden="true" /></button>
  </div>;

  return <div className="manager-shell barber-manager-shell" style={productIdentityStyle(identity)}>
    <aside className="manager-sidebar">
      <div className="manager-sidebar__brand"><Brand href={link("/barbeiro/agenda")} light name={brandName} tagline={identity?.brand.tagline} mark={identity?.brand.mark} wordmarkUrl={identity?.brand.logoUrl} /></div>
      {organizationSwitcher}
      <BarberNavigation navigation={navigation} profile={profile} pathname={pathname} suffix={suffix} professionalName={professionalName} />
      <div className="manager-sidebar__footer">{accountFooter}</div>
    </aside>

    {menuOpen && <button className="mobile-overlay" type="button" aria-label="Fechar menu" onClick={() => setMenuOpen(false)} />}
    <aside className={`manager-drawer ${menuOpen ? "is-open" : ""}`} aria-hidden={!menuOpen}>
      <div className="manager-drawer__head"><Brand href={link("/barbeiro/agenda")} light name={brandName} tagline={identity?.brand.tagline} mark={identity?.brand.mark} wordmarkUrl={identity?.brand.logoUrl} /><button type="button" className="icon-button icon-button--dark" onClick={() => setMenuOpen(false)} aria-label="Fechar menu"><X size={20} /></button></div>
      {organizationSwitcher}
      <BarberNavigation navigation={navigation} profile={profile} pathname={pathname} suffix={suffix} professionalName={professionalName} onNavigate={() => setMenuOpen(false)} />
      <div className="manager-sidebar__footer">{accountFooter}</div>
    </aside>

    <div className="manager-workspace">
      <header className="manager-topbar">
        <button className="icon-button manager-topbar__menu" type="button" onClick={() => setMenuOpen(true)} aria-label="Abrir menu"><Menu size={21} /></button>
        <div className="manager-topbar__mobile-brand"><Brand href={link("/barbeiro/agenda")} compact name={brandName} mark={identity?.brand.mark} logoUrl={identity?.brand.logoUrl} /><span><strong>{context.organization_name}</strong><small>Acesso ao {organizationName}</small></span></div>
        <button type="button" className="global-search" aria-label="Buscar na agenda"><Search size={18} /><span>Buscar {customerPlural}, agendamento...</span><kbd>Ctrl K</kbd></button>
        <div className="manager-topbar__actions"><button type="button" className="icon-button notification-button" aria-label="Notificações"><Bell size={19} /></button><Avatar initials={currentInitials} tone="amber" size="sm" /></div>
      </header>
      <main className="manager-main">{children}</main>
    </div>

    {moreOpen && <><button className="barber-more-backdrop" type="button" aria-label="Fechar Mais" onClick={() => setMoreOpen(false)} /><section className="barber-more-menu" aria-label="Mais módulos"><header><strong>Mais</strong><button className="icon-button" type="button" onClick={() => setMoreOpen(false)} aria-label="Fechar Mais"><X size={18} /></button></header>{moreNavigation.length ? moreNavigation.map((item) => { const Icon = item.icon; const active = isActive(item.href); return <Link key={item.href} href={link(item.href)} className={active ? "is-active" : ""} onClick={() => setMoreOpen(false)}><Icon size={19} /><span>{item.label}</span></Link>; }) : <p>Nenhum outro módulo está habilitado.</p>}</section></>}
    <nav className="manager-bottom-nav barber-bottom-nav" aria-label="Navegação rápida">
      <Link href={link("/barbeiro/agenda")} className={isActive("/barbeiro/agenda") ? "is-active" : ""} aria-current={isActive("/barbeiro/agenda") ? "page" : undefined}><CalendarDays size={20} /><span>Agenda</span></Link>
      {context.cash_access_enabled ? <Link href={link("/barbeiro/caixa")} className={isActive("/barbeiro/caixa") ? "is-active" : ""} aria-current={isActive("/barbeiro/caixa") ? "page" : undefined}><Banknote size={20} /><span>Caixa</span></Link> : <button type="button" disabled aria-label="Caixa indisponível"><Banknote size={20} /><span>Caixa</span></button>}
      <Link href={link(profile.href)} className={isActive(profile.href) ? "is-active" : ""} aria-current={isActive(profile.href) ? "page" : undefined}><UserRound size={20} /><span>Meu</span></Link>
      <button type="button" className={moreOpen || moreNavigation.some((item) => isActive(item.href)) ? "is-active" : ""} onClick={() => setMoreOpen((open) => !open)} aria-expanded={moreOpen} aria-label="Mais opções"><Menu size={20} /><span>Mais</span></button>
    </nav>
  </div>;
}

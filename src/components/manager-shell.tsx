"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useState } from "react";
import {
  Bell,
  CalendarDays,
  ChevronDown,
  CircleHelp,
  LayoutDashboard,
  LogOut,
  Menu,
  PackageOpen,
  Search,
  Settings2,
  Sparkles,
  Users,
  WalletCards,
  X,
} from "lucide-react";
import { Brand } from "@/components/brand";
import { Avatar } from "@/components/ui";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

const navigation = [
  { href: "/gestor", label: "Visão geral", icon: LayoutDashboard, exact: true },
  { href: "/gestor/agenda", label: "Agenda", icon: CalendarDays },
  { href: "/gestor/clientes", label: "Clientes", icon: Users },
  { href: "/gestor/equipe", label: "Equipe", icon: Sparkles },
  { href: "/gestor/catalogo", label: "Serviços", icon: PackageOpen },
  { href: "/gestor/financeiro", label: "Financeiro", icon: WalletCards },
];

const financeNavigation = [
  { href: "/gestor/financeiro", label: "Visão geral", exact: true },
  { href: "/gestor/financeiro/caixa", label: "Caixa" },
  { href: "/gestor/financeiro/contas-pagar", label: "Contas a pagar" },
  { href: "/gestor/financeiro/contas-receber", label: "Contas a receber" },
  { href: "/gestor/financeiro/bancos", label: "Bancos" },
  { href: "/gestor/financeiro/fornecedores", label: "Fornecedores" },
  { href: "/gestor/financeiro/cadastros", label: "Cadastros" },
];

const ManagerBillingContext = createContext(false);

export function useManagerBillingBlocked() {
  return useContext(ManagerBillingContext);
}

function ManagerNavigation({ onNavigate, agendaCount }: { onNavigate?: () => void; agendaCount: number }) {
  const pathname = usePathname() ?? "";

  return (
    <nav className="manager-nav" aria-label="Navegação do gestor">
      <p className="manager-nav__label">Operação</p>
      {navigation.map((item) => {
        const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
        const Icon = item.icon;

        if (item.href === "/gestor/financeiro") {
          return <div className="manager-nav__group" key={item.href}>
            <Link href={item.href} className={active ? "is-active" : ""} aria-current={active ? "page" : undefined} onClick={onNavigate}>
              <Icon size={19} strokeWidth={1.8} />
              <span>{item.label}</span>
            </Link>
            {active && <div className="manager-nav__subnav" aria-label="Submenu Financeiro">
              {financeNavigation.map((subitem) => {
                const subActive = pathname === subitem.href;
                return <Link key={subitem.href} href={subitem.href} className={subActive ? "is-active" : ""} aria-current={subActive ? "page" : undefined} onClick={onNavigate}>{subitem.label}</Link>;
              })}
            </div>}
          </div>;
        }

        return (
          <Link
            href={item.href}
            key={item.href}
            className={active ? "is-active" : ""}
            aria-current={active ? "page" : undefined}
            onClick={onNavigate}
          >
            <Icon size={19} strokeWidth={1.8} />
            <span>{item.label}</span>
            {item.href === "/gestor/agenda" && <small>{agendaCount}</small>}
          </Link>
        );
      })}
      <p className="manager-nav__label manager-nav__label--second">Sistema</p>
      <Link
        href="/gestor/configuracoes"
        className={pathname.startsWith("/gestor/configuracoes") ? "is-active" : ""}
        aria-current={pathname.startsWith("/gestor/configuracoes") ? "page" : undefined}
        onClick={onNavigate}
      >
        <Settings2 size={19} strokeWidth={1.8} />
        <span>Configurações</span>
      </Link>
      <Link href="/regularizacao" onClick={onNavigate}>
        <CircleHelp size={19} strokeWidth={1.8} />
        <span>Ajuda e plano</span>
      </Link>
    </nav>
  );
}

function OrganizationSwitcher({ organizationName, locationName, organizationLogoUrl, onClick, showNotice }: { organizationName: string; locationName: string; organizationLogoUrl?: string; onClick: () => void; showNotice: boolean }) {
  return <div className="organization-switcher-wrap">
    <button className="organization-switcher" type="button" aria-label="Trocar barbearia" onClick={onClick}>
      <span
        className={`organization-switcher__mark${organizationLogoUrl ? " organization-switcher__mark--logo" : ""}`}
        aria-label={organizationLogoUrl ? `Logo de ${organizationName}` : undefined}
        role={organizationLogoUrl ? "img" : undefined}
        style={organizationLogoUrl ? { backgroundImage: `url("${organizationLogoUrl}")` } : undefined}
      >
        {!organizationLogoUrl && "LB"}
      </span>
      <span>
        <strong>{organizationName}</strong>
        <small>{locationName}</small>
      </span>
      <ChevronDown size={16} />
    </button>
    {showNotice && <p className="organization-switcher__notice" role="status">Logo você poderá adicionar uma filial da sua barbearia</p>}
  </div>;
}

export function ManagerShell({ children, demoMode = false, billingBlocked = false, organizationName = "Sua barbearia", organizationLogoUrl, locationName = "Unidade principal", userName = "Gestor", agendaCount = 0 }: { children: React.ReactNode; demoMode?: boolean; billingBlocked?: boolean; organizationName?: string; organizationLogoUrl?: string; locationName?: string; userName?: string; agendaCount?: number }) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const [organizationNotice, setOrganizationNotice] = useState(false);

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    setSignOutError("");

    try {
      if (!demoMode) {
        const supabase = getSupabaseBrowserClient();
        if (!supabase) throw new Error("Supabase não configurado.");
        const { error } = await supabase.auth.signOut({ scope: "local" });
        if (error) throw error;
      }
      router.replace("/entrar");
    } catch {
      setSignOutError("Não foi possível sair. Tente novamente.");
      setSigningOut(false);
    }
  }

  const managerProfile = (
    <div className="manager-profile">
      <Link className="manager-profile__identity" href="/gestor/configuracoes">
        <Avatar initials="GC" tone="amber" />
        <span>
          <strong>{userName}</strong>
          <small>Proprietário</small>
        </span>
      </Link>
      <button
        type="button"
        className="manager-profile__signout"
        onClick={() => void handleSignOut()}
        disabled={signingOut}
        aria-label="Sair da conta"
        aria-busy={signingOut}
        title="Sair da conta"
      >
        <LogOut size={17} aria-hidden="true" />
      </button>
      {signOutError && <p className="manager-profile__error" role="alert">{signOutError}</p>}
    </div>
  );

  return (
    <ManagerBillingContext.Provider value={billingBlocked}>
    <div className={`manager-shell ${billingBlocked ? "is-billing-blocked" : ""}`}>
      <aside className="manager-sidebar">
        <div className="manager-sidebar__brand">
          <Brand href="/gestor" light />
        </div>
        <OrganizationSwitcher organizationName={organizationName} locationName={locationName} organizationLogoUrl={organizationLogoUrl} onClick={() => setOrganizationNotice((visible) => !visible)} showNotice={organizationNotice} />
        <ManagerNavigation agendaCount={agendaCount} />
        <div className="manager-sidebar__footer">
          {managerProfile}
        </div>
      </aside>

      {menuOpen && (
        <button
          className="mobile-overlay"
          type="button"
          aria-label="Fechar menu"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <aside className={`manager-drawer ${menuOpen ? "is-open" : ""}`} aria-hidden={!menuOpen}>
        <div className="manager-drawer__head">
          <Brand href="/gestor" light />
          <button type="button" className="icon-button icon-button--dark" onClick={() => setMenuOpen(false)} aria-label="Fechar menu">
            <X size={20} />
          </button>
        </div>
        <OrganizationSwitcher organizationName={organizationName} locationName={locationName} organizationLogoUrl={organizationLogoUrl} onClick={() => setOrganizationNotice((visible) => !visible)} showNotice={organizationNotice} />
        <ManagerNavigation agendaCount={agendaCount} onNavigate={() => setMenuOpen(false)} />
        <div className="manager-sidebar__footer">
          {managerProfile}
        </div>
      </aside>

      <div className="manager-workspace">
        <header className="manager-topbar">
          <button className="icon-button manager-topbar__menu" type="button" onClick={() => setMenuOpen(true)} aria-label="Abrir menu">
            <Menu size={21} />
          </button>
          <div className="manager-topbar__mobile-brand">
            <Brand href="/gestor" compact />
            <span><strong>{organizationName}</strong><small>{locationName}</small></span>
          </div>
          <button type="button" className="global-search">
            <Search size={18} />
            <span>Buscar cliente, agendamento...</span>
            <kbd>Ctrl K</kbd>
          </button>
          <div className="manager-topbar__actions">
            <Link href="/cliente/agendar" className="topbar-preview">
              Ver página do cliente
            </Link>
            <button type="button" className="icon-button notification-button" aria-label="Notificações">
              <Bell size={19} />
              <span />
            </button>
            <Avatar initials="GC" tone="amber" size="sm" />
          </div>
        </header>
        {demoMode && <div className="demo-mode-banner"><Sparkles size={14} /><span><strong>Modo demonstração</strong> · dados locais para explorar a interface</span></div>}
        {billingBlocked && <div className="billing-restriction-banner"><CircleHelp size={14} /><span><strong>Acesso restrito por cobrança.</strong> Compromissos existentes seguem disponíveis; novas reservas e reagendamentos são bloqueados pelo servidor.</span><Link href="/regularizacao">Regularizar plano</Link></div>}
        <main className="manager-main">{children}</main>
      </div>

      <nav className="manager-bottom-nav" aria-label="Navegação rápida">
        {navigation.slice(0, 4).map((item) => (
          <ManagerBottomLink key={item.href} item={item} />
        ))}
        <button type="button" onClick={() => setMenuOpen(true)} aria-label="Mais opções">
          <Menu size={20} />
          <span>Mais</span>
        </button>
      </nav>
    </div>
    </ManagerBillingContext.Provider>
  );
}

function ManagerBottomLink({ item }: { item: (typeof navigation)[number] }) {
  const pathname = usePathname() ?? "";
  const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
  const Icon = item.icon;

  return (
    <Link href={item.href} className={active ? "is-active" : ""} aria-current={active ? "page" : undefined}>
      <Icon size={20} />
      <span>{item.label.split(" ")[0]}</span>
    </Link>
  );
}

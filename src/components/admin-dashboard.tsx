"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Activity, AlertTriangle, ArrowUpRight, Bell, Building2, CheckCircle2, ChevronDown, Clock3, CreditCard, LayoutDashboard, LogOut, MoreHorizontal, Search, Settings2, ShieldCheck, Users, WalletCards } from "lucide-react";
import { Brand } from "@/components/brand";
import { AccessChip, Avatar } from "@/components/ui";
import { adminOrganizations, formatMoney } from "@/data/demo";

export function AdminDashboard({ demoMode = false }: { demoMode?: boolean }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("Todos os status");

  const organizations = useMemo(() => adminOrganizations.filter((organization) => {
    const matchesQuery = `${organization.name} ${organization.owner}`.toLowerCase().includes(query.toLowerCase());
    const matchesStatus = status === "Todos os status" || organization.status === status;
    return matchesQuery && matchesStatus;
  }), [query, status]);

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <Brand href="/admin" light />
        <span className="admin-sidebar__mode"><ShieldCheck size={14} /> Platform admin</span>
        <nav><Link href="/admin" className="is-active"><LayoutDashboard size={18} /> Visão geral</Link><button type="button"><Building2 size={18} /> Organizações <span>124</span></button><button type="button"><CreditCard size={18} /> Assinaturas</button><button type="button"><Activity size={18} /> Eventos e auditoria</button><button type="button"><Users size={18} /> Administradores</button><button type="button"><Settings2 size={18} /> Configurações</button></nav>
        <div className="admin-sidebar__footer"><span><small>Ambiente</small><strong><i /> Produção</strong></span><Link href="/"><LogOut size={17} /> Sair</Link></div>
      </aside>
      <div className="admin-workspace">
        <header className="admin-topbar"><div><span className="admin-mobile-mark">LB</span><strong>Control plane</strong><small>/ visão geral</small></div><label className="admin-global-search"><Search size={17} /><input placeholder="Buscar tenant, owner ou ID" /></label><button type="button" className="icon-button notification-button"><Bell size={18} /><span /></button><Avatar initials="JA" tone="ink" size="sm" /></header>
        <main className="admin-main">
          {demoMode && <div className="demo-mode-banner demo-mode-banner--admin"><ShieldCheck size={14} /><span><strong>Modo demonstração</strong> · control plane sem conexão remota</span></div>}
          <header className="admin-page-heading"><div><span className="eyebrow">Control plane</span><h1>Operação Los Barberos</h1><p>Saúde da plataforma, tenants e assinaturas em um só lugar.</p></div><span className="admin-live"><i /> Sistemas operacionais</span></header>
          <section className="admin-kpis"><article><span><Building2 size={19} /></span><small>Organizações ativas</small><strong>118</strong><p><i><ArrowUpRight size={12} /> 8 este mês</i> de 124 totais</p></article><article><span><WalletCards size={19} /></span><small>MRR</small><strong>R$ 16.980</strong><p><i><ArrowUpRight size={12} /> 11,2%</i> vs. mês anterior</p></article><article><span><Clock3 size={19} /></span><small>Trials ativos</small><strong>14</strong><p>6 convertem nos próximos 7 dias</p></article><article><span><AlertTriangle size={19} /></span><small>Precisam de atenção</small><strong>6</strong><p><b>3 em carência · 3 bloqueados</b></p></article></section>
          <div className="admin-overview-grid">
            <section className="admin-chart panel"><div className="section-heading"><div><h2>Crescimento da receita</h2><p>MRR confirmado pelo Stripe</p></div><button type="button" className="select-button">6 meses <ChevronDown size={14} /></button></div><div className="admin-chart__metric"><strong>R$ 16.980</strong><span><ArrowUpRight size={13} /> +38% no período</span></div><div className="admin-chart__visual"><span /><span /><span /><span /><svg viewBox="0 0 600 180" preserveAspectRatio="none"><defs><linearGradient id="adminArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#c58a46" stopOpacity=".28"/><stop offset="1" stopColor="#c58a46" stopOpacity="0"/></linearGradient></defs><path d="M0 154 C60 147,76 134,120 132 S186 111,240 116 S310 88,360 89 S430 58,480 62 S553 29,600 24 L600 180 L0 180Z" fill="url(#adminArea)"/><path d="M0 154 C60 147,76 134,120 132 S186 111,240 116 S310 88,360 89 S430 58,480 62 S553 29,600 24" fill="none" stroke="#c58a46" strokeWidth="3" vectorEffect="non-scaling-stroke"/></svg><div><span>Mar</span><span>Abr</span><span>Mai</span><span>Jun</span><span>Jul</span><span>Ago</span></div></div></section>
            <section className="admin-health panel"><div className="section-heading"><div><h2>Saúde das integrações</h2><p>Atualizado agora</p></div></div>{[["Supabase", "Banco e Auth", "99,99%"], ["Stripe", "Billing SaaS", "100%"], ["Mercado Pago", "Pagamentos tenants", "99,97%"], ["Meta WhatsApp", "Mensageria", "99,95%"]].map(([name, detail, uptime]) => <div key={name}><span className={`admin-health__logo admin-health__logo--${name.toLowerCase().split(" ")[0]}`}>{name[0]}</span><span><strong>{name}</strong><small>{detail}</small></span><i><CheckCircle2 size={14} /> Operacional</i><b>{uptime}</b></div>)}</section>
          </div>
          <section className="panel admin-organizations">
            <div className="section-heading"><div><h2>Organizações</h2><p>Acesso, assinatura e atividade recente</p></div><button type="button" className="button button--dark"><Building2 size={16} /> Criar tenant</button></div>
            <div className="admin-table-toolbar"><label className="search-input"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar organização ou responsável" /></label><label className="select-shell"><select value={status} onChange={(event) => setStatus(event.target.value)}><option>Todos os status</option><option value="ACTIVE">ACTIVE</option><option value="TRIALING">TRIALING</option><option value="GRACE">GRACE</option><option value="BLOCKED">BLOCKED</option></select><ChevronDown size={14} /></label></div>
            <div className="admin-table-wrap"><table className="data-table admin-table"><thead><tr><th>Organização</th><th>Plano</th><th>Status</th><th>MRR</th><th>Agendamentos</th><th>Desde</th><th><span className="sr-only">Ações</span></th></tr></thead><tbody>{organizations.map((organization, index) => <tr key={organization.id}><td><div className="table-person"><Avatar initials={organization.name.split(" ").slice(0, 2).map((part) => part[0]).join("")} tone={index % 2 ? "amber" : "sage"} /><span><strong>{organization.name}</strong><small>{organization.owner} · {organization.id}</small></span></div></td><td><span className="plan-chip">{organization.plan}</span></td><td><AccessChip status={organization.status} /></td><td><strong>{formatMoney(organization.mrrCents)}</strong></td><td>{organization.appointments.toLocaleString("pt-BR")}</td><td>{organization.since}</td><td><button type="button" className="icon-button icon-button--sm"><MoreHorizontal size={17} /></button></td></tr>)}</tbody></table>{organizations.length === 0 && <div className="empty-search"><Search size={24} /><strong>Nenhuma organização encontrada</strong></div>}</div>
          </section>
          <section className="admin-audit-strip"><span><Activity size={18} /></span><div><strong>Último evento de acesso</strong><small><b>org-03</b> entrou em GRACE após invoice.payment_failed · há 12 min</small></div><button type="button">Ver trilha de auditoria</button></section>
        </main>
      </div>
    </div>
  );
}

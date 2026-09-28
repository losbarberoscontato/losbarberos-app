import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpRight,
  Bell,
  Blocks,
  BriefcaseBusiness,
  CreditCard,
  Gauge,
  LayoutDashboard,
  Palette,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  UsersRound,
} from "lucide-react";
import { getAccessContext, isPlatformAdminUser } from "@/lib/auth/context";
import { hasSupabaseConfig } from "@/lib/env";

export const metadata: Metadata = {
  title: { absolute: "Administração Display SH" },
  robots: { index: false, follow: false },
};

const sections = [
  { icon: LayoutDashboard, label: "Visão geral", active: true },
  { icon: Blocks, label: "Produtos" },
  { icon: Palette, label: "Identidade visual" },
  { icon: SlidersHorizontal, label: "Módulos" },
  { icon: UsersRound, label: "Assinantes" },
  { icon: CreditCard, label: "Planos e cobrança" },
  { icon: BriefcaseBusiness, label: "Comercial" },
  { icon: Settings2, label: "Configurações" },
];

export default async function DisplayAdminPage() {
  const context = hasSupabaseConfig ? await getAccessContext() : null;
  if (!hasSupabaseConfig) redirect("/entrar?erro=supabase_not_configured&next=%2Fdisplay-admin");
  if (!context) redirect("/entrar?modo=login&next=%2Fdisplay-admin");

  const isPlatformAdmin = await isPlatformAdminUser(context.userId);
  if (!isPlatformAdmin) {
    if (context.role === "OWNER") redirect("/gestor");
    if (context.role === "CLIENT") redirect("/cliente/agendar");
    redirect("/onboarding");
  }
  return (
    <main className="display-admin">
      <aside className="display-admin__sidebar">
        <Link href="/" className="display-admin__brand" aria-label="Display SH — início"><span className="display-admin__symbol">D</span><span><strong>DISPLAY SH</strong><small>ECOSSISTEMA</small></span></Link>
        <p className="display-admin__nav-label">ADMINISTRAÇÃO</p>
        <nav aria-label="Administração Display SH">
          {sections.map(({ icon: Icon, label, active }) => <span key={label} className={`display-admin__nav-item${active ? " is-active" : ""}`} aria-current={active ? "page" : undefined}><Icon size={18} strokeWidth={1.7} />{label}</span>)}
        </nav>
        <div className="display-admin__sidebar-foot"><span><ShieldCheck size={16} /> ÁREA RESTRITA</span><Link href="/">Voltar ao site <ArrowUpRight size={14} /></Link></div>
      </aside>

      <section className="display-admin__main">
        <header className="display-admin__topbar">
          <div className="display-admin__breadcrumb">Display SH <span>/</span> Visão geral</div>
          <div className="display-admin__top-actions"><button type="button" aria-label="Pesquisar" disabled><Search size={18} /></button><button type="button" aria-label="Notificações" disabled><Bell size={18} /></button><span className="display-admin__avatar">DS</span></div>
        </header>
        <div className="display-admin__content">
          <div className="display-admin__heading"><div><p>PAINEL DO ECOSSISTEMA</p><h1>Visão geral</h1><span>Produtos, módulos e operação Display SH em um só lugar.</span></div><button type="button" className="display-admin__export" disabled><ArrowDownToLine size={16} /> Exportar relatório</button></div>
          <div className="display-admin__prototype"><Activity size={17} /><span><strong>Protótipo visual</strong> — ainda sem dados ou ações conectadas.</span></div>

          <section className="display-admin__stats" aria-label="Indicadores do ecossistema">
            {[["Produtos", "—", "Soluções do ecossistema", Blocks], ["Assinantes", "—", "Contas ativas", UsersRound], ["Receita recorrente", "—", "Resumo financeiro", CreditCard], ["Saúde da plataforma", "—", "Indicadores operacionais", Gauge]].map(([label, value, detail, Icon]) => {
              const StatIcon = Icon as typeof Blocks;
              return <article className="display-admin__stat" key={label as string}><div><span>{label as string}</span><StatIcon size={18} /></div><strong>{value as string}</strong><small>{detail as string}</small></article>;
            })}
          </section>

          <div className="display-admin__workbench">
            <section className="display-admin__panel display-admin__catalog">
              <header><div><h2>Produtos do ecossistema</h2><p>Identidade, segmento e estado de cada sistema.</p></div><button type="button" aria-label="Mais opções">•••</button></header>
              <div className="display-admin__table-wrap"><table><thead><tr><th>PRODUTO</th><th>SEGMENTO</th><th>STATUS</th><th>MÓDULOS</th></tr></thead><tbody>
                {[["Los Barberos", "Barbearias", "Disponível", "—", "lb"], ["ProStetic", "Estética e beleza", "Preparação", "—", "ps"], ["Le Gras", "Fotografia", "Planejado", "—", "lg"], ["MusicPro", "Escolas de música", "Planejado", "—", "mp"]].map(([name, audience, status, count, monogram]) => <tr key={name}><td><span className={`display-admin__product-mark mark-${monogram}`}>{monogram.toUpperCase()}</span><strong>{name}</strong></td><td>{audience}</td><td><span className={`display-admin__status status-${monogram}`}>{status}</span></td><td>{count}</td></tr>)}
              </tbody></table></div>
            </section>
            <section className="display-admin__panel display-admin__quick">
              <header><div><h2>Ajustes do ecossistema</h2><p>Estrutura prevista para evolução.</p></div><Settings2 size={19} /></header>
              <div><span><Palette size={18} /><b>Identidade dos produtos</b></span><small>Logos, cores, fontes e vocabulário</small><ArrowUpRight size={15} /></div>
              <div><span><SlidersHorizontal size={18} /><b>Catálogo de módulos</b></span><small>Disponibilidade por produto</small><ArrowUpRight size={15} /></div>
              <div><span><CreditCard size={18} /><b>Planos e assinaturas</b></span><small>Valores e gestão de acesso</small><ArrowUpRight size={15} /></div>
            </section>
          </div>

          <footer className="display-admin__footer"><span>Display SH · Painel administrativo</span><span>Visual de referência · sem conexão com dados</span></footer>
        </div>
      </section>
    </main>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Activity, ArrowUpRight, Blocks, BriefcaseBusiness, CreditCard, LayoutDashboard, Palette, Settings2, ShieldCheck, SlidersHorizontal, UsersRound } from "lucide-react";
import { getAccessContext, isPlatformAdminUser } from "@/lib/auth/context";
import { hasSupabaseConfig } from "@/lib/env";
import { ProductIdentityEditor } from "@/components/display-admin/product-identity-editor";

export const metadata: Metadata = { title: { absolute: "Identidade visual · Display SH" }, robots: { index: false, follow: false } };

const sections = [
  { icon: LayoutDashboard, label: "Visão geral", href: "/display-admin" },
  { icon: Blocks, label: "Produtos", href: "/display-admin" },
  { icon: Palette, label: "Identidade visual", href: "/display-admin/identidade-visual", active: true },
  { icon: SlidersHorizontal, label: "Módulos", href: "/display-admin" },
  { icon: UsersRound, label: "Assinantes", href: "/display-admin" },
  { icon: CreditCard, label: "Planos e cobrança", href: "/display-admin" },
  { icon: BriefcaseBusiness, label: "Comercial", href: "/display-admin" },
  { icon: Settings2, label: "Configurações", href: "/display-admin" },
];

export default async function ProductIdentityPage() {
  const context = hasSupabaseConfig ? await getAccessContext() : null;
  const isAdmin = Boolean(context && await isPlatformAdminUser(context.userId));
  if (!isAdmin) redirect("/entrar?modo=login&next=%2Fdisplay-admin%2Fidentidade-visual");

  return <main className="display-admin">
    <aside className="display-admin__sidebar">
      <Link href="/" className="display-admin__brand" aria-label="Display SH — início"><span className="display-admin__symbol">D</span><span><strong>DISPLAY SH</strong><small>ECOSSISTEMA</small></span></Link>
      <p className="display-admin__nav-label">ADMINISTRAÇÃO</p>
      <nav aria-label="Administração Display SH">{sections.map(({ icon: Icon, label, href, active }) => <Link key={label} href={href} className={`display-admin__nav-item${active ? " is-active" : ""}`} aria-current={active ? "page" : undefined}><Icon size={18} strokeWidth={1.7} />{label}</Link>)}</nav>
      <div className="display-admin__sidebar-foot"><span><ShieldCheck size={16} /> ÁREA RESTRITA</span><Link href="/">Voltar ao site <ArrowUpRight size={14} /></Link></div>
    </aside>
    <section className="display-admin__main">
      <header className="display-admin__topbar"><div className="display-admin__breadcrumb"><Link href="/display-admin">Display SH</Link><span>/</span>Identidade visual</div><span className="display-admin__avatar">DS</span></header>
      <div className="display-admin__content identity-admin-content">
        <div className="display-admin__heading"><div><p>APARÊNCIA DOS PRODUTOS</p><h1>Identidade visual</h1><span>Edite a apresentação visual sem alterar regras ou dados do sistema.</span></div></div>
        <div className="display-admin__prototype"><Activity size={17} /><span><strong>Editor de identidade</strong> — alterações em rascunho só aparecem após publicação.</span></div>
        <ProductIdentityEditor />
      </div>
    </section>
  </main>;
}

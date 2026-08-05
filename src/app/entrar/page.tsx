import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, CalendarCheck2, CircleCheck, MessageCircle, ShieldCheck } from "lucide-react";
import { Brand } from "@/components/brand";
import { DemoLogin } from "@/components/demo-login";
import { hasSupabaseConfig } from "@/lib/env";

export const metadata: Metadata = { title: "Entrar" };

export default function LoginPage() {
  return (
    <main className="login-page">
      <section className="login-story">
        <div className="login-story__pattern" />
        <Brand light />
        <div className="login-story__content">
          <span className="hero-pill"><CircleCheck size={15} /> ambiente demonstrativo</span>
          <h2>Um dia organizado começa antes da primeira tesourada.</h2>
          <p>Veja sua agenda, antecipe recebimentos e mantenha cada cliente por perto.</p>
          <div className="login-story__cards">
            <div><span><CalendarCheck2 size={18} /></span><strong>12 agendamentos</strong><small>9 já confirmados hoje</small></div>
            <div><span><MessageCircle size={18} /></span><strong>Lembretes automáticos</strong><small>Menos faltas, mais previsibilidade</small></div>
            <div><span><ShieldCheck size={18} /></span><strong>Operação protegida</strong><small>Dados isolados por barbearia</small></div>
          </div>
        </div>
        <small className="login-story__quote">“Simples de usar. Difícil imaginar a barbearia sem.”</small>
      </section>
      <section className="login-form-side">
        <div className="login-mobile-head"><Brand /><Link href="/"><ArrowLeft size={16} /> Início</Link></div>
        <Link className="login-back" href="/"><ArrowLeft size={16} /> Voltar para o início</Link>
        <DemoLogin demoMode={!hasSupabaseConfig} />
        <small className="login-legal">Ao continuar, você concorda com os Termos de Uso e a Política de Privacidade.</small>
      </section>
    </main>
  );
}

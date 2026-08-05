"use client";

import Link from "next/link";
import { useState } from "react";
import { AlertTriangle, ArrowRight, Check, CheckCircle2, ChevronDown, CreditCard, ExternalLink, FileText, LockKeyhole, ShieldCheck } from "lucide-react";
import { Brand } from "@/components/brand";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { BillingStatus } from "@/lib/domain/types";

export function BillingRegularization({ organizationId, billingStatus, graceEndsAt, retentionEndsAt }: { organizationId: string | null; billingStatus: BillingStatus | null; graceEndsAt?: string | null; retentionEndsAt?: string | null }) {
  const [demoPortalOpen, setDemoPortalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const active = billingStatus === "ACTIVE" || billingStatus === "TRIALING";
  const grace = billingStatus === "GRACE";
  const retention = billingStatus === "CANCELED_RETENTION";
  const formatDeadline = (value?: string | null) => value
    ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "long" }).format(new Date(value))
    : "prazo informado pelo Stripe";

  async function openPortal() {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !organizationId) {
      setDemoPortalOpen(true);
      return;
    }

    setLoading(true);
    setError("");
    const { data, error: invokeError } = await supabase.functions.invoke("stripe-create-portal", {
      body: { organizationId, returnPath: "/regularizacao" },
      headers: { "Idempotency-Key": crypto.randomUUID() },
    });
    setLoading(false);

    const portalUrl = data && typeof data === "object" && "portalUrl" in data ? data.portalUrl : null;
    if (invokeError || typeof portalUrl !== "string") {
      setError("Não foi possível abrir o portal agora. Tente novamente ou fale com o suporte.");
      return;
    }

    window.location.assign(portalUrl);
  }

  return (
    <div className="billing-page">
      <header className="billing-topbar"><Brand href="/gestor" /><div><span>Plano da sua organização</span><i>LB</i></div></header>
      <main className="billing-main">
        <div className="billing-heading"><span className="eyebrow">Plano e cobrança</span><h1>{active ? "Assinatura em dia." : retention ? "Assinatura cancelada." : grace ? "Sua conta está em carência." : "Vamos colocar sua barbearia em dia."}</h1><p>{active ? "O Stripe confirmou o estado da assinatura por webhook." : retention ? `A operação foi encerrada. Exporte os dados até ${formatDeadline(retentionEndsAt)}.` : grace ? `O acesso continua completo até ${formatDeadline(graceEndsAt)} enquanto você regulariza o pagamento.` : "Novas reservas e reagendamentos estão pausados. Compromissos existentes continuam seguros."}</p></div>
        {active ? (
          <section className="billing-success-card"><span><Check size={31} /></span><h2>Assinatura ativa</h2><p>Recebemos a confirmação do Stripe e liberamos todas as funções.</p><div><span><small>Plano</small><strong>Plano vigente no Stripe</strong></span><span><small>Próxima cobrança</small><strong>Consulte no Customer Portal</strong></span><span><small>Valor</small><strong>Confirmado pelo Stripe Price</strong></span></div><Link href="/gestor" className="button button--dark">Voltar ao painel <ArrowRight size={17} /></Link></section>
        ) : (
          <div className="billing-grid">
            <div className="billing-primary">
              <section className="billing-alert"><span><AlertTriangle size={21} /></span><div><strong>{retention ? "Janela de exportação" : grace ? "Carência em andamento" : "Acesso restrito por cobrança"}</strong><p>{retention ? "Somente cobrança e exportação permanecem disponíveis." : grace ? "O painel segue liberado durante a carência; atualize o pagamento antes do prazo." : "Novas reservas e reagendamentos estão pausados. Atendimentos existentes e reembolsos continuam disponíveis."}</p></div><i>{retention ? `até ${formatDeadline(retentionEndsAt)}` : grace ? `até ${formatDeadline(graceEndsAt)}` : "regularização necessária"}</i></section>
              <section className="panel billing-invoice"><div className="billing-invoice__head"><div><span className="billing-invoice__icon"><FileText size={20} /></span><span><small>Fatura pendente</small><strong>Consulte os detalhes no Stripe</strong></span></div><i>Vencida</i></div><div className="billing-invoice__total"><span><small>Valor pendente</small><strong>Valor do seu plano</strong></span><span><small>Vencimento</small><strong>Informado no portal</strong></span><span><small>Fonte</small><strong>Stripe Billing</strong></span></div><div className="billing-invoice__reason"><CreditCard size={18} /><span><strong>Forma de pagamento precisa de atenção</strong><small>Atualize os dados somente no ambiente seguro do Stripe.</small></span></div>
                <button type="button" className="button button--dark button--block" onClick={openPortal} disabled={loading}><CreditCard size={17} /> {loading ? "Abrindo portal seguro..." : "Abrir Customer Portal"} <ExternalLink size={15} /></button>
                {retention && <Link href="/gestor/configuracoes" className="button button--soft button--block">Exportar dados da organização <FileText size={16} /></Link>}
                {error && <p className="billing-portal-error" role="alert">{error}</p>}
                {demoPortalOpen && <div className="billing-portal-demo"><div><LockKeyhole size={17} /><span><strong>Redirecionamento seguro · demonstração</strong><small>Com Supabase e Stripe configurados, este botão cria uma sessão do Customer Portal e redireciona para stripe.com. Nenhum dado de cartão passa pelo Los Barberos.</small></span></div><button type="button" className="button button--soft button--block" onClick={() => setDemoPortalOpen(false)}>Entendi</button></div>}
              </section>
              <section className="billing-keep-running"><h2>O que continua funcionando</h2><div><span><CheckCircle2 size={18} /><strong>Agenda existente</strong><small>Visualize e conclua atendimentos marcados.</small></span><span><CheckCircle2 size={18} /><strong>Reembolsos</strong><small>Cancele e devolva valores quando necessário.</small></span><span><CheckCircle2 size={18} /><strong>Lembretes</strong><small>Mensagens já programadas seguem normalmente.</small></span></div></section>
            </div>
            <aside className="billing-aside">
              <section className="panel current-plan"><span className="current-plan__tag">Plano atual</span><h2>Plano vigente no Stripe</h2><div className="current-plan__dynamic"><strong>Valor e ciclo</strong><small>definidos no Stripe Price</small></div><ul><li><Check size={15} /> Uma unidade no MVP</li><li><Check size={15} /> Agenda e clientes</li><li><Check size={15} /> Pagamentos e WhatsApp</li><li><Check size={15} /> Comissões e relatórios</li></ul><button type="button" onClick={openPortal}>Ver detalhes no portal <ChevronDown size={14} /></button></section>
              <section className="panel billing-security"><ShieldCheck size={22} /><h3>Pagamento seguro</h3><p>Dados do cartão são processados pelo Stripe. Los Barberos não armazena o número completo.</p></section>
              <section className="billing-support"><span>Precisa de ajuda?</span><p>Nossa equipe responde em horário comercial.</p><a href="mailto:suporte@losbarberos.com.br">Falar com suporte <ArrowRight size={15} /></a></section>
            </aside>
          </div>
        )}
      </main>
      <footer className="billing-footer"><span><ShieldCheck size={14} /> Conexão segura</span><span>Los Barberos · Suporte · Privacidade</span></footer>
    </div>
  );
}

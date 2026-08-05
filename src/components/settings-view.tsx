"use client";

import Link from "next/link";
import { useState } from "react";
import { BellRing, Building2, Check, ChevronRight, Clock3, CreditCard, ExternalLink, Globe2, Link2, MapPin, MessageCircle, Save, ShieldCheck, SlidersHorizontal, Smartphone, WalletCards } from "lucide-react";

type SettingsTab = "business" | "rules" | "integrations" | "notifications";

export function SettingsView() {
  const [tab, setTab] = useState<SettingsTab>("business");
  const [saved, setSaved] = useState("");
  const [deposit, setDeposit] = useState("30");
  const [reminders, setReminders] = useState(true);

  function save(message: string) {
    setSaved(message);
    window.setTimeout(() => setSaved(""), 3000);
  }

  return (
    <>
      <div className="settings-layout">
        <aside className="settings-nav" aria-label="Seções de configuração">
          <button type="button" className={tab === "business" ? "is-active" : ""} onClick={() => setTab("business")}><Building2 size={18} /><span><strong>Barbearia</strong><small>Perfil e unidade</small></span><ChevronRight size={15} /></button>
          <button type="button" className={tab === "rules" ? "is-active" : ""} onClick={() => setTab("rules")}><SlidersHorizontal size={18} /><span><strong>Regras de agenda</strong><small>Sinal e cancelamento</small></span><ChevronRight size={15} /></button>
          <button type="button" className={tab === "integrations" ? "is-active" : ""} onClick={() => setTab("integrations")}><Link2 size={18} /><span><strong>Integrações</strong><small>Pagamentos e WhatsApp</small></span><ChevronRight size={15} /></button>
          <button type="button" className={tab === "notifications" ? "is-active" : ""} onClick={() => setTab("notifications")}><BellRing size={18} /><span><strong>Notificações</strong><small>Templates e lembretes</small></span><ChevronRight size={15} /></button>
          <Link href="/regularizacao"><CreditCard size={18} /><span><strong>Plano e cobrança</strong><small>Pro · ativo</small></span><ChevronRight size={15} /></Link>
        </aside>

        <div className="settings-content">
          {tab === "business" && (
            <section className="panel settings-section">
              <div className="settings-section__head"><div><h2>Perfil da barbearia</h2><p>Informações exibidas na página de agendamento.</p></div><span className="settings-completion"><i style={{ width: "84%" }} />84% completo</span></div>
              <div className="business-logo-row"><div className="business-logo">LB</div><span><strong>Marca da unidade</strong><small>SVG, PNG ou JPG · máx. 2 MB</small><button type="button">Alterar imagem</button></span></div>
              <div className="settings-form-grid"><label>Nome da barbearia<input defaultValue="Los Barberos" /></label><label>Nome da unidade<input defaultValue="Vila Madalena" /></label><label>Telefone comercial<input defaultValue="+55 11 3456-9080" /></label><label>Fuso horário<span className="select-input"><select defaultValue="America/Sao_Paulo"><option value="America/Sao_Paulo">São Paulo · GMT-3</option></select><Globe2 size={16} /></span></label></div>
              <label>Descrição pública<textarea rows={3} defaultValue="Tradição, técnica e uma boa conversa. Cortes, barba e cuidados masculinos no coração da Vila Madalena." /><small>144/220 caracteres</small></label>
              <div className="settings-address"><MapPin size={19} /><div><strong>Endereço da unidade</strong><div className="settings-form-grid"><label>Rua<input defaultValue="Rua Harmonia" /></label><label>Número<input defaultValue="214" /></label><label>Bairro<input defaultValue="Vila Madalena" /></label><label>Cidade / UF<input defaultValue="São Paulo / SP" /></label></div></div></div>
              <footer><button type="button" className="button button--dark" onClick={() => save("Perfil da barbearia salvo.")}><Save size={17} /> Salvar alterações</button></footer>
            </section>
          )}

          {tab === "rules" && (
            <section className="panel settings-section">
              <div className="settings-section__head"><div><h2>Regras de agenda e pagamento</h2><p>Estas regras são congeladas em cada nova reserva.</p></div><span className="security-badge"><ShieldCheck size={15} /> Regras auditáveis</span></div>
              <div className="rule-card"><span className="rule-card__icon"><WalletCards size={20} /></span><div><strong>Sinal obrigatório</strong><p>Percentual cobrado para proteger o horário.</p><label><input type="range" min="0" max="100" step="5" value={deposit} onChange={(event) => setDeposit(event.target.value)} /><span>{deposit}%</span></label><small>Exemplo: em um serviço de R$ 100, o cliente paga R$ {deposit},00 agora.</small></div></div>
              <div className="rule-card"><span className="rule-card__icon tone-amber"><Clock3 size={20} /></span><div><strong>Prazo para cancelamento</strong><p>Antes desse prazo, devolvemos todo valor capturado.</p><span className="unit-input"><input type="number" defaultValue="24" min="1" /><i>horas antes</i></span><small>Depois do prazo, o sinal é retido e o excedente é reembolsado.</small></div></div>
              <div className="rule-card"><span className="rule-card__icon tone-blue"><Smartphone size={20} /></span><div><strong>Intervalo de início</strong><p>Grade usada para sugerir horários aos clientes.</p><div className="option-row">{[10, 15, 30].map((value) => <button type="button" className={value === 15 ? "is-active" : ""} key={value}>{value} min</button>)}</div><small>Durações são arredondadas para cima na ocupação.</small></div></div>
              <footer><button type="button" className="button button--dark" onClick={() => save("Regras aplicadas a novas reservas.")}><Save size={17} /> Salvar regras</button></footer>
            </section>
          )}

          {tab === "integrations" && (
            <section className="settings-integrations">
              <div className="settings-section__head"><div><h2>Integrações</h2><p>Conecte os serviços que fazem sua operação fluir.</p></div></div>
              <article className="integration-card panel"><span className="integration-logo integration-logo--mp">mp</span><div><span className="integration-card__title"><strong>Mercado Pago</strong><i className="connected"><span /> Conectado</i></span><p>Receba sinal ou pagamento integral direto na conta da barbearia.</p><small>Conta: comercial@losbarberos.com.br · Atualizada há 4 min</small></div><div className="integration-card__actions"><button type="button" className="button button--soft">Gerenciar <ExternalLink size={15} /></button><button type="button" className="text-danger">Desconectar</button></div></article>
              <article className="integration-card panel"><span className="integration-logo integration-logo--wa"><MessageCircle size={24} /></span><div><span className="integration-card__title"><strong>WhatsApp Business</strong><i className="connected"><span /> Conectado</i></span><p>Envie confirmações, lembretes e ações seguras aos clientes.</p><small>+55 11 3456-9080 · 3 templates aprovados</small></div><div className="integration-card__actions"><button type="button" className="button button--soft">Ver templates <ExternalLink size={15} /></button><button type="button" className="text-danger">Desconectar</button></div></article>
              <article className="integration-card panel"><span className="integration-logo integration-logo--stripe">S</span><div><span className="integration-card__title"><strong>Stripe Billing</strong><i className="connected"><span /> Assinatura ativa</i></span><p>Gerencia o plano Los Barberos, notas e forma de pagamento do SaaS.</p><small>Data e valor vigentes são consultados no Customer Portal.</small></div><div className="integration-card__actions"><Link href="/regularizacao" className="button button--soft">Abrir portal <ExternalLink size={15} /></Link></div></article>
              <div className="integration-security"><ShieldCheck size={18} /><span><strong>Credenciais protegidas.</strong> Tokens e segredos nunca ficam no navegador ou em tabelas públicas.</span></div>
            </section>
          )}

          {tab === "notifications" && (
            <section className="panel settings-section">
              <div className="settings-section__head"><div><h2>Notificações transacionais</h2><p>Mensagens de serviço enviadas pelo WhatsApp.</p></div><span className="security-badge"><MessageCircle size={15} /> 3 templates aprovados</span></div>
              <div className="notification-setting"><span className="notification-setting__icon"><Check size={18} /></span><div><strong>Confirmação da reserva</strong><p>Enviada imediatamente após confirmação do pagamento.</p><small>Template: reserva_confirmada_v2</small></div><label className="switch"><input type="checkbox" defaultChecked /><span /></label></div>
              <div className="notification-setting"><span className="notification-setting__icon tone-amber"><Clock3 size={18} /></span><div><strong>Lembrete no dia</strong><p>Enviado às 07:00 no fuso da barbearia.</p><small>Template: lembrete_agendamento_v3</small></div><label className="switch"><input type="checkbox" checked={reminders} onChange={(event) => setReminders(event.target.checked)} /><span /></label></div>
              <div className="notification-setting"><span className="notification-setting__icon tone-blue"><MessageCircle size={18} /></span><div><strong>Cancelamento em dois passos</strong><p>Permite cancelar com ação opaca, temporária e de uso único.</p><small>Template: confirmar_cancelamento_v1</small></div><label className="switch"><input type="checkbox" defaultChecked /><span /></label></div>
              <div className="notification-preview"><Smartphone size={19} /><div><span><strong>Los Barberos</strong><small>WhatsApp Business</small></span><p>Olá, Rafael! Seu horário está confirmado para <b>terça, 4 ago, às 10:45</b> com Diego. Até logo!</p><i>Cancelar reserva</i></div></div>
              <footer><button type="button" className="button button--dark" onClick={() => save("Preferências de notificação salvas.")}><Save size={17} /> Salvar preferências</button></footer>
            </section>
          )}
        </div>
      </div>
      {saved && <div className="toast-message"><Check size={17} /><span>{saved}</span></div>}
    </>
  );
}

"use client";

import { useState } from "react";
import { BellRing, Cake, Check, ChevronRight, LogOut, Mail, MapPin, MessageCircle, Phone, Save, ShieldCheck, UserRound } from "lucide-react";

export function CustomerProfile() {
  const [whatsApp, setWhatsApp] = useState(true);
  const [saved, setSaved] = useState("");

  function save() {
    setSaved("Perfil atualizado.");
    window.setTimeout(() => setSaved(""), 2800);
  }

  return (
    <>
      <div className="customer-page-heading"><span className="eyebrow">Sua conta</span><h1>Perfil e preferências</h1><p>Mantenha seus dados atualizados e escolha como falar com você.</p></div>
      <div className="customer-profile-grid">
        <aside className="customer-profile-card">
          <div className="customer-profile-card__avatar">RM<button type="button" aria-label="Alterar foto">+</button></div><h2>Rafael Martins</h2><p>Cliente desde janeiro de 2025</p><div><span><strong>18</strong><small>visitas</small></span><span><strong>4,9</strong><small>avaliação</small></span></div><span className="customer-profile-card__tag"><Check size={13} /> Cliente fiel</span>
          <nav><button type="button" className="is-active"><UserRound size={17} /> Dados pessoais <ChevronRight size={15} /></button><button type="button"><BellRing size={17} /> Notificações <ChevronRight size={15} /></button><button type="button"><ShieldCheck size={17} /> Privacidade <ChevronRight size={15} /></button><button type="button" className="is-danger"><LogOut size={17} /> Sair</button></nav>
        </aside>
        <div className="customer-profile-main">
          <section className="booking-review-card profile-form"><div className="booking-review-card__head"><div><h2>Dados pessoais</h2><p>Usados para identificar e confirmar seus agendamentos.</p></div></div><div className="settings-form-grid"><label>Nome completo<span className="input-shell"><UserRound size={17} /><input defaultValue="Rafael Martins" /></span></label><label>Telefone<span className="input-shell"><Phone size={17} /><input defaultValue="+55 11 98814-5021" /></span></label><label>E-mail<span className="input-shell"><Mail size={17} /><input type="email" defaultValue="rafael.martins@email.com" /></span></label><label>Data de nascimento <small>opcional</small><span className="input-shell"><Cake size={17} /><input type="date" defaultValue="1992-06-18" /></span></label></div><button type="button" className="button button--dark" onClick={save}><Save size={16} /> Salvar dados</button></section>
          <section className="booking-review-card customer-preferences"><div className="booking-review-card__head"><div><h2>Comunicação</h2><p>Mensagens transacionais sobre suas reservas.</p></div></div><div className="notification-setting"><span className="notification-setting__icon"><MessageCircle size={18} /></span><div><strong>WhatsApp transacional</strong><p>Confirmações, lembretes e alterações de horário.</p></div><label className="switch"><input type="checkbox" checked={whatsApp} onChange={(event) => setWhatsApp(event.target.checked)} /><span /></label></div><div className="profile-consent"><ShieldCheck size={16} /><span>Seu consentimento pode ser retirado a qualquer momento. Mensagens de marketing nunca são ativadas automaticamente.</span></div></section>
          <section className="booking-review-card preferred-location"><div className="booking-review-card__head"><div><h2>Unidade preferida</h2><p>Usada como padrão nos novos agendamentos.</p></div><button type="button">Alterar</button></div><div><span><MapPin size={20} /></span><p><strong>Los Barberos · Vila Madalena</strong><small>Rua Harmonia, 214 · São Paulo, SP</small></p><Check size={18} /></div></section>
        </div>
      </div>
      {saved && <div className="toast-message"><Check size={17} /><span>{saved}</span></div>}
    </>
  );
}


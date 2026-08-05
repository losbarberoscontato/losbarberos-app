"use client";

import Link from "next/link";
import { useState } from "react";
import { AlertTriangle, CalendarDays, CalendarPlus2, Check, ChevronRight, Clock3, MapPin, MessageCircle, MoreHorizontal, RotateCcw, Scissors, X } from "lucide-react";
import { formatMoney } from "@/data/demo";

export function CustomerReservations() {
  const [cancelOpen, setCancelOpen] = useState(false);
  const [canceled, setCanceled] = useState(false);
  const [toast, setToast] = useState("");

  function cancel() {
    setCancelOpen(false);
    setCanceled(true);
    setToast("Reserva cancelada. Reembolso de R$ 55,00 iniciado.");
    window.setTimeout(() => setToast(""), 3500);
  }

  return (
    <>
      <div className="customer-page-heading"><span className="eyebrow">Sua agenda</span><h1>Minhas reservas</h1><p>Acompanhe, remarque ou cancele seus próximos horários.</p></div>
      {!canceled ? (
        <section className="next-booking-card">
          <div className="next-booking-card__banner"><span><i />Próximo atendimento</span><small>Faltam 3 dias</small></div>
          <div className="next-booking-card__body">
            <div className="next-booking-card__date"><span>AGO</span><strong>07</strong><small>Sexta</small></div>
            <div className="next-booking-card__main"><span className="next-booking-card__status"><Check size={13} /> Confirmado</span><h2>Ritual Los Barberos</h2><p>Corte clássico + barba premium</p><div><span><Clock3 size={16} /> 14:15 — 15:45</span><span><Scissors size={16} /> Diego Alves</span><span><MapPin size={16} /> Vila Madalena</span></div></div>
            <div className="next-booking-card__payment"><small>Valor total</small><strong>{formatMoney(10500)}</strong><span>Sinal pago · R$ 32,00</span><i>Saldo: R$ 73,00</i></div>
          </div>
          <footer><button type="button" className="button button--soft"><CalendarDays size={16} /> Adicionar ao calendário</button><button type="button" className="button button--soft"><MessageCircle size={16} /> Falar com a barbearia</button><span /><button type="button" className="text-button" onClick={() => setCancelOpen(true)}>Cancelar</button><button type="button" className="button button--dark"><RotateCcw size={16} /> Reagendar</button></footer>
        </section>
      ) : (
        <section className="canceled-booking"><span><Check size={24} /></span><div><h2>Reserva cancelada</h2><p>O reembolso de R$ 55,00 foi iniciado e será processado pelo mesmo meio de pagamento.</p></div><Link href="/cliente/agendar" className="button button--dark"><CalendarPlus2 size={16} /> Novo horário</Link></section>
      )}

      <section className="reservation-history">
        <div className="section-heading"><div><h2>Histórico</h2><p>Seus últimos atendimentos</p></div><button type="button" className="select-button">Todos <ChevronRight size={14} /></button></div>
        <div className="reservation-history__list">
          {[
            ["25 JUL", "Corte clássico", "Diego Alves", "R$ 65,00"],
            ["11 JUL", "Barba premium", "João Victor", "R$ 55,00"],
            ["27 JUN", "Ritual Los Barberos", "Mateus Lima", "R$ 105,00"],
          ].map(([date, service, barber, value]) => <article key={date}><span className="reservation-history__date">{date}</span><span className="reservation-history__icon"><Scissors size={17} /></span><div><strong>{service}</strong><small>{barber} · Vila Madalena</small></div><span className="reservation-history__done"><Check size={13} /> Concluído</span><b>{value}</b><button type="button" className="icon-button icon-button--sm"><MoreHorizontal size={17} /></button></article>)}
        </div>
      </section>

      <section className="customer-booking-cta"><span><Scissors size={22} /></span><div><strong>Hora de renovar o visual?</strong><small>Seus serviços favoritos estão a poucos toques.</small></div><Link href="/cliente/agendar" className="button button--accent">Agendar de novo <ChevronRight size={16} /></Link></section>

      {cancelOpen && (
        <div className="modal-layer">
          <button className="modal-layer__backdrop" type="button" aria-label="Fechar" onClick={() => setCancelOpen(false)} />
          <div className="cancel-modal"><button type="button" className="icon-button cancel-modal__close" onClick={() => setCancelOpen(false)} aria-label="Fechar"><X size={18} /></button><span className="cancel-modal__icon"><AlertTriangle size={24} /></span><h2>Cancelar esta reserva?</h2><p>Você está dentro do prazo de 24 horas. O sinal pago será reembolsado integralmente.</p><div><span><small>Reembolso estimado</small><strong>R$ 32,00</strong></span><span><small>Prazo</small><strong>até 10 dias úteis</strong></span></div><label>Motivo <small>opcional</small><select defaultValue=""><option value="">Selecione um motivo</option><option>Imprevisto pessoal</option><option>Preciso de outro horário</option><option>Outro</option></select></label><footer><button type="button" className="button button--soft" onClick={() => setCancelOpen(false)}>Manter reserva</button><button type="button" className="button button--danger" onClick={cancel}>Sim, cancelar</button></footer></div>
        </div>
      )}
      {toast && <div className="toast-message"><Check size={17} /><span>{toast}</span></div>}
    </>
  );
}


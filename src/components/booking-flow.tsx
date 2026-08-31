"use client";

import { useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock3,
  CreditCard,
  LockKeyhole,
  MapPin,
  MessageCircle,
  QrCode,
  Scissors,
  ShieldCheck,
  Sparkles,
  Star,
  UserRound,
} from "lucide-react";
import { barbers, formatMoney, packages, services } from "@/data/demo";
import { Avatar } from "@/components/ui";
import { CATALOG_AUDIENCES, audienceLabel, filterByAudience, type CatalogAudience } from "@/lib/catalog-audiences";

const dates = [
  { weekday: "Hoje", day: "04", month: "AGO" },
  { weekday: "Qua", day: "05", month: "AGO" },
  { weekday: "Qui", day: "06", month: "AGO" },
  { weekday: "Sex", day: "07", month: "AGO" },
  { weekday: "Sáb", day: "08", month: "AGO" },
  { weekday: "Seg", day: "10", month: "AGO" },
];

const times = ["09:00", "09:45", "10:30", "11:15", "13:30", "14:15", "15:00", "16:30", "17:15", "18:00"];

type BookingChoice = {
  id: string;
  name: string;
  description: string;
  durationMinutes: number;
  priceCents: number;
  kind: "service" | "package";
  category: "Cabelo" | "Barba" | "Combos" | "Cuidados";
  audiences: readonly CatalogAudience[];
};

export function BookingFlow() {
  const [step, setStep] = useState(1);
  const [category, setCategory] = useState("Todos");
  const [audience, setAudience] = useState<CatalogAudience | null>(null);
  const [choice, setChoice] = useState<BookingChoice | null>(null);
  const [barber, setBarber] = useState("barber-any");
  const [date, setDate] = useState("04");
  const [time, setTime] = useState("");
  const [payment, setPayment] = useState<"pix" | "card">("pix");
  const [paymentAmount, setPaymentAmount] = useState<"deposit" | "full">("deposit");
  const [accepted, setAccepted] = useState(true);
  const [loading, setLoading] = useState(false);

  const choices = useMemo<BookingChoice[]>(() => {
    const serviceChoices = services.map((service) => ({ ...service, kind: "service" as const }));
    const packageChoices = packages.map((item) => ({ ...item, category: "Combos" as const, kind: "package" as const }));
    const allChoices: BookingChoice[] = [...serviceChoices, ...packageChoices];
    const audienceChoices = audience ? filterByAudience(allChoices, audience) : [];
    return audienceChoices.filter((item) => category === "Todos" || item.category === category);
  }, [audience, category]);

  const chosenBarber = barber === "barber-any" ? null : barbers.find((item) => item.id === barber);
  const depositCents = choice ? Math.ceil(choice.priceCents * 0.3 / 100) * 100 : 0;
  const payableCents = paymentAmount === "deposit" ? depositCents : choice?.priceCents ?? 0;

  function continueFlow() {
    if (step === 1 && !choice) return;
    if (step === 2 && !time) return;
    if (step === 3 && !accepted) return;

    if (step === 3) {
      setLoading(true);
      window.setTimeout(() => {
        setLoading(false);
        setStep(4);
        window.scrollTo({ top: 0, behavior: "smooth" });
      }, 750);
      return;
    }

    setStep((current) => current + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (step === 4 && choice) {
    return (
      <section className="booking-success">
        <div className="booking-success__confetti"><i /><i /><i /><i /><i /><i /></div>
        <span className="booking-success__icon"><Check size={34} /></span>
        <span className="booking-success__eyebrow">Tudo certo, Rafael!</span>
        <h1>Horário confirmado.</h1>
        <p>Seu cuidado está reservado. Enviamos os detalhes pelo WhatsApp.</p>
        <article className="booking-ticket">
          <div className="booking-ticket__brand"><span>LB</span><div><strong>Los Barberos</strong><small>Vila Madalena</small></div><i>Confirmado</i></div>
          <div className="booking-ticket__service"><span><Scissors size={20} /></span><div><strong>{choice.name}</strong><small>{choice.durationMinutes} min · {chosenBarber?.name ?? "Primeiro profissional disponível"}</small></div></div>
          <div className="booking-ticket__date"><div><CalendarDays size={18} /><span><small>Data</small><strong>Terça, 4 de agosto</strong></span></div><div><Clock3 size={18} /><span><small>Horário</small><strong>{time}</strong></span></div></div>
          <div className="booking-ticket__location"><MapPin size={17} /><span>Rua Harmonia, 214 · Vila Madalena, SP</span></div>
          <div className="booking-ticket__payment"><span><small>Pago agora via {payment === "pix" ? "Pix" : "cartão"}</small><strong>{formatMoney(payableCents)}</strong></span>{paymentAmount === "deposit" && <span><small>Saldo no atendimento</small><strong>{formatMoney(choice.priceCents - depositCents)}</strong></span>}</div>
          <div className="booking-ticket__code"><span>LB-1054</span><i /><i /><i /><i /><i /><i /><i /></div>
        </article>
        <div className="booking-success__actions"><a href="/cliente/reservas" className="button button--dark button--block">Ver minhas reservas <ArrowRight size={17} /></a><button type="button" className="button button--soft button--block"><CalendarDays size={17} /> Adicionar ao calendário</button></div>
        <p className="booking-success__reminder"><MessageCircle size={16} /> Lembrete programado para terça-feira às 07:00.</p>
      </section>
    );
  }

  return (
    <div className="booking-flow">
      <header className="booking-heading">
        <div><span className="eyebrow">Agendamento online</span><h1>{step === 1 ? "Como quer cuidar do visual?" : step === 2 ? "Quando fica melhor para você?" : "Revise e confirme sua reserva"}</h1><p>{step === 1 ? "Escolha um serviço ou aproveite um dos nossos rituais completos." : step === 2 ? "Selecione profissional, data e um horário disponível." : "Seu horário fica protegido por 3 minutos durante o pagamento."}</p></div>
        <div className="booking-stepper" aria-label={`Etapa ${step} de 3`}>
          {[1, 2, 3].map((item) => <span key={item} className={item === step ? "is-current" : item < step ? "is-done" : ""}>{item < step ? <Check size={14} /> : item}<small>{["Serviço", "Horário", "Confirmar"][item - 1]}</small></span>)}
        </div>
      </header>

      {step === 1 && (
        <div className="booking-content booking-services-step">
          <div className="audience-pills" role="tablist" aria-label="Público do serviço"><span>Escolha o público</span>{CATALOG_AUDIENCES.map((item) => <button type="button" role="tab" aria-selected={audience === item} key={item} className={audience === item ? "is-active" : ""} onClick={() => { setAudience(item); setChoice(null); }}>{audienceLabel(item)}</button>)}</div>
          <div className="category-pills" role="tablist">{["Todos", "Cabelo", "Barba", "Combos", "Cuidados"].map((item) => <button type="button" key={item} className={category === item ? "is-active" : ""} onClick={() => setCategory(item)}>{item}</button>)}</div>
          <div className="booking-service-list">
            {!audience && <p className="booking-note">Escolha um público para ver serviços e pacotes.</p>}
            {choices.map((item) => {
              const selected = choice?.id === item.id;
              return (
                <button type="button" key={item.id} className={`booking-service-card ${selected ? "is-selected" : ""} ${item.kind === "package" ? "is-package" : ""}`} onClick={() => setChoice(item)} aria-pressed={selected}>
                  <span className="booking-service-card__icon">{item.kind === "package" ? <Sparkles size={20} /> : <Scissors size={20} />}</span>
                  <span className="booking-service-card__copy">{item.kind === "package" && <i>Ritual completo</i>}<strong>{item.name}</strong><small>{item.description}</small><em><Clock3 size={14} /> {item.durationMinutes} min</em></span>
                  <span className="booking-service-card__price"><strong>{formatMoney(item.priceCents)}</strong>{item.kind === "package" && <small>valor do pacote</small>}</span>
                  <span className="booking-service-card__check">{selected && <Check size={15} />}</span>
                </button>
              );
            })}
          </div>
          <div className="booking-note"><ShieldCheck size={17} /><span>Preços transparentes. O valor escolhido fica protegido nesta reserva.</span></div>
        </div>
      )}

      {step === 2 && choice && (
        <div className="booking-content booking-schedule-step">
          <section className="booking-section"><div className="booking-section__title"><span>1</span><div><h2>Escolha o profissional</h2><p>Ou deixe a gente encontrar o primeiro disponível.</p></div></div><div className="barber-picker"><button type="button" className={barber === "barber-any" ? "is-selected" : ""} onClick={() => setBarber("barber-any")}><span className="barber-any"><Sparkles size={19} /></span><strong>Qualquer profissional</strong><small>Mais horários disponíveis</small><i>{barber === "barber-any" && <Check size={14} />}</i></button>{barbers.map((item) => <button type="button" key={item.id} className={barber === item.id ? "is-selected" : ""} onClick={() => setBarber(item.id)}><Avatar initials={item.initials} tone={item.color as "sage" | "amber" | "blue"} /><strong>{item.name}</strong><small>{item.specialties.join(" · ")}</small><span><Star size={12} fill="currentColor" /> 4,9</span><i>{barber === item.id && <Check size={14} />}</i></button>)}</div></section>
          <section className="booking-section"><div className="booking-section__title"><span>2</span><div><h2>Escolha a data</h2><p>Agosto de 2026</p></div></div><div className="date-picker">{dates.map((item) => <button type="button" key={item.day} className={date === item.day ? "is-selected" : ""} onClick={() => { setDate(item.day); setTime(""); }}><small>{item.weekday}</small><strong>{item.day}</strong><span>{item.month}</span></button>)}<button type="button" className="date-picker__more"><CalendarDays size={19} /><small>Outra</small></button></div></section>
          <section className="booking-section"><div className="booking-section__title"><span>3</span><div><h2>Escolha o horário</h2><p>{barber === "barber-any" ? "Com qualquer profissional" : `Com ${chosenBarber?.name}`}</p></div></div><div className="time-groups"><div><span>Manhã</span><div>{times.slice(0, 4).map((item) => <button type="button" key={item} className={time === item ? "is-selected" : ""} onClick={() => setTime(item)}>{item}</button>)}</div></div><div><span>Tarde e noite</span><div>{times.slice(4).map((item) => <button type="button" key={item} className={time === item ? "is-selected" : ""} onClick={() => setTime(item)}>{item}</button>)}</div></div></div>{time && <div className="selected-slot"><CheckCircle2 size={18} /><span><strong>Horário selecionado</strong><small>Terça, 4 de agosto às {time}</small></span></div>}</section>
        </div>
      )}

      {step === 3 && choice && (
        <div className="booking-review-grid">
          <div className="booking-review-main">
            <section className="booking-review-card"><div className="booking-review-card__head"><h2>Seus dados</h2><button type="button">Editar</button></div><div className="booking-customer"><span>RM</span><div><strong>Rafael Martins</strong><small>+55 11 98814-5021 · rafael@email.com</small></div><CheckCircle2 size={18} /></div></section>
            <section className="booking-review-card"><div className="booking-review-card__head"><h2>Como prefere pagar?</h2><span><LockKeyhole size={14} /> seguro</span></div><div className="payment-methods"><button type="button" className={payment === "pix" ? "is-selected" : ""} onClick={() => setPayment("pix")}><span className="payment-methods__pix"><QrCode size={20} /></span><div><strong>Pix</strong><small>Aprovação imediata</small></div><i>{payment === "pix" && <Check size={14} />}</i></button><button type="button" className={payment === "card" ? "is-selected" : ""} onClick={() => setPayment("card")}><span><CreditCard size={20} /></span><div><strong>Cartão</strong><small>Crédito · Mercado Pago</small></div><i>{payment === "card" && <Check size={14} />}</i></button></div><div className="payment-amount"><button type="button" className={paymentAmount === "deposit" ? "is-selected" : ""} onClick={() => setPaymentAmount("deposit")}><i>{paymentAmount === "deposit" && <Check size={13} />}</i><span><strong>Pagar sinal de 30%</strong><small>Saldo de {formatMoney(choice.priceCents - depositCents)} no atendimento</small></span><b>{formatMoney(depositCents)}</b></button><button type="button" className={paymentAmount === "full" ? "is-selected" : ""} onClick={() => setPaymentAmount("full")}><i>{paymentAmount === "full" && <Check size={13} />}</i><span><strong>Pagar valor completo</strong><small>Chegue e aproveite o atendimento</small></span><b>{formatMoney(choice.priceCents)}</b></button></div></section>
            <label className="booking-policy"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} /><span>Li e aceito a política de cancelamento. Até 24h antes, o valor pago é reembolsado integralmente. <button type="button">Ver detalhes</button></span></label>
          </div>
          <aside className="booking-summary"><span className="booking-summary__eyebrow">Resumo da reserva</span><div className="booking-summary__service"><span><Scissors size={20} /></span><div><strong>{choice.name}</strong><small>{choice.durationMinutes} min</small></div></div><div className="booking-summary__details"><span><CalendarDays size={16} /><small>Terça, 4 de agosto · {time}</small></span><span><UserRound size={16} /><small>{chosenBarber?.name ?? "Primeiro disponível"}</small></span><span><MapPin size={16} /><small>Vila Madalena</small></span></div><div className="booking-summary__totals"><span><small>Serviço</small><strong>{formatMoney(choice.priceCents)}</strong></span>{paymentAmount === "deposit" && <span><small>Saldo no atendimento</small><strong>{formatMoney(choice.priceCents - depositCents)}</strong></span>}<span className="booking-summary__pay"><small>Pagar agora</small><strong>{formatMoney(payableCents)}</strong></span></div><div className="booking-summary__hold"><Clock3 size={16} /><span>Este horário ficará protegido por <strong>3 minutos</strong>.</span></div></aside>
        </div>
      )}

      <footer className="booking-footer">
        <div>
          {step > 1 && <button type="button" className="button button--ghost" onClick={() => setStep((current) => current - 1)}><ArrowLeft size={17} /> Voltar</button>}
          <span className="booking-footer__summary">{choice && <><small>{choice.name}</small><strong>{formatMoney(choice.priceCents)}</strong></>}</span>
          <button type="button" className="button button--dark" onClick={continueFlow} disabled={(step === 1 && !choice) || (step === 2 && !time) || (step === 3 && !accepted) || loading}>
            {loading ? "Processando..." : step === 3 ? `Pagar ${formatMoney(payableCents)}` : "Continuar"}<ArrowRight size={17} />
          </button>
        </div>
      </footer>
    </div>
  );
}

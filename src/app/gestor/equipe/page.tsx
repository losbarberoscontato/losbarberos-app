import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarClock, ChevronRight, CircleDollarSign, Clock3, MoreHorizontal, Plus, Scissors, ShieldCheck } from "lucide-react";
import { barbers } from "@/data/demo";
import { Avatar, PageHeader, SectionHeading } from "@/components/ui";
import { hasSupabaseConfig } from "@/lib/env";
import { TeamManager } from "@/components/connected-manager/team-manager";
import { loadTeamData } from "@/components/connected-manager/server";

export const metadata: Metadata = { title: "Equipe" };

const schedule = [
  { day: "Seg", hours: "09:00 — 18:00" },
  { day: "Ter", hours: "09:00 — 19:00" },
  { day: "Qua", hours: "09:00 — 19:00" },
  { day: "Qui", hours: "09:00 — 20:00" },
  { day: "Sex", hours: "09:00 — 20:00" },
  { day: "Sáb", hours: "08:00 — 18:00" },
  { day: "Dom", hours: "Fechado" },
];

export default async function TeamPage() {
  if (hasSupabaseConfig) {
    const data = await loadTeamData();
    if (data.billingStatus === "CANCELED_RETENTION" || data.billingStatus === "CLOSED") redirect("/regularizacao");
    return <TeamManager {...data} />;
  }
  return (
    <div className="team-page">
      <PageHeader
        title="Equipe"
        description="Profissionais, competências, disponibilidade e regras de comissão."
        actions={<button type="button" className="button button--dark"><Plus size={17} /> Novo profissional</button>}
      />
      <section className="team-overview">
        <div><span className="team-overview__icon"><Scissors size={20} /></span><span><small>Equipe ativa</small><strong>3 profissionais</strong></span></div>
        <div><span className="team-overview__icon"><CalendarClock size={20} /></span><span><small>Capacidade semanal</small><strong>124 horas</strong></span></div>
        <div><span className="team-overview__icon"><CircleDollarSign size={20} /></span><span><small>Comissões em aberto</small><strong>R$ 1.284,50</strong></span></div>
      </section>

      <div className="team-layout">
        <section className="panel team-cards-panel">
          <SectionHeading title="Profissionais" description="Todos ativos hoje" />
          <div className="team-cards">
            {barbers.map((barber, index) => (
              <article className="team-card" key={barber.id}>
                <div className="team-card__head"><Avatar initials={barber.initials} tone={barber.color as "sage" | "amber" | "blue"} size="lg" /><span><strong>{barber.name}</strong><small>{barber.role}</small></span><button type="button" className="icon-button icon-button--sm" aria-label={`Ações de ${barber.name}`}><MoreHorizontal size={17} /></button></div>
                <div className="team-card__tags">{barber.specialties.map((item) => <span key={item}>{item}</span>)}</div>
                <div className="team-card__stats"><span><small>Hoje</small><strong>{barber.appointmentsToday} reservas</strong></span><span><small>Ocupação</small><strong>{[82, 74, 69][index]}%</strong></span><span><small>Comissão</small><strong>{["40%", "35%", "R$ 22/proc."][index]}</strong></span></div>
                <div className="team-card__progress"><span style={{ width: `${[82, 74, 69][index]}%` }} /></div>
                <button type="button" className="team-card__footer">Ver agenda e configurações <ChevronRight size={16} /></button>
              </article>
            ))}
          </div>
        </section>

        <aside className="team-aside">
          <section className="panel opening-hours">
            <SectionHeading title="Horário da unidade" action={<button type="button" className="text-button">Editar</button>} />
            <div>{schedule.map((item) => <span key={item.day}><strong>{item.day}</strong><small className={item.hours === "Fechado" ? "is-closed" : ""}>{item.hours}</small></span>)}</div>
            <p><Clock3 size={15} /> Cada profissional pode ter uma escala própria e exceções.</p>
          </section>
          <section className="panel team-security">
            <span><ShieldCheck size={20} /></span>
            <h3>Acesso da equipe</h3>
            <p>No MVP, apenas o gestor acessa o painel. Cada barbeiro recebe sua agenda pelo WhatsApp.</p>
            <Link href="/gestor/configuracoes">Configurar WhatsApp <ChevronRight size={15} /></Link>
          </section>
        </aside>
      </div>
    </div>
  );
}

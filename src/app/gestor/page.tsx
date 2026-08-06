import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  CalendarCheck2,
  CalendarPlus2,
  CheckCircle2,
  ChevronRight,
  Clock3,
  MessageCircle,
  MoreHorizontal,
  Sparkles,
  Users,
  WalletCards,
} from "lucide-react";
import { appointments, barbers, formatMoney, weeklyBars } from "@/data/demo";
import { Avatar, PageHeader, ProgressRing, SectionHeading, StatCard, StatusChip } from "@/components/ui";
import { hasSupabaseConfig } from "@/lib/env";
import { ManagerDashboard } from "@/components/connected-manager/manager-dashboard";
import { loadDashboardData } from "@/components/connected-manager/server";

export default async function ManagerDashboardPage() {
  if (hasSupabaseConfig) {
    const data = await loadDashboardData();
    if (data.billingStatus === "CANCELED_RETENTION" || data.billingStatus === "CLOSED") redirect("/regularizacao");
    return <ManagerDashboard {...data} />;
  }
  const todayKey = new Intl.DateTimeFormat("en-CA").format(new Date());
  const todayAppointments = appointments.filter((appointment) => appointment.date === todayKey && !["CANCELED", "NO_SHOW"].includes(appointment.status));
  return (
    <div className="dashboard-page">
      <PageHeader
        eyebrow="Terça-feira, 4 de agosto"
        title="Boa tarde, Guilherme."
        description="A casa está rodando bem. Veja o que merece sua atenção agora."
        actions={
          <Link href="/gestor/agenda?novo=1" className="button button--dark">
            <CalendarPlus2 size={17} /> Novo agendamento
          </Link>
        }
      />

      <section className="stats-grid" aria-label="Resumo do dia">
        <StatCard label="Faturamento hoje" value="R$ 1.845" hint="18% acima da terça passada" trend="up" icon={<WalletCards size={19} />} accent="sage" />
        <StatCard label="Agendamentos" value={String(todayAppointments.length)} hint={`${todayAppointments.filter((item) => item.status === "CONFIRMED").length} confirmados · ${todayAppointments.filter((item) => item.status === "PENDING_PAYMENT").length} pendente`} icon={<CalendarCheck2 size={19} />} accent="amber" />
        <StatCard label="Ocupação" value="78%" hint="6 horários ainda livres" trend="up" icon={<Clock3 size={19} />} accent="blue" />
        <StatCard label="Novos clientes" value="7" hint="23 neste mês" trend="up" icon={<Users size={19} />} accent="rose" />
      </section>

      <div className="dashboard-layout">
        <section className="panel dashboard-agenda">
          <SectionHeading
            title="Agenda de hoje"
            description="Próximos atendimentos da equipe"
            action={<Link href="/gestor/agenda" className="text-button">Ver agenda completa <ChevronRight size={16} /></Link>}
          />
          <div className="dashboard-agenda__timeline">
            {todayAppointments.slice(0, 5).map((appointment, index) => (
              <article className={`dashboard-appointment ${appointment.status === "IN_SERVICE" ? "is-current" : ""}`} key={appointment.id}>
                <div className="dashboard-appointment__time"><strong>{appointment.time}</strong><span>{appointment.endTime}</span></div>
                <div className="timeline-rail"><span />{index < 4 && <i />}</div>
                <Avatar initials={appointment.initials} tone={index % 3 === 0 ? "sage" : index % 3 === 1 ? "amber" : "blue"} />
                <div className="dashboard-appointment__customer"><strong>{appointment.customer}</strong><span>{appointment.service}</span></div>
                <div className="dashboard-appointment__barber"><Avatar initials={appointment.barberInitials} size="sm" tone="ink" /><span>{appointment.barber.split(" ")[0]}</span></div>
                <StatusChip status={appointment.status} />
                <strong className="dashboard-appointment__value">{formatMoney(appointment.valueCents)}</strong>
                <button type="button" className="icon-button icon-button--sm" aria-label={`Ações de ${appointment.customer}`}><MoreHorizontal size={17} /></button>
              </article>
            ))}
          </div>
          <Link className="dashboard-agenda__more" href="/gestor/agenda">Ver agenda completa <ArrowRight size={15} /></Link>
        </section>

        <aside className="dashboard-side">
          <section className="panel occupancy-panel">
            <SectionHeading title="Ritmo do dia" description="Capacidade da equipe" />
            <div className="occupancy-panel__body">
              <ProgressRing value={78} label="ocupado" />
              <div className="occupancy-panel__legend">
                <span><i className="sage" />Atendimentos <strong>9h 45</strong></span>
                <span><i className="amber" />Livre <strong>2h 45</strong></span>
              </div>
            </div>
            <div className="occupancy-panel__alert"><Sparkles size={16} /><span><strong>Boa ocupação.</strong> Divulgue os 6 horários livres da tarde.</span></div>
          </section>

          <section className="panel quick-actions">
            <SectionHeading title="Ações rápidas" />
            <div>
              <Link href="/gestor/agenda?novo=1"><span className="quick-actions__icon quick-actions__icon--sage"><CalendarPlus2 size={18} /></span><span><strong>Novo agendamento</strong><small>Reserve pelo balcão</small></span><ChevronRight size={16} /></Link>
              <Link href="/gestor/clientes?novo=1"><span className="quick-actions__icon quick-actions__icon--amber"><Users size={18} /></span><span><strong>Cadastrar cliente</strong><small>Adicione à sua base</small></span><ChevronRight size={16} /></Link>
              <Link href="/gestor/financeiro"><span className="quick-actions__icon quick-actions__icon--blue"><CheckCircle2 size={18} /></span><span><strong>Fechar comissões</strong><small>3 lotes aguardando</small></span><ChevronRight size={16} /></Link>
            </div>
          </section>
        </aside>
      </div>

      <div className="dashboard-lower-grid">
        <section className="panel weekly-panel">
          <SectionHeading title="Faturamento da semana" description="R$ 6.980 capturados · 64 atendimentos" action={<button type="button" className="select-button">Esta semana <ChevronRight size={14} /></button>} />
          <div className="weekly-chart" role="img" aria-label="Gráfico de faturamento semanal">
            {weeklyBars.map((bar) => (
              <div className="weekly-chart__column" key={bar.day}>
                <span className="weekly-chart__tooltip">{bar.total}</span>
                <div><i style={{ height: `${bar.value}%` }} /></div>
                <small>{bar.day}</small>
              </div>
            ))}
          </div>
          <div className="weekly-panel__footer"><span><i />Capturado</span><strong>Meta semanal: <b>R$ 8.500</b></strong></div>
        </section>

        <section className="panel team-today">
          <SectionHeading title="Equipe hoje" description="3 profissionais em operação" action={<Link href="/gestor/equipe" className="text-button">Ver equipe</Link>} />
          <div className="team-today__list">
            {barbers.map((barber) => (
              <div key={barber.id}>
                <Avatar initials={barber.initials} tone={barber.color as "sage" | "amber" | "blue"} />
                <span><strong>{barber.name}</strong><small>{barber.appointmentsToday} atendimentos hoje</small></span>
                <div className="team-today__next"><small>Próximo livre</small><strong>{barber.nextSlot}</strong></div>
              </div>
            ))}
          </div>
          <div className="team-today__message"><MessageCircle size={16} /><span>Todos receberam a agenda de hoje pelo WhatsApp.</span></div>
        </section>
      </div>
    </div>
  );
}

import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { formatCents, formatRange, parsePostgresRange } from "./format";
import { EmptyState, Panel, StatusChip } from "./shared";
import styles from "./connected-manager.module.css";
import type { AwaitedReturn } from "./utility-types";
import type { loadDashboardData } from "./server";

type Props = AwaitedReturn<typeof loadDashboardData>;

export function ManagerDashboard(props: Props) {
  const now = new Date();
  const todayKey = new Intl.DateTimeFormat("en-CA", { timeZone: props.organization.timezone }).format(now);
  const dateKey = (range: string) => {
    const parsed = parsePostgresRange(range);
    return parsed ? new Intl.DateTimeFormat("en-CA", { timeZone: props.organization.timezone }).format(parsed.start) : "";
  };
  const today = props.appointments.filter((appointment) => dateKey(appointment.service_period) === todayKey);
  const future = props.appointments.filter((appointment) => {
    const period = parsePostgresRange(appointment.service_period);
    return period && period.start > now && ["HELD", "PENDING_PAYMENT", "CONFIRMED"].includes(appointment.status);
  });
  const financialById = new Map(props.financial.map((item) => [item.appointment_id, item]));
  const capturedToday = today.reduce((sum, appointment) => sum + (financialById.get(appointment.id)?.net_paid_cents ?? 0), 0);
  const activeToday = today.filter((appointment) => !["CANCELED", "NO_SHOW", "EXPIRED"].includes(appointment.status));
  const customerById = new Map(props.customers.map((item) => [item.id, item]));
  const barberById = new Map(props.barbers.map((item) => [item.id, item]));
  const recentCustomerCount = props.customers.filter((customer) => new Date(customer.created_at).getTime() >= now.getTime() - 30 * 864e5).length;

  return <div className={styles.stack}>
    <PageHeader
      title={`Visão geral · ${props.organization.name}`}
      description="Indicadores calculados somente com dados reais da sua organização."
      actions={<Link className={styles.button} href="/gestor/agenda?novo=1">Novo agendamento</Link>}
    />
    {props.billingStatus === "BLOCKED" && <p className={`${styles.message} ${styles.warning}`}>Assinatura bloqueada: novas reservas e reagendamentos estão pausados. Compromissos existentes continuam operáveis.</p>}
    <section className={styles.stats} aria-label="Resumo real">
      <article className={styles.stat}><span>Capturado hoje</span><strong>{formatCents(capturedToday)}</strong><small>líquido de reembolsos</small></article>
      <article className={styles.stat}><span>Agenda hoje</span><strong>{activeToday.length}</strong><small>{today.filter((item) => item.status === "CONFIRMED").length} confirmados</small></article>
      <article className={styles.stat}><span>Próximas reservas</span><strong>{future.length}</strong><small>holds, pendentes e confirmadas</small></article>
      <article className={styles.stat}><span>Novos clientes</span><strong>{recentCustomerCount}</strong><small>últimos 30 dias</small></article>
    </section>
    <div className={styles.grid}>
      <Panel title="Agenda de hoje" description="Próximos atendimentos" className={styles.span8} action={<Link href="/gestor/agenda" className={`${styles.button} ${styles.buttonSoft} ${styles.buttonSmall}`}>Ver agenda</Link>}>
        {activeToday.length === 0 ? <EmptyState title="Dia livre">Nenhum agendamento real para hoje.</EmptyState> : <div className={styles.timeline}>{activeToday.slice(0, 8).map((appointment) => <article className={styles.appointment} key={appointment.id}>
          <span className={styles.appointmentTime}>{formatRange(appointment.service_period, props.organization.timezone)}</span>
          <span className={styles.rowTitle}><strong>{customerById.get(appointment.customer_id)?.full_name ?? "Cliente removido"}</strong><small>{barberById.get(appointment.barber_id)?.display_name ?? "Profissional"}</small></span>
          <StatusChip active={["CONFIRMED", "IN_SERVICE", "COMPLETED"].includes(appointment.status)} label={appointment.status} />
          <strong className={styles.appointmentValue}>{formatCents(appointment.total_cents_snapshot)}</strong>
        </article>)}</div>}
      </Panel>
      <Panel title="Operação" description="Pendências reais" className={styles.span4}>
        <dl className={styles.definition}>
          <div><dt>Profissionais ativos</dt><dd>{props.barbers.length}</dd></div>
          <div><dt>Lotes de comissão</dt><dd>{props.openPayouts.length}</dd></div>
          <div><dt>Saldo a receber</dt><dd>{formatCents(props.financial.reduce((sum, row) => sum + row.outstanding_cents, 0))}</dd></div>
          <div><dt>Status SaaS</dt><dd>{props.billingStatus ?? "SEM STATUS"}</dd></div>
        </dl>
        <div className={styles.toolbarGroup} style={{ marginTop: "1rem" }}>
          <Link className={`${styles.button} ${styles.buttonSoft} ${styles.buttonSmall}`} href="/gestor/clientes?novo=1">Cadastrar cliente</Link>
          <Link className={`${styles.button} ${styles.buttonSoft} ${styles.buttonSmall}`} href="/gestor/financeiro">Comissões</Link>
        </div>
      </Panel>
    </div>
  </div>;
}


import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { formatCents, formatRange, parsePostgresRange } from "./format";
import { EmptyState, Panel, StatusChip } from "./shared";
import styles from "./connected-manager.module.css";
import type { AwaitedReturn } from "./utility-types";
import type { loadDashboardData } from "./server";
import { appointmentDisplayStatus } from "./appointment-display-status";

type DashboardData = AwaitedReturn<typeof loadDashboardData>;
type Props = Omit<DashboardData, "whatsapp" | "payablesTodayCents" | "commissionsTodayCents" | "cashBalanceCents"> & { whatsapp?: DashboardData["whatsapp"]; payablesTodayCents?: number; commissionsTodayCents?: number; cashBalanceCents?: number };

export function ManagerDashboard(props: Props) {
  const now = new Date();
  const todayKey = new Intl.DateTimeFormat("en-CA", { timeZone: props.organization.timezone }).format(now);
  const dateKey = (range: string) => {
    const parsed = parsePostgresRange(range);
    return parsed ? new Intl.DateTimeFormat("en-CA", { timeZone: props.organization.timezone }).format(parsed.start) : "";
  };
  const today = props.appointments.filter((appointment) => dateKey(appointment.service_period) === todayKey);
  const financialById = new Map(props.financial.map((item) => [item.appointment_id, item]));
  const receivableToday = today.reduce((sum, appointment) => sum + (financialById.get(appointment.id)?.outstanding_cents ?? 0), 0);
  const activeToday = today.filter((appointment) => !["CANCELED", "NO_SHOW", "EXPIRED"].includes(appointment.status));
  const customerById = new Map(props.customers.map((item) => [item.id, item]));
  const barberById = new Map(props.barbers.map((item) => [item.id, item]));
  const recentCustomerCount = props.customers.filter((customer) => new Date(customer.created_at).getTime() >= now.getTime() - 30 * 864e5).length;
  const whatsapp = props.whatsapp?.connections.find((connection) => connection.provider === "QR_WEB") ?? props.whatsapp?.connections[0];
  const whatsappHealthy = whatsapp?.status === "CONNECTED" && (!whatsapp.health_status || whatsapp.health_status === "OK");
  const whatsappDisconnected = whatsapp?.status === "DISCONNECTED" || whatsapp?.health_status === "DISCONNECTED";
  const whatsappWaitingForQr = whatsapp?.status === "WAITING_FOR_QR" || whatsapp?.health_status === "WAITING_FOR_QR";
  const whatsappProviderError = whatsapp?.status === "ERROR" || whatsapp?.health_status === "PROVIDER_ERROR";
  const whatsappConnecting = whatsapp?.health_error_code === "PROVIDER_CONNECTING" || whatsapp?.last_error_code === "PROVIDER_CONNECTING";
  const whatsappLabel = !whatsapp
    ? "Não configurado"
    : whatsappHealthy
      ? "Tudo certo"
      : whatsapp.health_status === "GATEWAY_UNREACHABLE"
        ? "Gateway Evolution indisponível"
        : whatsappDisconnected
          ? "WhatsApp desconectado"
          : whatsappConnecting
            ? "Verificando conexão"
          : whatsappWaitingForQr
            ? "Aguardando QR Code"
            : whatsappProviderError
              ? "Erro retornado pela Evolution"
              : whatsapp.status === "REAUTH_REQUIRED"
                ? "Reautenticação necessária"
                : "Verificação pendente";
  const billingLabel: Record<string, string> = { PROVISIONING: "Provisionando", TRIALING: "Em teste", ACTIVE: "Ativa", GRACE: "Em carência", BLOCKED: "Bloqueada", CANCELED_RETENTION: "Cancelada (retenção)", CLOSED: "Encerrada" };

  return <div className={styles.stack}>
    <PageHeader
      title={`Visão geral · ${props.organization.name}`}
      actions={<Link className={styles.button} href="/gestor/agenda?novo=1">Novo agendamento</Link>}
    />
    {props.billingStatus === "BLOCKED" && <p className={`${styles.message} ${styles.warning}`}>Assinatura bloqueada: novas reservas e reagendamentos estão pausados. Compromissos existentes continuam operáveis.</p>}
    <section className={styles.stats} aria-label="Resumo real">
      <article className={`${styles.stat} ${styles.statSuccess}`}><span>À Receber hoje</span><strong>{formatCents(receivableToday)}</strong></article>
      <article className={`${styles.stat} ${styles.statDanger}`}><span>À Pagar hoje</span><strong>{formatCents(props.payablesTodayCents ?? 0)}</strong></article>
      <article className={`${styles.stat} ${styles.statInfo}`}><span>Agenda hoje</span><strong>{activeToday.length}</strong><small>{today.filter((item) => item.status === "CONFIRMED").length} confirmados</small></article>
      <article className={`${styles.stat} ${styles.statPurple}`}><span>Novos clientes</span><strong>{recentCustomerCount}</strong><small>últimos 30 dias</small></article>
    </section>
    <div className={styles.grid}>
      <Panel title="Agenda de hoje" description="Próximos atendimentos" className={styles.span8} action={<Link href="/gestor/agenda" className={`${styles.button} ${styles.buttonSoft} ${styles.buttonSmall}`}>Ver agenda</Link>}>
        {activeToday.length === 0 ? <EmptyState title="Dia livre">Nenhum agendamento real para hoje.</EmptyState> : <div className={styles.timeline}>{activeToday.slice(0, 8).map((appointment) => {
          const displayStatus = appointmentDisplayStatus(appointment);
          return <article className={styles.appointment} key={appointment.id}>
          <span className={styles.appointmentTime}>{formatRange(appointment.service_period, props.organization.timezone)}</span>
          <span className={styles.rowTitle}><strong>{customerById.get(appointment.customer_id)?.full_name ?? "Cliente removido"}</strong><small>{barberById.get(appointment.barber_id)?.display_name ?? "Profissional"}</small></span>
          <StatusChip active={["CONFIRMED", "IN_SERVICE", "COMPLETED"].includes(appointment.status)} label={displayStatus.label} tone={displayStatus.tone} />
          <strong className={styles.appointmentValue}>{appointment.payment_mode === "SUBSCRIPTION" ? "Sessão assinatura" : formatCents(appointment.total_cents_snapshot)}</strong>
        </article>;
        })}</div>}
      </Panel>
      <Panel title="Operação" className={styles.span4}>
        <dl className={styles.definition}>
          <div><dt>Profissionais ativos</dt><dd>{props.barbers.length}</dd></div>
          <div><dt>Comissões hoje</dt><dd>{formatCents(props.commissionsTodayCents ?? 0)}</dd></div>
          <div><dt>Saldo em caixa</dt><dd>{formatCents(props.cashBalanceCents ?? 0)}</dd></div>
          <div><dt>Assinatura</dt><dd>{billingLabel[props.billingStatus ?? ""] ?? "Sem status"}</dd></div>
          <div><dt>WhatsApp QR</dt><dd>{whatsappLabel}</dd></div>
        </dl>
        {whatsapp?.health_checked_at && <small className={styles.muted}>Última verificação: {new Date(whatsapp.health_checked_at).toLocaleString("pt-BR")}</small>}
        <div className={styles.toolbarGroup} style={{ marginTop: "1rem" }}>
          <Link className={`${styles.button} ${styles.buttonSoft} ${styles.buttonSmall}`} href="/gestor/clientes?novo=1">Cadastrar cliente</Link>
          <Link className={`${styles.button} ${styles.buttonSoft} ${styles.buttonSmall}`} href="/gestor/financeiro">Comissões</Link>
          <Link className={`${styles.button} ${styles.buttonSoft} ${styles.buttonSmall}`} href="/gestor/configuracoes/whatsapp">Ver WhatsApp</Link>
        </div>
      </Panel>
    </div>
  </div>;
}

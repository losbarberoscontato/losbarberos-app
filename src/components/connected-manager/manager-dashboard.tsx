import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { formatCents, formatRange, parsePostgresRange } from "./format";
import { EmptyState, Panel, StatusChip } from "./shared";
import styles from "./connected-manager.module.css";
import type { AwaitedReturn } from "./utility-types";
import type { loadDashboardData } from "./server";

type DashboardData = AwaitedReturn<typeof loadDashboardData>;
type Props = Omit<DashboardData, "whatsapp"> & { whatsapp?: DashboardData["whatsapp"] };

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
  const whatsappInstruction = whatsappHealthy
    ? "Tudo certo: conexão verificada e pronta para novas mensagens com consentimento."
    : whatsapp?.health_status === "GATEWAY_UNREACHABLE"
      ? "Problema: a VPS/Evolution não respondeu. Ação: clique em Ver WhatsApp → Atualizar status; se persistir, acione suporte para verificar o gateway."
      : whatsappDisconnected || whatsapp?.status === "REAUTH_REQUIRED"
        ? "Problema: a sessão do WhatsApp não está conectada. Ação: no WhatsApp Business, abra Aparelhos conectados e remova Los Barberos; depois gere um novo QR e leia-o."
        : whatsappConnecting
          ? "QR lido. A Evolution está finalizando a conexão. Ação: aguarde alguns segundos; o dashboard será atualizado automaticamente quando o estado ficar ativo."
        : whatsappWaitingForQr
          ? "Problema: o QR ainda não foi lido. Ação: abra WhatsApp Business → Aparelhos conectados → Conectar dispositivo e leia o QR exibido."
          : whatsappProviderError
            ? `Problema: a Evolution retornou um erro${whatsapp.health_error_code ?? whatsapp.last_error_code ? ` (${whatsapp.health_error_code ?? whatsapp.last_error_code})` : ""}. Ação: atualize o status; se persistir, remova a sessão no celular e gere novo QR.`
            : !whatsapp
              ? "Problema: nenhum canal QR foi configurado. Ação: abra Ver WhatsApp e gere um QR para conectar o aparelho."
              : "Problema: a conexão ainda não foi confirmada. Ação: clique em Atualizar status; se persistir, remova a sessão no celular e gere novo QR.";

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
          <div><dt>WhatsApp QR</dt><dd>{whatsappLabel}</dd></div>
        </dl>
        <p className={`${styles.message} ${whatsappHealthy ? "" : styles.warning}`} style={{ marginTop: "1rem" }}><strong>{whatsappLabel}</strong><br />{whatsappInstruction}{whatsapp?.health_checked_at && <><br /><small>Última verificação: {new Date(whatsapp.health_checked_at).toLocaleString("pt-BR")}</small></>}</p>
        <div className={styles.toolbarGroup} style={{ marginTop: "1rem" }}>
          <Link className={`${styles.button} ${styles.buttonSoft} ${styles.buttonSmall}`} href="/gestor/clientes?novo=1">Cadastrar cliente</Link>
          <Link className={`${styles.button} ${styles.buttonSoft} ${styles.buttonSmall}`} href="/gestor/financeiro">Comissões</Link>
          <Link className={`${styles.button} ${styles.buttonSoft} ${styles.buttonSmall}`} href="/gestor/configuracoes/whatsapp">Ver WhatsApp</Link>
        </div>
      </Panel>
    </div>
  </div>;
}

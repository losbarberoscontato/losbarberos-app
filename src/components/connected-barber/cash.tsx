"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CircleDollarSign, Plus } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { ActionMessage, EmptyState, Panel } from "@/components/connected-manager/shared";
import managerStyles from "@/components/connected-manager/connected-manager.module.css";
import type { BarberAccountBalance, BarberAppContext, BarberAppointment, BarberCashReceipt, BarberCashSession, BarberCustomer, BarberFinancialAccount } from "./types";
import styles from "./barber.module.css";

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const paymentMethods = ["CASH", "PIX", "CARD", "BOLETO", "TRANSFER", "OTHER"];
type FinanceView = "overview" | "cash";

function cents(value: FormDataEntryValue | null) {
  return Math.round(Number(String(value ?? "").replace(/[R$\s.]/g, "").replace(",", ".")) * 100);
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("pt-BR").format(new Date(value.includes("T") ? value : `${value}T12:00:00`));
}

export function BarberFinanceSubnav({ active, slug }: { active: FinanceView; slug: string }) {
  const query = `?barbearia=${encodeURIComponent(slug)}`;
  return <nav className={managerStyles.tabs} aria-label="Seções do Financeiro">
    <Link href={`/barbeiro/financeiro${query}`} className={`${managerStyles.tab} ${active === "overview" ? managerStyles.tabActive : ""}`} aria-current={active === "overview" ? "page" : undefined}>Visão geral</Link>
    <Link href={`/barbeiro/caixa${query}`} className={`${managerStyles.tab} ${active === "cash" ? managerStyles.tabActive : ""}`} aria-current={active === "cash" ? "page" : undefined}>Caixa</Link>
  </nav>;
}

type BarberCashProps = {
  context: BarberAppContext;
  sessions: BarberCashSession[];
  receipts: BarberCashReceipt[];
  accounts: BarberFinancialAccount[];
  accountBalances: BarberAccountBalance[];
  appointments: BarberAppointment[];
  customers: BarberCustomer[];
  outstandingByAppointment: Map<string, number>;
  activeView?: FinanceView;
};

export function BarberCash({ context, sessions, receipts, accounts, accountBalances, appointments, customers, outstandingByAppointment, activeView = "cash" }: BarberCashProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const customerById = useMemo(() => new Map(customers.map((item) => [item.id, item.full_name])), [customers]);
  const receivable = appointments.filter((item) => (outstandingByAppointment.get(item.id) ?? 0) > 0);
  const activeReceipts = receipts.filter((receipt) => receipt.status !== "REVERSED");
  const totalReceived = activeReceipts.reduce((sum, receipt) => sum + receipt.amount_cents, 0);
  const current = sessions.find((item) => item.status === "OPEN");
  const totalByAccount = accountBalances.reduce((sum, account) => sum + account.balance_cents, 0);

  async function adjust(receipt: BarberCashReceipt) {
    const amount = window.prompt("Novo valor recebido (R$):", (receipt.amount_cents / 100).toFixed(2).replace(".", ","));
    if (!amount) return;
    const reason = window.prompt("Motivo da correção:");
    if (!reason?.trim()) return;
    const value = cents(amount);
    if (!value) { setMessage("Informe um valor válido."); return; }
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase!.rpc("adjust_barber_cash_receipt", { p_receipt_id: receipt.id, p_new_amount_cents: value, p_reason: reason.trim(), p_idempotency_key: `barber:receipt-adjust:${crypto.randomUUID()}` });
    if (error) { setMessage(error.message); return; }
    setMessage("Correção registrada no histórico do Caixa.");
    router.refresh();
  }

  async function receive(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const amount = cents(data.get("amount"));
    if (!amount) { setMessage("Informe um valor válido."); return; }
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase!.rpc("record_barber_appointment_receipt", { p_appointment_id: String(data.get("appointment_id")), p_amount_cents: amount, p_payment_method: String(data.get("payment_method")), p_financial_account_id: String(data.get("financial_account_id")), p_reference: String(data.get("reference") ?? "").trim() || null, p_idempotency_key: `barber:receipt:${crypto.randomUUID()}` });
    if (error) { setMessage(error.message); return; }
    setMessage("Recebimento registrado no seu Caixa e aguardando conciliação.");
    setOpen(false);
    router.refresh();
  }

  return <div className={managerStyles.stack}>
    <PageHeader eyebrow={context.organization_name} title={activeView === "overview" ? "Financeiro" : "Controle de caixa"} description="Entradas efetivamente recebidas pelo seu caixa. O fechamento diário é realizado pelo gestor." actions={<button className={managerStyles.button} type="button" onClick={() => setOpen(true)}><Plus size={16} /> Receber atendimento</button>} />
    <BarberFinanceSubnav active={activeView} slug={context.organization_slug} />
    <ActionMessage message={message} />
    <section className={managerStyles.stats}>
      <article className={`${managerStyles.stat} ${managerStyles.statSuccess}`}><span>Total recebido</span><strong>{money.format(totalReceived / 100)}</strong><small>Recebimentos do seu caixa</small></article>
      <article className={`${managerStyles.stat} ${managerStyles.statSuccessDark}`}><span>Saldo das contas</span><strong>{money.format(totalByAccount / 100)}</strong><small>Somente valores recebidos por você</small></article>
      <article className={`${managerStyles.stat} ${managerStyles.statInfo}`}><span>Caixa de hoje</span><strong>{money.format((current?.expected_cents ?? 0) / 100)}</strong><small>{current ? "Aberto para recebimentos" : "Abre no primeiro atendimento"}</small></article>
      <article className={`${managerStyles.stat} ${managerStyles.statPurple}`}><span>Recebimentos</span><strong>{receipts.length}</strong><small>Registros no seu caixa</small></article>
    </section>
    <Panel title="Saldo das contas" description="Saldo recebido por você em cada conta financeira.">
      {accountBalances.length === 0 ? <EmptyState title="Nenhuma conta disponível">O gestor ainda não liberou contas financeiras para este caixa.</EmptyState> : <div className={managerStyles.accountBalances}>{accountBalances.map((account) => <article className={managerStyles.accountBalance} key={account.id}><span>{account.name}</span><strong>{money.format(account.balance_cents / 100)}</strong><small>{account.kind === "CASH" ? "Caixa físico" : "Conta bancária"}</small></article>)}</div>}
    </Panel>
    <Panel title="Movimentações" description="Recebimentos atribuídos ao seu caixa. A conciliação é feita pelo gestor.">
      {receipts.length === 0 ? <EmptyState title="Sem movimentações">Registre um recebimento para acompanhar o Caixa.</EmptyState> : <div className={`${managerStyles.cashTable} ${managerStyles.cashTableOnly}`} role="table" aria-label="Movimentações do caixa do barbeiro">
        <div className={managerStyles.cashHeader} role="row"><span>Cliente</span><span>Data</span><span>Valor</span><span>Conta financeira</span><span className={managerStyles.cashHeaderAction}>Ações</span></div>
        {receipts.map((receipt) => <div className={managerStyles.cashRow} role="row" key={receipt.id}><span className={managerStyles.rowTitle}><strong>{receipt.customer_name}</strong><small>{receipt.payment_method} · {receipt.status === "RECONCILED" ? "Conciliado" : receipt.status === "REVERSED" ? "Corrigido" : "Aguardando conciliação"}</small></span><span>{dateLabel(receipt.created_at)}</span><strong>{money.format(receipt.amount_cents / 100)}</strong><span>{receipt.financial_account_name}</span><span className={managerStyles.rowActions}>{receipt.status === "PENDING_RECONCILIATION" && <button className={`${managerStyles.button} ${managerStyles.buttonSoft} ${managerStyles.buttonSmall}`} type="button" onClick={() => void adjust(receipt)}>Corrigir</button>}</span></div>)}
      </div>}
    </Panel>
    {open && <div className={styles.modal}><form className={`${styles.dialog} ${styles.form}`} onSubmit={receive}><h2><CircleDollarSign size={19} /> Receber atendimento</h2><p className={styles.muted}>O recebimento será atribuído ao seu Caixa e ficará aguardando conciliação do gestor.</p><label>Atendimento<select name="appointment_id" required><option value="">Selecione</option>{receivable.map((item) => <option key={item.id} value={item.id}>{customerById.get(item.customer_id) ?? "Cliente"} · saldo {money.format((outstandingByAppointment.get(item.id) ?? 0) / 100)}</option>)}</select></label><label>Valor recebido (R$)<input name="amount" inputMode="decimal" placeholder="0,00" required /></label><label>Forma de recebimento<select name="payment_method">{paymentMethods.map((item) => <option key={item} value={item}>{item === "CASH" ? "Dinheiro" : item === "CARD" ? "Cartão" : item}</option>)}</select></label><label>Conta de destino<select name="financial_account_id" required><option value="">Selecione</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.kind === "CASH" ? "Caixa" : "Banco"}</option>)}</select></label><label>Observação<input name="reference" maxLength={240} /></label><div className={styles.formActions}><button type="button" className={`${styles.button} ${styles.secondary}`} onClick={() => setOpen(false)}>Cancelar</button><button className={styles.button}>Confirmar recebimento</button></div></form></div>}
    <div className={managerStyles.notice}>O fechamento diário e a confirmação dos valores são realizados exclusivamente no painel do gestor.</div>
  </div>;
}

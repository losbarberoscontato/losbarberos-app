"use client";

import { useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Check, ChevronDown, CircleDollarSign, Clock3, CreditCard, Download, MoreHorizontal, ReceiptText, WalletCards } from "lucide-react";
import { barbers, financeTransactions, formatMoney } from "@/data/demo";
import { Avatar, SectionHeading } from "@/components/ui";

export function FinanceView() {
  const [tab, setTab] = useState<"overview" | "commissions" | "transactions">("overview");
  const [toast, setToast] = useState("");

  function demoAction(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 3000);
  }

  return (
    <>
      <div className="finance-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "overview"} onClick={() => setTab("overview")}>Visão geral</button>
        <button type="button" role="tab" aria-selected={tab === "transactions"} onClick={() => setTab("transactions")}>Transações</button>
        <button type="button" role="tab" aria-selected={tab === "commissions"} onClick={() => setTab("commissions")}>Comissões <span>3</span></button>
      </div>

      {tab === "overview" && (
        <>
          <section className="finance-summary-grid">
            <article className="finance-summary-card finance-summary-card--main"><div><span>Receita capturada</span><strong>R$ 28.460,00</strong><small><i><ArrowUpRight size={13} /> 12,8%</i> vs. mês passado</small></div><span className="finance-summary-card__icon"><WalletCards size={21} /></span><div className="finance-sparkline"><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></div></article>
            <article className="finance-summary-card"><span>Saldo a receber</span><strong>R$ 3.284,00</strong><small>28 agendamentos futuros</small><span className="finance-summary-card__icon tone-amber"><Clock3 size={20} /></span></article>
            <article className="finance-summary-card"><span>Comissões abertas</span><strong>R$ 4.920,50</strong><small>Fechamento em 3 dias</small><span className="finance-summary-card__icon tone-blue"><CircleDollarSign size={20} /></span></article>
            <article className="finance-summary-card"><span>Reembolsos</span><strong>R$ 230,00</strong><small>2 processados no período</small><span className="finance-summary-card__icon tone-rose"><ArrowDownLeft size={20} /></span></article>
          </section>

          <div className="finance-layout">
            <section className="panel revenue-panel">
              <SectionHeading title="Receita no período" description="Valores capturados, sem projeções" action={<button type="button" className="select-button">1 — 31 ago <ChevronDown size={14} /></button>} />
              <div className="revenue-legend"><span><i />Receita capturada</span><strong>Total <b>R$ 28.460</b></strong></div>
              <div className="revenue-chart" role="img" aria-label="Gráfico de receita capturada no mês">
                <div className="revenue-chart__axis"><span>8k</span><span>6k</span><span>4k</span><span>2k</span><span>0</span></div>
                <div className="revenue-chart__plot"><span /><span /><span /><span /><span /><svg viewBox="0 0 600 180" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2f6b5d" stopOpacity=".26"/><stop offset="1" stopColor="#2f6b5d" stopOpacity="0"/></linearGradient></defs><path d="M0 157 C55 146,65 115,112 122 S175 93,225 106 S304 57,352 73 S427 49,475 61 S548 20,600 28 L600 180 L0 180Z" fill="url(#areaGradient)"/><path d="M0 157 C55 146,65 115,112 122 S175 93,225 106 S304 57,352 73 S427 49,475 61 S548 20,600 28" fill="none" stroke="#2f6b5d" strokeWidth="3" vectorEffect="non-scaling-stroke"/></svg><div className="revenue-chart__dates"><span>1 ago</span><span>8 ago</span><span>15 ago</span><span>22 ago</span><span>31 ago</span></div></div>
              </div>
              <div className="revenue-breakdown"><span><i className="pix">PIX</i><div><strong>Pix</strong><small>58% do total</small></div><b>R$ 16.506,80</b></span><span><i className="card"><CreditCard size={15} /></i><div><strong>Cartão</strong><small>35% do total</small></div><b>R$ 9.961,00</b></span><span><i className="cash">R$</i><div><strong>Dinheiro</strong><small>7% do total</small></div><b>R$ 1.992,20</b></span></div>
            </section>

            <section className="panel payment-health">
              <SectionHeading title="Saúde dos recebimentos" />
              <div className="payment-donut"><div><strong>91%</strong><span>quitado</span></div></div>
              <div className="payment-health__legend"><span><i className="paid" /><small>Pago</small><strong>R$ 28.460</strong></span><span><i className="pending" /><small>Pendente</small><strong>R$ 3.284</strong></span><span><i className="refund" /><small>Reembolso</small><strong>R$ 230</strong></span></div>
              <div className="payment-health__notice"><Check size={16} /><span><strong>Tudo conciliado.</strong> Nenhum pagamento precisa de ação.</span></div>
            </section>
          </div>

          <section className="panel recent-transactions">
            <SectionHeading title="Transações recentes" description="Últimos recebimentos processados" action={<button type="button" className="text-button" onClick={() => setTab("transactions")}>Ver todas</button>} />
            <TransactionTable />
          </section>
        </>
      )}

      {tab === "transactions" && (
        <section className="panel transactions-full">
          <div className="customers-toolbar"><label className="select-shell"><ReceiptText size={16} /><select><option>Todos os tipos</option><option>Pagamentos</option><option>Reembolsos</option><option>Ajustes</option></select><ChevronDown size={14} /></label><label className="select-shell"><select><option>Agosto de 2026</option><option>Julho de 2026</option></select><ChevronDown size={14} /></label><button type="button" className="button button--soft"><Download size={16} /> Exportar CSV</button></div>
          <TransactionTable />
          <div className="ledger-note"><ReceiptText size={17} /><span><strong>Histórico imutável.</strong> Correções aparecem como eventos compensatórios, nunca sobrescrevem o passado.</span></div>
        </section>
      )}

      {tab === "commissions" && (
        <section className="commissions-view">
          <div className="commission-hero"><div><span>Comissões a pagar</span><strong>R$ 4.920,50</strong><small>42 procedimentos concluídos · 1 — 7 de agosto</small></div><button type="button" className="button button--accent" onClick={() => demoAction("Lote semanal marcado como pago na demonstração.")}><Check size={17} /> Marcar lote como pago</button></div>
          <div className="commission-grid">
            {barbers.map((barber, index) => (
              <article className="panel commission-card" key={barber.id}><div className="commission-card__head"><Avatar initials={barber.initials} tone={barber.color as "sage" | "amber" | "blue"} /><span><strong>{barber.name}</strong><small>{["40% por procedimento", "35% por procedimento", "R$ 22 por procedimento"][index]}</small></span><button type="button" className="icon-button icon-button--sm"><MoreHorizontal size={17} /></button></div><div className="commission-card__amount"><span><small>Comissão no período</small><strong>{["R$ 1.842,00", "R$ 1.627,50", "R$ 1.451,00"][index]}</strong></span><i>{[16, 14, 12][index]} procedimentos</i></div><div className="commission-card__bar"><span style={{ width: `${[82, 73, 65][index]}%` }} /></div><footer><span>Fecha semanalmente</span><button type="button">Ver extrato</button></footer></article>
            ))}
          </div>
          <section className="panel commission-history"><SectionHeading title="Fechamentos anteriores" description="Lotes pagos e auditáveis" /><div className="commission-history__row"><span><Check size={16} /></span><div><strong>Semana 27 — 31 de julho</strong><small>42 procedimentos · 3 profissionais</small></div><b>R$ 4.711,20</b><i>Pago em 1 ago</i><button type="button" className="icon-button icon-button--sm"><MoreHorizontal size={17} /></button></div></section>
        </section>
      )}
      {toast && <div className="toast-message"><Check size={17} /><span>{toast}</span></div>}
    </>
  );
}

function TransactionTable() {
  return (
    <div className="transactions-table-wrap"><table className="data-table transactions-table"><thead><tr><th>Cliente</th><th>Detalhe</th><th>Método</th><th>Horário</th><th>Status</th><th>Valor</th><th><span className="sr-only">Ações</span></th></tr></thead><tbody>{financeTransactions.map((transaction, index) => <tr key={transaction.id}><td><span className="transaction-person"><Avatar initials={transaction.label.split(" ").map((part) => part[0]).join("")} tone={index % 2 ? "amber" : "sage"} size="sm" /><strong>{transaction.label}</strong></span></td><td><span><strong>{transaction.detail}</strong><small>{transaction.id}</small></span></td><td>{transaction.method}</td><td>{transaction.time}</td><td><span className={`transaction-status ${transaction.status === "Pago" ? "is-paid" : "is-partial"}`}><i />{transaction.status}</span></td><td><strong>{formatMoney(transaction.amountCents)}</strong></td><td><button type="button" className="icon-button icon-button--sm"><MoreHorizontal size={17} /></button></td></tr>)}</tbody></table></div>
  );
}


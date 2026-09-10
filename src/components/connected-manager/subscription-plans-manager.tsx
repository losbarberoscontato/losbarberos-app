"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { PageHeader } from "@/components/ui";
import type { loadSubscriptionPlansData } from "./server";
import type { AwaitedReturn } from "./utility-types";
import { ActionMessage, Field, Panel, StatusChip } from "./shared";
import { assertResult, connectedClient, runMutation } from "./mutation-utils";
import { centsFromInput, formatCents } from "./format";
import styles from "./connected-manager.module.css";

type Props = AwaitedReturn<typeof loadSubscriptionPlansData>;

export function SubscriptionPlansManager(props: Props) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [formKey, setFormKey] = useState(0);
  const [contractPlanId, setContractPlanId] = useState<string | null>(null);
  const [contractBody, setContractBody] = useState("");
  function clearForm() {
    setSelected([]);
    setMessage("");
    setFormKey((current) => current + 1);
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (!selected.length) { setMessage("Selecione ao menos um serviço."); return; }
    const saved = await runMutation(setMessage, async () => {
      await assertResult(await connectedClient().rpc("save_subscription_plan", {
        p_organization_id: props.organizationId, p_plan_id: null,
        p_name: String(data.get("name") ?? "").trim(), p_description: String(data.get("description") ?? "").trim(),
        p_price_cents: centsFromInput(data.get("price")), p_billing_period: String(data.get("billing_period")),
        p_duration_months: Number(data.get("duration_months")), p_sessions_per_cycle: Number(data.get("sessions_per_cycle")),
        p_payment_method: String(data.get("payment_method")),
        p_cancellation_policy: String(data.get("cancellation_policy") ?? "").trim(),
        p_session_cancellation_policy: String(data.get("session_cancellation_policy") ?? "").trim(),
        p_services: selected.map((service_id, position) => ({ service_id, position })),
      }));
    }, "Plano criado.");
    if (saved) { clearForm(); router.refresh(); }
  }
  async function saveContract(planId: string) {
    const saved = await runMutation(setMessage, async () => {
      await assertResult(await connectedClient().rpc("set_subscription_plan_contract", {
        p_organization_id: props.organizationId,
        p_plan_id: planId,
        p_contract_body: contractBody.trim() || null,
      }));
    }, "Contrato do plano salvo.");
    if (saved) { setContractPlanId(null); router.refresh(); }
  }
  return <div className={styles.stack}>
    <PageHeader title="Planos de Assinatura" description="Crie planos compostos por serviços. Pacotes não entram na composição da assinatura na V1." />
    <ActionMessage message={message} />
    <Panel title="Novo plano" description="Online aparece como opção futura; a V1 registra pagamento manual ou presencial.">
      <form key={formKey} className={styles.form} onSubmit={save}>
        <Field label="Nome"><input name="name" required minLength={2} /></Field>
        <Field label="Valor do ciclo (R$)"><input name="price" required inputMode="decimal" /></Field>
        <Field label="Periodicidade"><select name="billing_period" defaultValue="MONTHLY"><option value="MONTHLY">Mensal</option><option value="BIWEEKLY">Quinzenal (15 dias)</option></select></Field>
        <Field label="Duração (meses)"><input name="duration_months" type="number" min={1} max={120} defaultValue={1} required /></Field>
        <Field label="Sessões por ciclo"><input name="sessions_per_cycle" type="number" min={1} max={100} defaultValue={2} required /></Field>
        <Field label="Forma de pagamento"><select name="payment_method" defaultValue="CARD"><option value="CARD">Cartão de crédito (registro manual)</option><option value="PIX">PIX (registro manual)</option><option value="BOLETO">Boleto (registro manual)</option><option value="CASH">Dinheiro</option><option value="UPFRONT">À vista</option><option value="ONLINE" disabled>Online — função em breve</option></select></Field>
        <Field label="Descrição" wide><textarea name="description" /></Field>
        <Field label="Regra de cancelamento" wide><textarea name="cancellation_policy" required defaultValue="Cancelamento encerra no fim do ciclo pago; ciclos futuros são cancelados sem renovação automática." /></Field>
        <Field label="Política de cancelamento de sessão" wide><textarea name="session_cancellation_policy" required defaultValue="Cancelamento dentro do prazo devolve a sessão. Cancelamento tardio ou no-show consome a sessão, sem cobrança adicional." /></Field>
        <div className={styles.formWide}><span className={styles.muted}>Serviços da sessão (combo completo)</span><div className={styles.inlineMeta}>{props.services.map((service) => <label className={styles.check} key={service.id}><input type="checkbox" checked={selected.includes(service.id)} onChange={(e) => setSelected((current) => e.target.checked ? [...current, service.id] : current.filter((id) => id !== service.id))} />{service.name} · {formatCents(service.price_cents)}</label>)}</div></div>
        <div className={`${styles.toolbarGroup} ${styles.formWide}`}>
          <Link className={`${styles.button} ${styles.buttonSoft}`} href="/gestor/catalogo">Voltar para serviços</Link>
          <button className={`${styles.button} ${styles.buttonSoft}`} type="button" onClick={clearForm}>Cancelar</button>
          <button className={styles.button} type="submit" disabled={!props.services.length}>Criar plano</button>
        </div>
      </form>
    </Panel>
    <Panel title="Planos cadastrados" description={`${props.plans.length} planos`}>
      <div className={styles.list}>{props.plans.map((plan) => { const version = props.versions.find((item) => item.plan_id === plan.id); const editing = contractPlanId === plan.id; return <article className={styles.row} key={plan.id}><span className={styles.rowTitle}><strong>{plan.name}</strong><small>{plan.description || "Sem descrição"}</small></span><strong>{version ? formatCents(version.price_cents) : "—"}</strong><span>{version?.billing_period === "BIWEEKLY" ? "Quinzenal" : "Mensal"}</span><StatusChip active={plan.active} label={plan.active ? "ATIVO" : "INATIVO"} /><span className={styles.rowActions}><button type="button" className={`${styles.button} ${styles.buttonSoft} ${styles.buttonSmall}`} onClick={() => { setContractPlanId(editing ? null : plan.id); setContractBody(plan.contract_body_override ?? ""); }}>{editing ? "Fechar contrato" : "Editar contrato"}</button></span>{editing && <div className={styles.formWide}><textarea value={contractBody} onChange={(event) => setContractBody(event.target.value)} minLength={20} rows={6} placeholder="Contrato específico deste plano. Deixe vazio para usar o contrato padrão." /><div className={styles.toolbarGroup}><button type="button" className={styles.button} onClick={() => void saveContract(plan.id)}>Salvar contrato</button><small className={styles.muted}>Adesões futuras usam este texto; contratos já aceitos permanecem congelados.</small></div></div>}</article>; })}</div>
    </Panel>
  </div>;
}

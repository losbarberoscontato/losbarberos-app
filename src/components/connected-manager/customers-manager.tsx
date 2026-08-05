"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui";
import type { loadCustomersData } from "./server";
import type { AwaitedReturn } from "./utility-types";
import type { CustomerRecord } from "./types";
import { ActionMessage, EmptyState, Field, Panel, StatusChip } from "./shared";
import { assertResult, connectedClient, runMutation } from "./mutation-utils";
import styles from "./connected-manager.module.css";

type Props = AwaitedReturn<typeof loadCustomersData>;

export function CustomersManager({ organizationId, customers }: Props) {
  const router = useRouter();
  const [formOpen, setFormOpen] = useState(customers.length === 0);
  const [editing, setEditing] = useState<CustomerRecord | null>(null);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [mergeOpen, setMergeOpen] = useState(false);
  const filtered = customers.filter((customer) => `${customer.full_name} ${customer.phone_e164 ?? ""} ${customer.email ?? ""}`.toLowerCase().includes(query.toLowerCase()));

  function openEdit(customer: CustomerRecord) {
    setEditing(customer);
    setFormOpen(true);
    setMessage("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const payload = {
      organization_id: organizationId,
      full_name: String(data.get("full_name") ?? "").trim(),
      phone_e164: String(data.get("phone_e164") ?? "").trim() || null,
      email: String(data.get("email") ?? "").trim().toLowerCase() || null,
      birth_date: String(data.get("birth_date") ?? "") || null,
      notes: String(data.get("notes") ?? "").trim() || null,
    };
    const saved = await runMutation(setMessage, async () => {
      const client = connectedClient();
      const result = editing
        ? await client.from("customers").update(payload).eq("id", editing.id).eq("organization_id", organizationId)
        : await client.from("customers").insert(payload);
      await assertResult(result);
    }, editing ? "Cliente atualizado." : "Cliente cadastrado.");
    if (saved) {
      form.reset();
      setEditing(null);
      setFormOpen(false);
      router.refresh();
    }
  }

  async function toggle(customer: CustomerRecord) {
    const saved = await runMutation(setMessage, async () => {
      await assertResult(await connectedClient().from("customers").update({ active: !customer.active }).eq("id", customer.id).eq("organization_id", organizationId));
    }, customer.active ? "Cliente inativado." : "Cliente reativado.");
    if (saved) router.refresh();
  }

  async function merge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const sourceId = String(data.get("source_customer_id"));
    const targetId = String(data.get("target_customer_id"));
    const reason = String(data.get("reason") ?? "").trim();
    if (sourceId === targetId) {
      setMessage("Escolha dois cadastros diferentes.");
      return;
    }
    if (!window.confirm("Mesclar estes cadastros? O cadastro de origem será inativado e o histórico migrará para o destino.")) return;
    const saved = await runMutation(setMessage, async () => {
      await assertResult(await connectedClient().rpc("merge_customers", {
        p_organization_id: organizationId,
        p_source_customer_id: sourceId,
        p_target_customer_id: targetId,
        p_reason: reason,
      }));
    }, "Cadastros mesclados com auditoria.");
    if (saved) { setMergeOpen(false); router.refresh(); }
  }

  return <div className={styles.stack}>
    <PageHeader title="Clientes" description="Cadastros reais isolados por RLS na sua organização." />
    <Panel title="Base de clientes" description={`${customers.filter((item) => item.active).length} ativos`} action={<button className={styles.button} type="button" onClick={() => { setEditing(null); setFormOpen((value) => !value); }}>Novo cliente</button>}>
      <ActionMessage message={message} tone={message.toLowerCase().includes("erro") || message.toLowerCase().includes("negado") ? "error" : "info"} />
      {customers.length > 1 && <div className={styles.toolbarGroup}><button className={`${styles.button} ${styles.buttonSoft}`} type="button" onClick={() => setMergeOpen((value) => !value)}>Mesclar cadastros</button></div>}
      {mergeOpen && <form className={styles.form} onSubmit={merge}>
        <Field label="Cadastro de origem"><select name="source_customer_id" required>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.full_name} · {customer.phone_e164 ?? customer.email ?? "sem contato"}</option>)}</select></Field>
        <Field label="Cadastro de destino"><select name="target_customer_id" required defaultValue={customers[1]?.id}>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.full_name} · {customer.phone_e164 ?? customer.email ?? "sem contato"}</option>)}</select></Field>
        <Field label="Motivo" wide><input name="reason" required minLength={3} maxLength={500} placeholder="Duplicidade confirmada pelo gestor" /></Field>
        <div className={`${styles.toolbarGroup} ${styles.formWide}`}><button className={styles.button}>Mesclar com auditoria</button><button className={`${styles.button} ${styles.buttonSoft}`} type="button" onClick={() => setMergeOpen(false)}>Cancelar</button></div>
      </form>}
      {formOpen && <form className={styles.form} onSubmit={submit} key={editing?.id ?? "new"}>
        <Field label="Nome completo"><input name="full_name" required minLength={2} maxLength={160} defaultValue={editing?.full_name} /></Field>
        <Field label="Telefone E.164"><input name="phone_e164" inputMode="tel" placeholder="+5511999999999" pattern="\+[1-9][0-9]{7,14}" defaultValue={editing?.phone_e164 ?? ""} /></Field>
        <Field label="E-mail"><input name="email" type="email" defaultValue={editing?.email ?? ""} /></Field>
        <Field label="Nascimento (opcional)"><input name="birth_date" type="date" defaultValue={editing?.birth_date ?? ""} /></Field>
        <Field label="Observações" wide><textarea name="notes" maxLength={1000} defaultValue={editing?.notes ?? ""} /></Field>
        <div className={`${styles.toolbarGroup} ${styles.formWide}`}>
          <button className={styles.button} type="submit">{editing ? "Salvar alterações" : "Cadastrar"}</button>
          <button className={`${styles.button} ${styles.buttonSoft}`} type="button" onClick={() => { setFormOpen(false); setEditing(null); }}>Cancelar</button>
        </div>
      </form>}
      <div className={styles.toolbar}><label className={styles.field}><span>Buscar</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nome, telefone ou e-mail" /></label></div>
      {filtered.length === 0 ? <EmptyState title={customers.length ? "Nenhum resultado" : "Cadastre o primeiro cliente"}>{customers.length ? "Ajuste a busca." : "Clientes manuais podem ser criados sem login e vinculados depois."}</EmptyState> : <div className={styles.list}>{filtered.map((customer) => <article className={styles.row} key={customer.id}>
        <span className={styles.rowTitle}><strong>{customer.full_name}</strong><small>{customer.email ?? "Sem e-mail"}</small></span>
        <span>{customer.phone_e164 ?? "Sem telefone"}</span>
        <span>{customer.birth_date ? new Date(`${customer.birth_date}T12:00:00`).toLocaleDateString("pt-BR") : "Nascimento não informado"}</span>
        <StatusChip active={customer.active} />
        <span className={styles.rowActions}>
          <button className={`${styles.button} ${styles.buttonSoft} ${styles.buttonSmall}`} type="button" onClick={() => openEdit(customer)}>Editar</button>
          <button className={`${styles.button} ${customer.active ? styles.buttonDanger : styles.buttonSoft} ${styles.buttonSmall}`} type="button" onClick={() => toggle(customer)}>{customer.active ? "Inativar" : "Reativar"}</button>
        </span>
      </article>)}</div>}
    </Panel>
  </div>;
}

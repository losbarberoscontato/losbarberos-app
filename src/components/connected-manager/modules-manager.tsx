"use client";

import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui";
import type { loadModulesData } from "./server";
import type { AwaitedReturn } from "./utility-types";
import { ActionMessage, Panel, StatusChip } from "./shared";
import { assertResult, connectedClient, runMutation } from "./mutation-utils";
import { formatCents } from "./format";
import { useState } from "react";
import styles from "./connected-manager.module.css";

type ModuleData = AwaitedReturn<typeof loadModulesData>;
type Props = Omit<ModuleData, "productKey" | "kanbanPrices" | "kanbanBilling" | "nextChargeAt" | "timezone"> & {
  productKey?: ModuleData["productKey"];
  kanbanPrices?: ModuleData["kanbanPrices"];
  kanbanBilling?: ModuleData["kanbanBilling"];
  nextChargeAt?: ModuleData["nextChargeAt"];
  timezone?: ModuleData["timezone"];
};

export function ModulesManager(props: Props) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [activationOpen, setActivationOpen] = useState(false);
  const [activationModuleKey, setActivationModuleKey] = useState<string | null>(null);
  const [activationAccepted, setActivationAccepted] = useState(false);
  const enabledByKey = new Map(props.entitlements.map((item) => [item.module_key, item.enabled]));
  const priceByKey = new Map(props.prices.map((item) => [item.module_key, item]));
  const kanbanPrice = props.kanbanPrices?.find((item) => item.product_key === props.productKey && !item.retired_at);
  const pinnedKanbanPrice = props.kanbanPrices?.find((item) => item.id === props.kanbanBilling?.price_version_id);
  const nextCharge = props.nextChargeAt ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: props.timezone ?? "America/Sao_Paulo" }).format(new Date(props.nextChargeAt)) : "próximo ciclo de cobrança";

  async function changeKanban(action: "ENABLE" | "DISABLE") {
    const result = await connectedClient().functions.invoke("stripe-kanban-module", {
      body: { organizationId: props.organizationId, action, contractVersion: action === "ENABLE" ? kanbanPrice?.contract_version : null },
      headers: { "idempotency-key": crypto.randomUUID() },
    });
    await assertResult(result);
  }

  async function disable(moduleKey: string) {
    const saved = await runMutation(setMessage, async () => {
      if (moduleKey === "kanban") { await changeKanban("DISABLE"); return; }
      await assertResult(await connectedClient().rpc("set_organization_module_enabled", {
        p_organization_id: props.organizationId,
        p_module_key: moduleKey,
        p_enabled: false,
      }));
    }, moduleKey === "kanban"
      ? "Kanban desativado. Os quadros e cards foram preservados; o item recorrente saiu da assinatura."
      : moduleKey === "projects"
      ? "Módulo desativado. Se houver dados em Projetos, eles ficarão disponíveis por 60 dias para reativação; depois serão excluídos."
      : "Módulo desativado para novas adesões. Assinaturas existentes continuam até cancelamento ou término.");
    if (saved) router.refresh();
  }

  async function enableModule() {
    if (!activationModuleKey) return;
    if (!activationAccepted) {
      setMessage("Leia e aceite o aditivo para ativar o módulo.");
      return;
    }
    const saved = await runMutation(setMessage, async () => {
      if (activationModuleKey === "kanban") { await changeKanban("ENABLE"); return; }
      await assertResult(await connectedClient().rpc("accept_module_contract_and_enable", {
        p_organization_id: props.organizationId,
        p_module_key: activationModuleKey,
        p_contract_version: "v1",
        p_metadata: { source: "MANAGER_MODULES" },
      }));
    }, `Módulo ${props.modules.find((item) => item.key === activationModuleKey)?.name ?? "opcional"} ativado. A cobrança adicional será aplicada no próximo ciclo.`);
    if (saved) {
      setActivationOpen(false);
      setActivationModuleKey(null);
      setActivationAccepted(false);
      router.refresh();
    }
  }

  return <div className={styles.stack}>
    <PageHeader title="Módulos" description="Ative recursos opcionais da sua operação e consulte as condições de cada módulo." />
    <ActionMessage message={message} />
    <Panel title="Módulos disponíveis" description="Confira as condições de cada módulo antes de ativar.">
      <div className={styles.list}>
        {props.modules.map((module) => {
          const enabled = enabledByKey.get(module.key) ?? false;
          const price = module.key === "kanban" ? (enabled ? pinnedKanbanPrice ?? kanbanPrice : kanbanPrice) : priceByKey.get(module.key);
          return <article className={styles.integration} key={module.key}>
            <div className={styles.integrationInfo}>
              <span className={styles.toolbarGroup}><strong>{module.name}</strong><StatusChip active={enabled} label={enabled ? "ATIVO" : "INATIVO"} /></span>
              <p>{module.description}</p>
              <small>{price ? `${formatCents(price.monthly_price_cents)}/mês · cobrança em ${module.key === "kanban" ? nextCharge : "próximo ciclo"}` : "Preço ainda não configurado pela plataforma"}</small>
              {module.key === "kanban" && !enabled && kanbanPrice && !props.nextChargeAt && <small>Data do próximo ciclo indisponível. Aguarde a sincronização da assinatura Stripe.</small>}
            </div>
            {module.key === "projects" && <small>Se desativado, dados existentes entram em retenção de 60 dias.</small>}
            <button className={`${styles.button} ${enabled ? styles.buttonDanger : ""}`} type="button" disabled={module.key === "kanban" && !enabled && (!kanbanPrice || !props.nextChargeAt)} onClick={() => { if (enabled) void disable(module.key); else { setActivationModuleKey(module.key); setActivationOpen(true); } }}>{enabled ? "Desativar" : "Ativar"}</button>
          </article>;
        })}
      </div>
    </Panel>
    {activationOpen && <div className={styles.modalLayer} role="presentation">
      <button className={styles.modalBackdrop} type="button" aria-label="Fechar ativação do módulo" onClick={() => setActivationOpen(false)} />
      <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="module-title">
        <header className={styles.modalHeader}>
          <div><small>Aditivo do módulo</small><h2 id="module-title">Ativar {props.modules.find((item) => item.key === activationModuleKey)?.name ?? "módulo"}</h2></div>
          <button className={styles.modalClose} type="button" aria-label="Fechar" onClick={() => setActivationOpen(false)}>×</button>
        </header>
        <div className={styles.form}>
          {activationModuleKey === "kanban" ? <>
            <p className={styles.muted}>{kanbanPrice?.contract_body}</p>
            <p className={styles.muted}>Valor: {kanbanPrice ? formatCents(kanbanPrice.monthly_price_cents) : "—"}/mês. Início da cobrança: {nextCharge}. Sem cobrança proporcional neste ciclo; durante o trial, no primeiro ciclo pago.</p>
            <label className={styles.check}><input type="checkbox" checked={activationAccepted} onChange={(event) => setActivationAccepted(event.target.checked)} /> Li e aceito o aditivo {kanbanPrice?.contract_version} e autorizo a cobrança recorrente.</label>
          </> : <>
            <p className={styles.muted}>As cobranças deste módulo são responsabilidade do gestor da barbearia. O sistema não transaciona valores, não cobra clientes e não se responsabiliza por pagamentos.</p>
            <p className={styles.muted}>O módulo de pagamentos online ainda não está ativo; esta integração será disponibilizada futuramente.</p>
            <label className={styles.check}><input type="checkbox" checked={activationAccepted} onChange={(event) => setActivationAccepted(event.target.checked)} /> Li e aceito o aditivo contratual do módulo e autorizo a cobrança adicional na mensalidade do sistema a partir do próximo ciclo.</label>
          </>}
          <div className={styles.toolbarGroup}>
            <button className={`${styles.button} ${styles.buttonSoft}`} type="button" onClick={() => setActivationOpen(false)}>Cancelar</button>
            <button className={styles.button} type="button" disabled={!activationAccepted} onClick={() => void enableModule()}>Aceitar e ativar</button>
          </div>
        </div>
      </section>
    </div>}
  </div>;
}

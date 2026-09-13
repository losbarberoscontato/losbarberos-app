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

type Props = AwaitedReturn<typeof loadModulesData>;

export function ModulesManager(props: Props) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [activationOpen, setActivationOpen] = useState(false);
  const [activationAccepted, setActivationAccepted] = useState(false);
  const enabledByKey = new Map(props.entitlements.map((item) => [item.module_key, item.enabled]));
  const priceByKey = new Map(props.prices.map((item) => [item.module_key, item]));

  async function disable(moduleKey: string) {
    const saved = await runMutation(setMessage, async () => {
      await assertResult(await connectedClient().rpc("set_organization_module_enabled", {
        p_organization_id: props.organizationId,
        p_module_key: moduleKey,
        p_enabled: false,
      }));
    }, "Módulo desativado para novas adesões. Assinaturas existentes continuam até cancelamento ou término.");
    if (saved) router.refresh();
  }

  async function enableSubscriptionModule() {
    if (!activationAccepted) {
      setMessage("Leia e aceite o aditivo para ativar o módulo.");
      return;
    }
    const saved = await runMutation(setMessage, async () => {
      await assertResult(await connectedClient().rpc("accept_subscription_module_contract_and_enable", {
        p_organization_id: props.organizationId,
        p_contract_version: "v1",
        p_metadata: { source: "MANAGER_MODULES" },
      }));
    }, "Módulo ativado. Novas assinaturas já podem ser iniciadas.");
    if (saved) {
      setActivationOpen(false);
      setActivationAccepted(false);
      router.refresh();
    }
  }

  return <div className={styles.stack}>
    <PageHeader title="Módulos" description="Ative recursos opcionais da sua operação. Desativar impede novas vendas, mas preserva assinaturas ativas." />
    <ActionMessage message={message} />
    <Panel title="Módulos disponíveis" description="A cobrança adicional por módulo será conectada à assinatura da barbearia em uma versão futura.">
      <div className={styles.list}>
        {props.modules.map((module) => {
          const enabled = enabledByKey.get(module.key) ?? false;
          const price = priceByKey.get(module.key);
          return <article className={styles.integration} key={module.key}>
            <div className={styles.integrationInfo}>
              <span className={styles.toolbarGroup}><strong>{module.name}</strong><StatusChip active={enabled} label={enabled ? "ATIVO" : "INATIVO"} /></span>
              <p>{module.description}</p>
              <small>{price ? `${formatCents(price.monthly_price_cents)}/mês · cobrança no próximo ciclo` : "Preço ainda não configurado pela plataforma"}</small>
            </div>
            <button className={`${styles.button} ${enabled ? styles.buttonDanger : ""}`} type="button" onClick={() => enabled ? void disable(module.key) : setActivationOpen(true)}>{enabled ? "Desativar" : "Ativar"}</button>
          </article>;
        })}
      </div>
    </Panel>
    {activationOpen && <div className={styles.modalLayer} role="presentation">
      <button className={styles.modalBackdrop} type="button" aria-label="Fechar ativação do módulo" onClick={() => setActivationOpen(false)} />
      <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="subscription-module-title">
        <header className={styles.modalHeader}>
          <div><small>Aditivo do módulo</small><h2 id="subscription-module-title">Ativar Planos de Assinatura</h2></div>
          <button className={styles.modalClose} type="button" aria-label="Fechar" onClick={() => setActivationOpen(false)}>×</button>
        </header>
        <div className={styles.form}>
          <p className={styles.muted}>As cobranças dos planos são responsabilidade do gestor da barbearia. O sistema não transaciona valores, não cobra clientes e não se responsabiliza por pagamentos dos planos.</p>
          <p className={styles.muted}>O módulo de pagamentos online ainda não está ativo; esta integração será disponibilizada futuramente.</p>
          <label className={styles.check}><input type="checkbox" checked={activationAccepted} onChange={(event) => setActivationAccepted(event.target.checked)} /> Li e aceito o aditivo contratual do módulo e autorizo a cobrança adicional na mensalidade do sistema a partir do próximo ciclo.</label>
          <div className={styles.toolbarGroup}>
            <button className={`${styles.button} ${styles.buttonSoft}`} type="button" onClick={() => setActivationOpen(false)}>Cancelar</button>
            <button className={styles.button} type="button" disabled={!activationAccepted} onClick={() => void enableSubscriptionModule()}>Aceitar e ativar</button>
          </div>
        </div>
      </section>
    </div>}
  </div>;
}

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
  const enabledByKey = new Map(props.entitlements.map((item) => [item.module_key, item.enabled]));
  const priceByKey = new Map(props.prices.map((item) => [item.module_key, item]));

  async function toggle(moduleKey: string, enabled: boolean) {
    const saved = await runMutation(setMessage, async () => {
      await assertResult(await connectedClient().rpc("set_organization_module_enabled", {
        p_organization_id: props.organizationId,
        p_module_key: moduleKey,
        p_enabled: enabled,
      }));
    }, enabled ? "Módulo ativado. Novas vendas já podem ser iniciadas." : "Módulo desativado para novas vendas. Assinaturas existentes continuam.");
    if (saved) router.refresh();
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
              <small>{price ? `${formatCents(price.monthly_price_cents)}/mês configurado para o futuro` : "Preço ainda não configurado pela plataforma"}</small>
            </div>
            <button className={`${styles.button} ${enabled ? styles.buttonDanger : ""}`} type="button" onClick={() => void toggle(module.key, !enabled)}>{enabled ? "Desativar" : "Ativar"}</button>
          </article>;
        })}
      </div>
    </Panel>
  </div>;
}

"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui";
import type { loadCatalogData } from "./server";
import type { AwaitedReturn } from "./utility-types";
import type { PackageRecord, ServiceRecord } from "./types";
import { centsFromInput, formatCents } from "./format";
import { ActionMessage, EmptyState, Field, Panel, StatusChip } from "./shared";
import { assertResult, connectedClient, runMutation } from "./mutation-utils";
import styles from "./connected-manager.module.css";
import { CATALOG_AUDIENCES, audienceLabel, type CatalogAudience, hasAudience } from "@/lib/catalog-audiences";

type Props = AwaitedReturn<typeof loadCatalogData>;

export function CatalogManager({ organizationId, services, packages: allPackages, packageItems }: Props) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [serviceForm, setServiceForm] = useState<ServiceRecord | "new" | null>(services.length ? null : "new");
  const [packageForm, setPackageForm] = useState<PackageRecord | "new" | null>(null);
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [pendingPackageInactivation, setPendingPackageInactivation] = useState<PackageRecord | null>(null);
  const [pendingPackageReactivation, setPendingPackageReactivation] = useState<PackageRecord | null>(null);
  const [packageFilter, setPackageFilter] = useState<"ACTIVE" | "INACTIVE">("ACTIVE");
  const serviceById = new Map(services.map((service) => [service.id, service]));
  const packages = allPackages.filter((item) => packageFilter === "ACTIVE" ? item.active : !item.active);

  function editPackage(item: PackageRecord) {
    setPackageForm(item);
    setSelectedServices(packageItems.filter((link) => link.package_id === item.id && link.active).map((link) => link.service_id));
  }

  function audiencesFromForm(data: FormData): CatalogAudience[] {
    return data.getAll("audience").filter((value): value is CatalogAudience =>
      typeof value === "string" && CATALOG_AUDIENCES.includes(value as CatalogAudience)
    );
  }

  async function saveService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const editing = serviceForm !== "new" && serviceForm;
    const payload = {
      organization_id: organizationId,
      name: String(data.get("name") ?? "").trim(),
      description: String(data.get("description") ?? "").trim() || null,
      price_cents: centsFromInput(data.get("price")),
      duration_minutes: Number(data.get("duration")),
      audiences: audiencesFromForm(data),
    };
    if (!hasAudience(payload.audiences)) { setMessage("Selecione pelo menos um público."); return; }
    const saved = await runMutation(setMessage, async () => {
      const client = connectedClient();
      await assertResult(editing
        ? await client.from("services").update(payload).eq("id", editing.id).eq("organization_id", organizationId)
        : await client.from("services").insert(payload));
    }, editing ? "Serviço atualizado." : "Serviço criado.");
    if (saved) { setServiceForm(null); router.refresh(); }
  }

  async function savePackage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedServices.length) { setMessage("Selecione pelo menos um serviço para o pacote."); return; }
    const form = event.currentTarget;
    const data = new FormData(form);
    const editing = packageForm === "new" ? null : packageForm;
    const name = String(data.get("name") ?? "").trim();
    const description = String(data.get("description") ?? "").trim();
    const priceCents = centsFromInput(data.get("price"));
    const audiences = audiencesFromForm(data);
    if (!hasAudience(audiences)) { setMessage("Selecione pelo menos um público."); return; }
    const saved = await runMutation(setMessage, async () => {
      await assertResult(await connectedClient().rpc("save_package_with_items", {
        p_organization_id: organizationId,
        p_package_id: editing?.id ?? null,
        p_name: name,
        p_description: description,
        p_price_cents: priceCents,
        p_active: editing?.active ?? true,
        p_sort_order: editing?.sort_order ?? 0,
        p_audiences: audiences,
        p_items: selectedServices.map((serviceId) => ({ service_id: serviceId, quantity: 1 })),
      }));
    }, editing ? "Pacote atualizado." : "Pacote criado.");
    if (saved) { setPackageForm(null); setSelectedServices([]); router.refresh(); }
  }

  async function toggle(table: "services" | "packages", item: ServiceRecord | PackageRecord) {
    if (table === "packages" && item.active) {
      setPendingPackageInactivation(item);
      return;
    }
    if (table === "packages") {
      setPendingPackageReactivation(item);
      return;
    }
    const saved = await runMutation(setMessage, async () => {
      await assertResult(await connectedClient().from(table).update({ active: !item.active }).eq("id", item.id).eq("organization_id", organizationId));
    }, item.active ? "Item inativado." : "Item reativado.");
    if (saved) router.refresh();
  }

  async function confirmPackageInactivation() {
    if (!pendingPackageInactivation) return;
    const item = pendingPackageInactivation;
    setPendingPackageInactivation(null);
    const saved = await runMutation(setMessage, async () => {
      await assertResult(await connectedClient().rpc("set_package_active", {
        p_organization_id: organizationId,
        p_package_id: item.id,
        p_active: false,
      }));
    }, "Pacote inativado.");
    if (saved) router.refresh();
  }

  async function confirmPackageReactivation() {
    if (!pendingPackageReactivation) return;
    const item = pendingPackageReactivation;
    setPendingPackageReactivation(null);
    const saved = await runMutation(setMessage, async () => {
      await assertResult(await connectedClient().rpc("set_package_active", {
        p_organization_id: organizationId,
        p_package_id: item.id,
        p_active: true,
      }));
    }, "Pacote reativado.");
    if (saved) router.refresh();
  }

  return <div className={styles.stack}>
    <PageHeader title="Serviços e pacotes" description="Catálogo real, em centavos e com duração usada pela agenda." />
    <ActionMessage message={message} />
    <div className={styles.grid}>
      <Panel title="Serviços" description={`${services.filter((item) => item.active).length} ativos`} className={styles.span6} action={<button className={styles.button} type="button" onClick={() => setServiceForm("new")}>Novo serviço</button>}>
        {serviceForm && <form className={styles.form} onSubmit={saveService} key={serviceForm === "new" ? "new" : serviceForm.id}>
          <Field label="Nome"><input name="name" required minLength={2} defaultValue={serviceForm === "new" ? "" : serviceForm.name} /></Field>
          <Field label="Preço (R$)"><input name="price" required inputMode="decimal" defaultValue={serviceForm === "new" ? "" : (serviceForm.price_cents / 100).toFixed(2).replace(".", ",")} /></Field>
          <Field label="Duração (minutos)"><input name="duration" required type="number" min={5} max={720} step={5} defaultValue={serviceForm === "new" ? 30 : serviceForm.duration_minutes} /></Field>
          <Field label="Descrição"><input name="description" defaultValue={serviceForm === "new" ? "" : serviceForm.description ?? ""} /></Field>
          <div className={styles.formWide}><span className={styles.muted}>Público</span><div className={styles.inlineMeta}>{CATALOG_AUDIENCES.map((audience) => <label className={styles.check} key={audience}><input type="checkbox" name="audience" value={audience} defaultChecked={serviceForm !== "new" && serviceForm.audiences.includes(audience)} />{audienceLabel(audience)}</label>)}</div></div>
          <div className={`${styles.toolbarGroup} ${styles.formWide}`}><button className={styles.button} type="submit">Salvar</button><button className={`${styles.button} ${styles.buttonSoft}`} type="button" onClick={() => setServiceForm(null)}>Cancelar</button></div>
        </form>}
        {services.length === 0 ? <EmptyState title="Sem serviços">Cadastre o primeiro procedimento.</EmptyState> : <div className={styles.list}>{services.map((service) => <article className={styles.row} key={service.id}>
              <span className={styles.rowTitle}><strong>{service.name}</strong><small>{service.description ?? "Sem descrição"}</small><small>{service.audiences.map(audienceLabel).join(" · ") || "Sem público"}</small></span>
          <strong>{formatCents(service.price_cents)}</strong><span>{service.duration_minutes} min</span><StatusChip active={service.active} />
          <span className={styles.rowActions}><button className={`${styles.button} ${styles.buttonSoft} ${styles.buttonSmall}`} type="button" onClick={() => setServiceForm(service)}>Editar</button><button className={`${styles.button} ${styles.buttonSmall} ${service.active ? styles.buttonDanger : styles.buttonSoft}`} type="button" onClick={() => toggle("services", service)}>{service.active ? "Inativar" : "Reativar"}</button></span>
        </article>)}</div>}
      </Panel>
      <Panel title="Pacotes" titleAdornment={<select className={styles.packageFilterSelect} aria-label="Filtro de pacotes" value={packageFilter} onChange={(event) => setPackageFilter(event.target.value as "ACTIVE" | "INACTIVE")}><option value="ACTIVE">Ativos</option><option value="INACTIVE">Inativos</option></select>} description="Uso em uma única visita" className={styles.span6} action={<button className={styles.button} type="button" disabled={!services.some((item) => item.active)} onClick={() => { setPackageForm("new"); setSelectedServices([]); }}>Novo pacote</button>}>
        {packageForm && <form className={styles.form} onSubmit={savePackage} key={packageForm === "new" ? "new" : packageForm.id}>
          <Field label="Nome"><input name="name" required minLength={2} defaultValue={packageForm === "new" ? "" : packageForm.name} /></Field>
          <Field label="Preço do pacote (R$)"><input name="price" required inputMode="decimal" defaultValue={packageForm === "new" ? "" : (packageForm.price_cents / 100).toFixed(2).replace(".", ",")} /></Field>
          <Field label="Descrição" wide><input name="description" defaultValue={packageForm === "new" ? "" : packageForm.description ?? ""} /></Field>
          <div className={styles.formWide}><span className={styles.muted}>Público</span><div className={styles.inlineMeta}>{CATALOG_AUDIENCES.map((audience) => <label className={styles.check} key={audience}><input type="checkbox" name="audience" value={audience} defaultChecked={packageForm !== "new" && packageForm.audiences.includes(audience)} />{audienceLabel(audience)}</label>)}</div></div>
          <div className={styles.formWide}><span className={styles.muted}>Serviços incluídos</span><div className={styles.inlineMeta}>{services.filter((item) => item.active).map((service) => <label className={styles.check} key={service.id}><input type="checkbox" checked={selectedServices.includes(service.id)} onChange={(event) => setSelectedServices((current) => event.target.checked ? [...current, service.id] : current.filter((id) => id !== service.id))} />{service.name}</label>)}</div></div>
          <div className={`${styles.toolbarGroup} ${styles.formWide}`}><button className={styles.button} type="submit">Salvar</button><button className={`${styles.button} ${styles.buttonSoft}`} type="button" onClick={() => setPackageForm(null)}>Cancelar</button></div>
        </form>}
        {packages.length === 0 ? <EmptyState title="Sem pacotes">Crie combinações depois de cadastrar serviços.</EmptyState> : <div className={styles.list}>{packages.map((item) => <article className={styles.row} key={item.id}>
          <span className={styles.rowTitle}><strong>{item.name}</strong><small>{packageItems.filter((link) => link.package_id === item.id && link.active).map((link) => serviceById.get(link.service_id)?.name).filter(Boolean).join(" + ") || "Sem itens"}</small><small>{item.audiences.map(audienceLabel).join(" · ") || "Sem público"}</small></span>
          <strong>{formatCents(item.price_cents)}</strong><span>{packageItems.filter((link) => link.package_id === item.id && link.active).length} itens</span><StatusChip active={item.active} />
          <span className={styles.rowActions}><button className={`${styles.button} ${styles.buttonSoft} ${styles.buttonSmall}`} type="button" onClick={() => editPackage(item)}>Editar</button><button className={`${styles.button} ${styles.buttonSmall} ${item.active ? styles.buttonDanger : styles.buttonSoft}`} type="button" onClick={() => toggle("packages", item)}>{item.active ? "Inativar" : "Reativar"}</button></span>
        </article>)}</div>}
      </Panel>
    </div>
    {pendingPackageInactivation && <div className={styles.modalLayer} role="presentation"><button type="button" className={styles.modalBackdrop} aria-label="Fechar confirmação" onClick={() => setPendingPackageInactivation(null)} /><section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="inactivate-package-title"><h2 id="inactivate-package-title">Deseja inativar este pacote?</h2><p>{pendingPackageInactivation.name} não aparecerá para novos agendamentos.</p><div className={styles.toolbarGroup}><button type="button" className={`${styles.button} ${styles.buttonSoft}`} onClick={() => setPendingPackageInactivation(null)}>Cancelar</button><button type="button" className={`${styles.button} ${styles.buttonDanger}`} onClick={() => void confirmPackageInactivation()}>Inativar pacote</button></div></section></div>}
    {pendingPackageReactivation && <div className={styles.modalLayer} role="presentation"><button type="button" className={styles.modalBackdrop} aria-label="Fechar confirmação" onClick={() => setPendingPackageReactivation(null)} /><section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="reactivate-package-title"><h2 id="reactivate-package-title">Deseja reativar o pacote?</h2><p>Esta ação fará este pacote aparecer novamente para seus clientes.</p><div className={styles.toolbarGroup}><button type="button" className={`${styles.button} ${styles.buttonSoft}`} onClick={() => setPendingPackageReactivation(null)}>Cancelar</button><button type="button" className={styles.button} onClick={() => void confirmPackageReactivation()}>Reativar pacote</button></div></section></div>}
  </div>;
}

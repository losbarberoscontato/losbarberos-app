"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck, CheckCircle2, ChevronRight, ExternalLink, MessageSquare, Plus, Save, Trash2 } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { loadBarberProject, loadBarberProjects } from "@/lib/barber-server";
import styles from "./projects.module.css";

type ListData = Awaited<ReturnType<typeof loadBarberProjects>>;
type DetailData = NonNullable<Awaited<ReturnType<typeof loadBarberProject>>>;

function localToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function internalServiceClass(service: DetailData["internalServices"][number]) {
  if (service.status === "READY_FOR_REVIEW") return styles.internalServiceReady;
  if (service.status === "COMPLETED") return styles.internalServiceCompleted;
  if (service.delivery_on === localToday()) return styles.internalServiceDueToday;
  if (service.delivery_on && service.delivery_on < localToday()) return styles.internalServiceOverdue;
  return "";
}

function InternalServicePanel({ service, context, projectId, busy, onCall, compact = false }: {
  service: DetailData["internalServices"][number]; context: DetailData["context"]; projectId: string;
  busy: boolean; onCall: (name: string, args: Record<string, unknown>) => void; compact?: boolean;
}) {
  if (compact) return <div className={styles.internalServiceCompact}><CalendarCheck size={14} /> Serviço aberto</div>;
  const [deliveryOn, setDeliveryOn] = useState(service.delivery_on ?? "");
  const canSetDelivery = service.status === "OPEN" && !service.delivery_on;
  const canSubmit = service.status === "OPEN" && Boolean(service.delivery_on);
  const statusLabel = service.status === "READY_FOR_REVIEW" ? "Pronto para revisão" : service.status === "COMPLETED" ? "Concluído · comissão a pagar" : service.delivery_on && service.delivery_on < localToday() ? "Atrasado" : service.delivery_on === localToday() ? "Vence hoje" : "Em aberto";
  return <div className={`${styles.internalService} ${internalServiceClass(service)}`} aria-label="Serviço Interno">
    <div className={styles.internalServiceHeader}><span><strong><CalendarCheck size={15} /> Serviço Interno</strong><small>{service.service_name}</small></span><em>{statusLabel}</em></div>
    <div className={styles.internalServiceMeta}><span>Comissão: R$ {(service.commission_cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span>{service.delivery_on && <span>Entrega: {new Date(`${service.delivery_on}T12:00:00`).toLocaleDateString("pt-BR")}</span>}</div>
    {canSetDelivery && <div className={styles.internalServiceAction}><label>Data de entrega<input type="date" value={deliveryOn} disabled={busy} onChange={(event) => setDeliveryOn(event.target.value)} /></label><button type="button" disabled={busy || !deliveryOn} onClick={() => onCall("barber_set_project_internal_service_delivery", { p_organization_id: context.organization_id, p_project_id: projectId, p_internal_service_id: service.id, p_delivery_on: deliveryOn })}><Save size={14} /> Salvar prazo</button></div>}
    {canSubmit && <button className={styles.reviewButton} type="button" disabled={busy} onClick={() => onCall("barber_submit_project_internal_service_review", { p_organization_id: context.organization_id, p_project_id: projectId, p_internal_service_id: service.id })}><CheckCircle2 size={15} /> Concluir para revisão</button>}
    {service.status === "READY_FOR_REVIEW" && <small className={styles.internalServiceHint}>Aguardando a revisão do gestor.</small>}
  </div>;
}

export function BarberProjectsList({ data }: { data: NonNullable<ListData> }) {
  const router = useRouter();
  return <section className={styles.wrap}><header><span className={styles.eyebrow}>Núcleo operacional</span><h1>Projetos</h1><p>Projetos publicados aos quais você está vinculado.</p></header><div className={styles.grid}>{data.projects.map((project) => <button type="button" className={styles.projectCard} key={project.project_id} onClick={() => router.push(`/barbeiro/projetos/${project.project_id}?barbearia=${encodeURIComponent(data.context.organization_slug)}`)}><span><strong>{project.name}</strong><small>{project.description || "Sem descrição"}</small></span><ChevronRight size={20} /></button>)}</div>{!data.projects.length && <div className={styles.empty}>Nenhum projeto foi vinculado ao seu acesso.</div>}</section>;
}

export function BarberProjectKanban({ data }: { data: DetailData }) {
  const router = useRouter();
  const supabase = getSupabaseBrowserClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [comment, setComment] = useState("");
  const [linkDrafts, setLinkDrafts] = useState(() => Array.from({ length: 3 }, () => ({ label: "", url: "" })));
  const [busy, setBusy] = useState(false);
  const selected = data.engagements.find((item) => item.id === selectedId) ?? null;
  const selectedService = selected ? data.internalServices.find((item) => item.engagement_id === selected.id) ?? null : null;
  const links = data.links.filter((item) => item.engagement_id === selectedId);
  const comments = data.comments.filter((item) => item.engagement_id === selectedId);

  async function call(name: string, args: Record<string, unknown>) {
    if (!supabase) return;
    setBusy(true);
    const { error } = await supabase.rpc(name, args);
    setBusy(false);
    if (error) window.alert(error.message);
    else router.refresh();
  }
  function openCard(id: string) {
    const card = data.engagements.find((item) => item.id === id);
    setSelectedId(id); setDescription(card?.event_description ?? "");
  }
  async function saveLinks() {
    if (!selected || !supabase) return;
    setBusy(true);
    for (const draft of linkDrafts) {
      if (!draft.url.trim()) continue;
      const { error } = await supabase.rpc("barber_add_project_engagement_link", { p_organization_id: data.context.organization_id, p_project_id: data.project.id, p_engagement_id: selected.id, p_label: draft.label, p_url: draft.url });
      if (error) { window.alert(error.message); setBusy(false); return; }
    }
    setBusy(false);
    setSelectedId(null);
    setLinkDrafts(Array.from({ length: 3 }, () => ({ label: "", url: "" })));
    router.refresh();
  }
  return <section className={styles.wrap}><header className={styles.detailHeader}><div><span className={styles.eyebrow}>Projeto</span><h1>{data.project.name}</h1><p>{data.project.description || "Kanban operacional"}</p></div><button className={styles.back} type="button" onClick={() => router.push(`/barbeiro/projetos?barbearia=${encodeURIComponent(data.context.organization_slug)}`)}>Voltar</button></header><div className={styles.kanban}>{data.boards.map((board) => <article className={styles.lane} key={board.id}><h2>{board.name}<span>{data.engagements.filter((item) => item.kanban_board_id === board.id).length}</span></h2>{data.engagements.filter((item) => item.kanban_board_id === board.id).map((card) => <div className={styles.card} draggable onDragStart={(event) => event.dataTransfer.setData("text/plain", card.id)} onDoubleClick={() => openCard(card.id)} key={card.id}><strong>{card.customer?.full_name ?? "Cliente"}</strong><small>{card.event_description || "Sem descrição"}</small>{data.internalServices.filter((item) => item.engagement_id === card.id).map((service) => <InternalServicePanel key={service.id} service={service} context={data.context} projectId={data.project.id} busy={busy} onCall={(name, args) => void call(name, args)} />)}<label>Prazo<input type="date" defaultValue={card.event_due_on ?? ""} disabled={Boolean(card.event_due_on)} onChange={(event) => void call("barber_set_project_due_date", { p_organization_id: data.context.organization_id, p_project_id: data.project.id, p_engagement_id: card.id, p_due_on: event.target.value })} /></label></div>)}<div className={styles.dropzone} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const id = event.dataTransfer.getData("text/plain"); if (id) void call("barber_move_project_engagement", { p_organization_id: data.context.organization_id, p_project_id: data.project.id, p_engagement_id: id, p_destination_board_id: board.id }); }}>Mover card para cá</div></article>)}</div>{selected && <div className={styles.dialogLayer}><div className={styles.dialog} role="dialog" aria-label="Detalhes do card"><div className={styles.dialogHead}><h2>{selected.customer?.full_name ?? "Card"}</h2><button type="button" onClick={() => setSelectedId(null)}>Fechar</button></div>{selectedService && <InternalServicePanel service={selectedService} context={data.context} projectId={data.project.id} busy={busy} onCall={(name, args) => void call(name, args)} />}<label>Descrição<textarea value={description} onChange={(event) => setDescription(event.target.value)} /><button type="button" disabled={busy} onClick={() => void call("barber_update_project_engagement", { p_organization_id: data.context.organization_id, p_project_id: data.project.id, p_engagement_id: selected.id, p_description: description })}><Save size={15} /> Salvar descrição</button></label><div className={styles.subsection}><h3>Links</h3>{links.map((link) => <div className={styles.row} key={link.id}><a href={link.url} target="_blank" rel="noreferrer">{link.label}<ExternalLink size={14} /></a>{link.created_by === data.context.barber_id && <button type="button" onClick={() => void call("barber_delete_project_engagement_link", { p_organization_id: data.context.organization_id, p_link_id: link.id })}><Trash2 size={14} /></button>}</div>)}{linkDrafts.map((draft, index) => <div className={styles.inline} key={index}><input aria-label={`Título do link ${index + 1}`} value={draft.label} onChange={(event) => setLinkDrafts((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item))} placeholder="Título" /><input aria-label={`URL do link ${index + 1}`} value={draft.url} onChange={(event) => setLinkDrafts((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, url: event.target.value } : item))} placeholder="https://" /></div>)}<button type="button" disabled={busy} onClick={() => void saveLinks()}><Save size={15} /> Salvar links</button></div><div className={styles.subsection}><h3><MessageSquare size={15} /> Comentários</h3>{comments.map((item) => <p className={styles.comment} key={item.id}><strong>{item.author_name}</strong>{item.body}</p>)}<div className={styles.inline}><input value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Adicionar comentário" /><button type="button" onClick={() => void call("barber_add_project_engagement_comment", { p_organization_id: data.context.organization_id, p_project_id: data.project.id, p_engagement_id: selected.id, p_body: comment })}><Plus size={15} /></button></div></div></div></div>}</section>;
}

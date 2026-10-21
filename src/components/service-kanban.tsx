"use client";

import { useId, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Archive, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { assertResult, connectedClient, runMutation } from "@/components/connected-manager/mutation-utils";
import { ActionMessage, Field, Panel } from "@/components/connected-manager/shared";
import type { ServiceKanbanData, ServiceKanbanBoard, ServiceKanbanCard } from "@/lib/service-kanban-server";
import styles from "@/components/connected-manager/connected-manager.module.css";

export function ServiceKanban({ data }: { data: ServiceKanbanData }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [showArchive, setShowArchive] = useState(false);
  const [editing, setEditing] = useState(false);
  const [createCardOpen, setCreateCardOpen] = useState(false);
  const [newBoardOpen, setNewBoardOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [responsible, setResponsible] = useState("");
  const [customer, setCustomer] = useState("");
  const [service, setService] = useState("");
  const [newBoardName, setNewBoardName] = useState("");
  const [newBoardResponsible, setNewBoardResponsible] = useState("");
  const [boards, setBoards] = useState(data.boards);
  const [previousBoards, setPreviousBoards] = useState(data.boards);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOverBoardId, setDragOverBoardId] = useState<string | null>(null);

  if (data.boards !== previousBoards) {
    setPreviousBoards(data.boards);
    setBoards(data.boards);
  }

  const professionalName = (id: string | null) => data.barbers.find((item) => item.id === id)?.display_name ?? "Profissional";
  const canReceive = (board: ServiceKanbanBoard) => board.system_key === "WAITING" || Boolean(board.responsible_barber_id);

  async function mutateCard(card: ServiceKanbanCard, action: "MOVED" | "EDITED" | "COMPLETED" | "REOPENED", boardId?: string, newTitle?: string) {
    if (action === "COMPLETED" && !window.confirm(`Concluir e arquivar o card “${card.title}”?`)) return;
    const saved = await runMutation(setMessage, async () => {
      await assertResult(await connectedClient().rpc("mutate_service_kanban_card", {
        p_organization_id: data.organizationId, p_card_id: card.id, p_action: action,
        p_board_id: boardId ?? null, p_title: newTitle ?? null,
      }));
    }, action === "COMPLETED" ? "Card concluído e arquivado." : "Kanban atualizado.");
    if (saved) router.refresh();
  }

  async function saveBoard(board: ServiceKanbanBoard | null, name: string, barberId: string | null) {
    if (!name.trim()) return;
    const saved = await runMutation(setMessage, async () => {
      await assertResult(await connectedClient().rpc("save_service_kanban_board", {
        p_organization_id: data.organizationId, p_board_id: board?.id ?? null,
        p_name: name.trim(), p_responsible_barber_id: barberId,
      }));
    }, board ? "Quadro atualizado." : "Quadro adicionado.");
    if (saved) {
      setNewBoardName("");
      setNewBoardResponsible("");
      setNewBoardOpen(false);
      router.refresh();
    }
  }

  async function deleteBoard(board: ServiceKanbanBoard) {
    if (!window.confirm(`Excluir o quadro “${board.name}”? O quadro precisa estar vazio.`)) return;
    const saved = await runMutation(setMessage, async () => {
      await assertResult(await connectedClient().rpc("delete_service_kanban_board", {
        p_organization_id: data.organizationId, p_board_id: board.id,
      }));
    }, "Quadro excluído.");
    if (saved) router.refresh();
  }

  async function createCard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const saved = await runMutation(setMessage, async () => {
      await assertResult(await connectedClient().rpc("create_manual_service_kanban_card", {
        p_organization_id: data.organizationId, p_title: title.trim(),
        p_responsible_barber_id: responsible, p_customer_id: customer || null, p_service_id: service || null,
        p_description: description.trim() || null,
      }));
    }, "Card manual criado em Aguardando.");
    if (saved) {
      setTitle("");
      setDescription("");
      setResponsible("");
      setCustomer("");
      setService("");
      setCreateCardOpen(false);
      router.refresh();
    }
  }

  function moveCardToBoard(card: ServiceKanbanCard, board: ServiceKanbanBoard) {
    if (!canReceive(board)) {
      setMessage("Atribua um responsável ao quadro antes de mover cards para ele.");
      return;
    }
    if (card.board_id !== board.id) void mutateCard(card, "MOVED", board.id);
  }

  if (!data.enabled) return <div className={styles.stack}><PageHeader title="Kanban" description="Ative o módulo em Configurações → Gerencia minha assinatura → Módulos." /></div>;
  const orderedBoards = [...boards].sort((a, b) => a.position - b.position);
  const activeCards = data.cards.filter((card) => !card.archived_at);
  const archivedCards = data.cards.filter((card) => card.archived_at);

  return <div className={styles.stack}>
    <PageHeader title="Kanban" description="Esteira dos atendimentos de serviços, pacotes e assinaturas." />
    <ActionMessage message={message} />
    <Panel title="Quadro Kanban" description="Arraste atendimentos e cards avulsos entre os quadros. Movimentos não alteram o atendimento." action={data.manager ? <div className={styles.toolbarGroup}>
      <button className={`${styles.button} ${styles.buttonSoft}`} type="button" onClick={() => setCreateCardOpen(true)}><Plus size={15} /> Criar Card</button>
      {editing && <button className={`${styles.button} ${styles.buttonSoft}`} type="button" onClick={() => setNewBoardOpen(true)} disabled={!data.barbers.length}><Plus size={15} /> Adicionar quadro</button>}
      <button className={`${styles.button} ${editing ? styles.buttonSoft : ""}`} type="button" onClick={() => setEditing((value) => !value)}><Pencil size={15} /> {editing ? "Concluir edição" : "Editar Quadro"}</button>
    </div> : undefined}>
      <div className={styles.kanbanWorkspace}>
        <div className={styles.kanbanToolbar}>
          <div><h2>Atendimentos</h2><p>{activeCards.length} cards ativos</p></div>
          {data.manager && <button className={styles.button} type="button" onClick={() => setShowArchive((value) => !value)}><Archive size={15} /> {showArchive ? "Ocultar arquivo" : `Arquivo (${archivedCards.length})`}</button>}
        </div>
        <div className={styles.kanban}>
          {orderedBoards.map((board) => {
            const cards = activeCards.filter((card) => card.board_id === board.id);
            const locked = board.system_key === "WAITING";
            return <section
              className={`${styles.kanbanLane} ${dragOverBoardId === board.id ? styles.kanbanLaneDropTarget : ""}`}
              key={board.id}
              onDragOver={(event) => { event.preventDefault(); setDragOverBoardId(board.id); }}
              onDragLeave={() => setDragOverBoardId(null)}
              onDrop={(event) => {
                event.preventDefault();
                const card = data.cards.find((item) => item.id === (event.dataTransfer.getData("text/plain") || dragging));
                setDragging(null);
                setDragOverBoardId(null);
                if (card) moveCardToBoard(card, board);
              }}
            >
              <header>
                <div className={styles.kanbanLaneTitle}>
                  {editing && !locked && data.manager
                    ? <input aria-label={`Nome do quadro ${board.name}`} value={board.name} onChange={(event) => setBoards((current) => current.map((item) => item.id === board.id ? { ...item, name: event.target.value } : item))} />
                    : <strong>{board.name}</strong>}
                  {editing && !locked && data.manager && <button className={`${styles.button} ${styles.buttonSoft} ${styles.iconButton}`} type="button" aria-label={`Salvar quadro ${board.name}`} title="Salvar quadro" disabled={!board.name.trim()} onClick={() => void saveBoard(board, board.name, board.responsible_barber_id)}><Save size={14} /></button>}
                </div>
                <div className={styles.kanbanLaneActions}>
                  <span>{cards.length}</span>
                  {editing && !locked && data.manager && <button className={`${styles.button} ${styles.buttonSoft} ${styles.iconButton}`} type="button" aria-label={`Excluir quadro ${board.name}`} title="Excluir quadro" onClick={() => void deleteBoard(board)}><Trash2 size={14} /></button>}
                </div>
              </header>
              {data.manager && !locked && <label className={styles.kanbanResponsible}>
                <span>Responsável pelo quadro</span>
                <select aria-label={`Responsável pelo quadro ${board.name}`} value={board.responsible_barber_id ?? ""} disabled={!editing} onChange={(event) => setBoards((current) => current.map((item) => item.id === board.id ? { ...item, responsible_barber_id: event.target.value || null } : item))}>
                  <option value="">Não atribuído</option>{data.barbers.map((barber) => <option value={barber.id} key={barber.id}>{barber.display_name}</option>)}
                </select>
              </label>}
              {board.system_key !== "WAITING" && !board.responsible_barber_id && <p className={styles.kanbanNote}>Atribua um responsável para receber cards.</p>}
              {cards.map((card) => <article className={styles.kanbanCard} key={card.id} draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", card.id); setDragging(card.id); }} onDragEnd={() => { setDragging(null); setDragOverBoardId(null); }} data-dragging={dragging === card.id ? "true" : undefined}>
                <small className={styles.kanbanCardContext}>{card.customer_id ? data.customers.find((item) => item.id === card.customer_id)?.full_name ?? "Atendimento" : "Card manual"}</small>
                <strong>{card.title}</strong>
                {card.description && <p className={styles.kanbanCardDescription}>{card.description}</p>}
                <p className={styles.kanbanCardDescription}>Responsável: {professionalName(card.responsible_barber_id)}</p>
                {card.service_id && <small className={styles.kanbanCardContext}>Serviço: {data.services.find((item) => item.id === card.service_id)?.name ?? "—"}</small>}
                <label className={styles.kanbanResponsible}><span>Mover para</span><select aria-label={`Mover ${card.title}`} value={card.board_id} onChange={(event) => { const destination = orderedBoards.find((item) => item.id === event.target.value); if (destination) moveCardToBoard(card, destination); }}>
                  {orderedBoards.map((destination) => <option key={destination.id} value={destination.id} disabled={!canReceive(destination)}>{destination.name}</option>)}
                </select></label>
                <div className={styles.toolbarGroup}>
                  <button className={`${styles.button} ${styles.buttonSoft}`} type="button" onClick={() => { const newTitle = window.prompt("Título do card", card.title); if (newTitle?.trim() && newTitle.trim() !== card.title) void mutateCard(card, "EDITED", undefined, newTitle); }}>Editar título</button>
                  <button className={styles.button} type="button" onClick={() => void mutateCard(card, "COMPLETED")}>Concluir</button>
                </div>
              </article>)}
              {cards.length === 0 && <p className={styles.kanbanEmpty}>Nenhum atendimento</p>}
            </section>;
          })}
        </div>
      </div>
    </Panel>

    {data.manager && showArchive && <Panel title="Cards concluídos" description="Cards arquivados podem ser consultados e reabertos pelo gestor.">
      {archivedCards.length === 0 ? <p>Nenhum card arquivado.</p> : <div className={styles.kanban}>{archivedCards.map((card) => <article key={card.id} className={styles.kanbanCard}>
        <small className={styles.kanbanCardContext}>{data.customers.find((item) => item.id === card.customer_id)?.full_name ?? "Card manual"}</small>
        <strong>{card.title}</strong>
        {card.description && <p className={styles.kanbanCardDescription}>{card.description}</p>}
        <small>{orderedBoards.find((board) => board.id === card.board_id)?.name ?? "Quadro"}</small>
        <button className={styles.button} type="button" onClick={() => void mutateCard(card, "REOPENED")}>Reabrir</button>
      </article>)}</div>}
    </Panel>}

    {data.manager && newBoardOpen && <ServiceKanbanDialog title="Adicionar quadro" onClose={() => setNewBoardOpen(false)}>
      <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void saveBoard(null, newBoardName, newBoardResponsible || null); }}>
        <label>Nome<input value={newBoardName} onChange={(event) => setNewBoardName(event.target.value)} minLength={2} maxLength={80} required autoFocus /></label>
        <label>Responsável (opcional)<select value={newBoardResponsible} onChange={(event) => setNewBoardResponsible(event.target.value)}><option value="">Não atribuído</option>{data.barbers.map((barber) => <option value={barber.id} key={barber.id}>{barber.display_name}</option>)}</select></label>
        <footer className={styles.modalActions}><button className={`${styles.button} ${styles.buttonSoft}`} type="button" onClick={() => setNewBoardOpen(false)}>Cancelar</button><button className={styles.button} type="submit"><Plus size={15} /> Adicionar quadro</button></footer>
      </form>
    </ServiceKanbanDialog>}

    {data.manager && createCardOpen && <ServiceKanbanDialog title="Criar card manual" wide onClose={() => setCreateCardOpen(false)}>
      <p className={styles.muted}>Cards manuais não geram cobrança ou comissão.</p>
      <form className={styles.form} onSubmit={(event) => void createCard(event)}>
        <Field label="Título"><input value={title} onChange={(event) => setTitle(event.target.value)} minLength={2} maxLength={160} required autoFocus placeholder="Ex.: Preparar fotos do cliente" /></Field>
        <Field label="Responsável"><select value={responsible} onChange={(event) => setResponsible(event.target.value)} required><option value="">Selecione</option>{data.barbers.map((barber) => <option value={barber.id} key={barber.id}>{barber.display_name}</option>)}</select></Field>
        <Field label="Cliente (opcional)"><select value={customer} onChange={(event) => setCustomer(event.target.value)}><option value="">Sem cliente</option>{data.customers.map((item) => <option value={item.id} key={item.id}>{item.full_name}</option>)}</select></Field>
        <Field label="Serviço (opcional)"><select value={service} onChange={(event) => setService(event.target.value)}><option value="">Sem serviço</option>{data.services.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></Field>
        <Field label="Descrição" wide><textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} placeholder="Detalhes para orientar a execução do card (opcional)." /></Field>
        <footer className={styles.modalActions}><button className={`${styles.button} ${styles.buttonSoft}`} type="button" onClick={() => setCreateCardOpen(false)}>Cancelar</button><button className={styles.button} type="submit"><Plus size={15} /> Criar card</button></footer>
      </form>
    </ServiceKanbanDialog>}
  </div>;
}

function ServiceKanbanDialog({ title, wide = false, onClose, children }: { title: string; wide?: boolean; onClose: () => void; children: ReactNode }) {
  const titleId = useId();
  return <div className={styles.modalLayer} role="presentation">
    <button className={styles.modalBackdrop} type="button" aria-label={`Fechar ${title}`} onClick={onClose} />
    <section className={`${styles.modal} ${wide ? styles.modalProjectWide : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <header className={styles.modalHeader}><div><small>Kanban de Atendimentos</small><h2 id={titleId}>{title}</h2></div><button className={styles.modalClose} type="button" aria-label="Fechar" onClick={onClose}><X size={18} /></button></header>
      {children}
    </section>
  </div>;
}

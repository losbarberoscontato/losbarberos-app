"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { assertResult, connectedClient, runMutation } from "@/components/connected-manager/mutation-utils";
import { ActionMessage, Panel } from "@/components/connected-manager/shared";
import type { ServiceKanbanData, ServiceKanbanBoard, ServiceKanbanCard } from "@/lib/service-kanban-server";
import styles from "@/components/connected-manager/connected-manager.module.css";

export function ServiceKanban({ data }: { data: ServiceKanbanData }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [showArchive, setShowArchive] = useState(false);
  const [title, setTitle] = useState("");
  const [responsible, setResponsible] = useState("");
  const [customer, setCustomer] = useState("");
  const [service, setService] = useState("");
  const [dragging, setDragging] = useState<string | null>(null);
  const [newBoardName, setNewBoardName] = useState("");
  const [newBoardResponsible, setNewBoardResponsible] = useState("");
  const professionalName = (id: string | null) => data.barbers.find((item) => item.id === id)?.display_name ?? "Profissional";

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
    const saved = await runMutation(setMessage, async () => {
      await assertResult(await connectedClient().rpc("save_service_kanban_board", {
        p_organization_id: data.organizationId, p_board_id: board?.id ?? null,
        p_name: name, p_responsible_barber_id: barberId,
      }));
    }, "Quadro salvo.");
    if (saved) { setNewBoardName(""); setNewBoardResponsible(""); router.refresh(); }
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

  async function createCard(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const saved = await runMutation(setMessage, async () => {
      await assertResult(await connectedClient().rpc("create_manual_service_kanban_card", {
        p_organization_id: data.organizationId, p_title: title.trim(),
        p_responsible_barber_id: responsible, p_customer_id: customer || null, p_service_id: service || null,
      }));
    }, "Card manual criado em Aguardando.");
    if (saved) { setTitle(""); setCustomer(""); setService(""); router.refresh(); }
  }

  if (!data.enabled) return <div className={styles.stack}><PageHeader title="Kanban" description="Ative o módulo em Configurações → Gerencia minha assinatura → Módulos." /></div>;
  const activeCards = data.cards.filter((card) => !card.archived_at);
  const archivedCards = data.cards.filter((card) => card.archived_at);

  return <div className={styles.stack}>
    <PageHeader title="Kanban" description="Esteira dos atendimentos de serviços, pacotes e assinaturas." />
    <ActionMessage message={message} />
    <Panel title="Quadro Kanban" description="Arraste os cards entre os quadros ou use o seletor de destino. Movimentos não alteram o atendimento.">
      <div className={styles.kanbanWorkspace}>
        <div className={styles.kanbanToolbar}>
          <div><h2>Atendimentos</h2><p>{activeCards.length} cards ativos</p></div>
          {data.manager && <button className={styles.button} type="button" onClick={() => setShowArchive((value) => !value)}>{showArchive ? "Ocultar arquivo" : `Arquivo (${archivedCards.length})`}</button>}
        </div>
        <div className={styles.kanban}>
          {data.boards.map((board) => {
            const cards = activeCards.filter((card) => card.board_id === board.id);
            return <section className={styles.kanbanLane} key={board.id} onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
              event.preventDefault();
              const card = data.cards.find((item) => item.id === dragging);
              setDragging(null);
              if (card && card.board_id !== board.id) void mutateCard(card, "MOVED", board.id);
            }}>
              <header><div className={styles.kanbanLaneTitle}><strong>{board.name}</strong></div><span>{cards.length}</span></header>
              {data.manager && board.system_key !== "WAITING" && <>
                <label className={styles.kanbanResponsible}><span>Responsável pelo quadro</span><select value={board.responsible_barber_id ?? ""} onChange={(event) => void saveBoard(board, board.name, event.target.value || null)}><option value="">Não atribuído</option>{data.barbers.map((barber) => <option value={barber.id} key={barber.id}>{barber.display_name}</option>)}</select></label>
                <div className={styles.toolbarGroup}><button type="button" onClick={() => { const name = window.prompt("Novo nome do quadro", board.name); if (name) void saveBoard(board, name, board.responsible_barber_id); }}>Renomear</button><button type="button" onClick={() => void deleteBoard(board)}>Excluir</button></div>
              </>}
              {board.system_key !== "WAITING" && !board.responsible_barber_id && <p className={styles.kanbanNote}>Atribua um responsável para receber cards.</p>}
              {cards.length === 0 && <p className={styles.kanbanEmpty}>Nenhum atendimento</p>}
              {cards.map((card) => <article className={styles.kanbanCard} key={card.id} draggable onDragStart={() => setDragging(card.id)} onDragEnd={() => setDragging(null)}>
                <small>{card.appointment_id ? "Atendimento" : "Card manual"}</small>
                <strong>{card.title}</strong>
                <small>Responsável: {professionalName(card.responsible_barber_id)}</small>
                {card.service_id && <small>Serviço: {data.services.find((item) => item.id === card.service_id)?.name ?? "—"}</small>}
                <label className={styles.kanbanResponsible}><span>Mover para</span><select value={card.board_id} onChange={(event) => void mutateCard(card, "MOVED", event.target.value)}>{data.boards.map((destination) => <option key={destination.id} value={destination.id} disabled={destination.system_key !== "WAITING" && !destination.responsible_barber_id}>{destination.name}</option>)}</select></label>
                <button className={styles.button} type="button" onClick={() => { const newTitle = window.prompt("Título do card", card.title); if (newTitle && newTitle.trim() !== card.title) void mutateCard(card, "EDITED", undefined, newTitle); }}>Editar título</button>
                <button className={styles.button} type="button" onClick={() => void mutateCard(card, "COMPLETED")}>Concluir</button>
              </article>)}
            </section>;
          })}
        </div>
      </div>
    </Panel>
    {data.manager && <Panel title="Adicionar quadro" description="O quadro pode nascer sem responsável. Atribua um profissional antes de mover cards para ele.">
      <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void saveBoard(null, newBoardName, newBoardResponsible || null); }}>
        <label>Nome<input value={newBoardName} onChange={(event) => setNewBoardName(event.target.value)} minLength={2} maxLength={80} required /></label>
        <label>Responsável (opcional)<select value={newBoardResponsible} onChange={(event) => setNewBoardResponsible(event.target.value)}><option value="">Não atribuído</option>{data.barbers.map((barber) => <option value={barber.id} key={barber.id}>{barber.display_name}</option>)}</select></label>
        <button className={styles.button} type="submit">Adicionar quadro</button>
      </form>
    </Panel>}
    {data.manager && <Panel title="Criar card manual" description="Cards manuais não geram cobrança ou comissão.">
      <form className={styles.form} onSubmit={(event) => void createCard(event)}>
        <label>Título<input value={title} onChange={(event) => setTitle(event.target.value)} minLength={2} maxLength={160} required /></label>
        <label>Responsável<select value={responsible} onChange={(event) => setResponsible(event.target.value)} required><option value="">Selecione</option>{data.barbers.map((barber) => <option value={barber.id} key={barber.id}>{barber.display_name}</option>)}</select></label>
        <label>Cliente (opcional)<select value={customer} onChange={(event) => setCustomer(event.target.value)}><option value="">Sem cliente</option>{data.customers.map((item) => <option value={item.id} key={item.id}>{item.full_name}</option>)}</select></label>
        <label>Serviço (opcional)<select value={service} onChange={(event) => setService(event.target.value)}><option value="">Sem serviço</option>{data.services.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
        <button className={styles.button} type="submit">Criar card</button>
      </form>
    </Panel>}
    {data.manager && showArchive && <Panel title="Cards concluídos" description="O gestor pode consultar e reabrir cards arquivados.">
      {archivedCards.length === 0 ? <p>Nenhum card arquivado.</p> : archivedCards.map((card) => <div key={card.id} className={styles.kanbanCard}><strong>{card.title}</strong><small>{data.boards.find((board) => board.id === card.board_id)?.name ?? "Quadro"}</small><button className={styles.button} type="button" onClick={() => void mutateCard(card, "REOPENED")}>Reabrir</button></div>)}
    </Panel>}
  </div>;
}

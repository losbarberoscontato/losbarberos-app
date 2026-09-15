"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, BriefcaseBusiness, CalendarDays, CheckCircle2, CircleDollarSign, LayoutDashboard, Plus, Users, X } from "lucide-react";
import { PageHeader } from "@/components/ui";
import type { ProjectsPageData } from "./projects-server";
import { centsFromInput, formatCents } from "./format";
import { ActionMessage, EmptyState, Field, Panel, StatusChip } from "./shared";
import { assertResult, connectedClient, runMutation } from "./mutation-utils";
import styles from "./connected-manager.module.css";

type Props = ProjectsPageData;
type ProjectTab = "overview" | "engagements" | "kanban" | "finance";

const projectStatusLabels: Record<string, string> = { DRAFT: "Rascunho", PUBLISHED: "Publicado", PAUSED: "Pausado", CLOSED: "Encerrado" };
const engagementStatusLabels: Record<string, string> = { PROPOSAL: "Proposta", ACTIVE: "Ativa", COMPLETED: "Concluída", CANCELED: "Cancelada" };

function dateLabel(value: string | null) {
  if (!value) return "Sem data";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(new Date(`${value}T12:00:00`));
}

function parseOptionalInt(value: string) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function ProjectsManager(props: Props) {
  const router = useRouter();
  const [selectedProjectId, setSelectedProjectId] = useState(props.projects[0]?.id ?? "");
  const [tab, setTab] = useState<ProjectTab>("overview");
  const [message, setMessage] = useState("");
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newEngagementOpen, setNewEngagementOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [projectStartsOn, setProjectStartsOn] = useState("");
  const [projectSalesCloseOn, setProjectSalesCloseOn] = useState("");
  const [projectEndsOn, setProjectEndsOn] = useState("");
  const [projectGoal, setProjectGoal] = useState("10");
  const [packageName, setPackageName] = useState("Experiência");
  const [packageDescription, setPackageDescription] = useState("");
  const [packagePrice, setPackagePrice] = useState("1.550,00");
  const [packageSessions, setPackageSessions] = useState("3");
  const [engagementCustomerId, setEngagementCustomerId] = useState(props.customers[0]?.id ?? "");
  const [engagementPackageId, setEngagementPackageId] = useState("");
  const [engagementPrice, setEngagementPrice] = useState("");

  const selectedProject = props.projects.find((project) => project.id === selectedProjectId) ?? props.projects[0] ?? null;
  const projectPackages = useMemo(() => props.packages.filter((item) => item.project_id === selectedProject?.id && item.active), [props.packages, selectedProject?.id]);
  const projectSteps = useMemo(() => props.steps.filter((item) => item.project_id === selectedProject?.id && item.active), [props.steps, selectedProject?.id]);
  const projectEngagements = useMemo(() => props.engagements.filter((item) => item.project_id === selectedProject?.id), [props.engagements, selectedProject?.id]);
  const customerById = useMemo(() => new Map(props.customers.map((customer) => [customer.id, customer])), [props.customers]);
  const packageById = useMemo(() => new Map(props.packages.map((item) => [item.id, item])), [props.packages]);
  const activeEngagements = projectEngagements.filter((item) => item.status === "ACTIVE").length;
  const contractedCents = projectEngagements.filter((item) => item.status !== "CANCELED").reduce((sum, item) => sum + item.contracted_cents, 0);
  const acceptedCents = projectEngagements.filter((item) => item.status === "ACTIVE" || item.status === "COMPLETED").reduce((sum, item) => sum + item.contracted_cents, 0);

  function selectProject(id: string) {
    setSelectedProjectId(id);
    setTab("overview");
  }

  async function createProject() {
    if (saving) return;
    setSaving(true);
    const saved = await runMutation(setMessage, async () => {
      await assertResult(await connectedClient().rpc("create_project_with_initial_package", {
        p_organization_id: props.organizationId,
        p_name: projectName,
        p_description: projectDescription,
        p_starts_on: projectStartsOn || null,
        p_sales_close_on: projectSalesCloseOn || null,
        p_ends_on: projectEndsOn || null,
        p_goal_contracts: parseOptionalInt(projectGoal),
        p_package_name: packageName,
        p_package_description: packageDescription,
        p_package_price_cents: centsFromInput(packagePrice),
        p_package_sessions_count: parseOptionalInt(packageSessions) ?? 1,
      }));
    }, "Projeto criado e publicado.");
    setSaving(false);
    if (saved) {
      setNewProjectOpen(false);
      setProjectName("");
      setProjectDescription("");
      router.refresh();
    }
  }

  async function createEngagement() {
    if (!selectedProject || saving || !engagementCustomerId || !engagementPackageId) return;
    setSaving(true);
    const client = connectedClient();
    const { data: userData, error: userError } = await client.auth.getUser();
    const saved = await runMutation(setMessage, async () => {
      if (userError || !userData.user) throw new Error("Sessão expirada. Entre novamente para criar uma contratação.");
      await assertResult(await client.from("project_engagements").insert({
        organization_id: props.organizationId,
        project_id: selectedProject.id,
        customer_id: engagementCustomerId,
        package_id: engagementPackageId,
        status: "PROPOSAL",
        contracted_cents: centsFromInput(engagementPrice || "0"),
        proposal_sent_at: new Date().toISOString(),
        created_by: userData.user.id,
      }));
    }, "Proposta criada e pronta para envio.");
    setSaving(false);
    if (saved) {
      setNewEngagementOpen(false);
      setEngagementPrice("");
      router.refresh();
    }
  }

  function openEngagementModal() {
    const firstPackage = projectPackages[0];
    setEngagementPackageId(firstPackage?.id ?? "");
    setEngagementPrice(firstPackage ? (firstPackage.price_cents / 100).toFixed(2).replace(".", ",") : "");
    setNewEngagementOpen(true);
  }

  return <div className={styles.stack}>
    <PageHeader
      title="Projetos"
      description="Ofertas com prazo, pacotes, contratações e execução acompanhada em uma única jornada."
      actions={<div className={styles.toolbarGroup}><button className={`${styles.button} ${styles.buttonSoft}`} type="button"><LayoutDashboard size={16} /> Quadro geral</button><button className={styles.button} type="button" onClick={() => setNewProjectOpen(true)}><Plus size={16} /> Novo projeto</button></div>}
    />
    <ActionMessage message={message} />

    <section className={styles.projectStats} aria-label="Resumo de projetos">
      <article><span>Projetos publicados</span><strong>{props.projects.filter((item) => item.status === "PUBLISHED").length}</strong><small>{props.projects.length} no total</small></article>
      <article><span>Contratações ativas</span><strong>{props.engagements.filter((item) => item.status === "ACTIVE").length}</strong><small>{props.engagements.filter((item) => item.status === "PROPOSAL").length} propostas aguardando aceite</small></article>
      <article><span>Valor contratado</span><strong>{formatCents(props.engagements.reduce((sum, item) => sum + (item.status === "CANCELED" ? 0 : item.contracted_cents), 0))}</strong><small>Contratos e propostas válidos</small></article>
      <article><span>Resultado do módulo</span><strong>{formatCents(acceptedCents)}</strong><small>Contratações aceitas, sem duplicar sessões</small></article>
    </section>

    {props.projects.length === 0 ? <Panel title="Comece pelo primeiro projeto" description="Crie uma oferta comercial com prazo, pacote inicial e etapas padrão."><EmptyState title="Nenhum projeto criado" action={<button className={styles.button} type="button" onClick={() => setNewProjectOpen(true)}><Plus size={16} /> Criar projeto</button>}>O projeto é a oferta reutilizável. A contratação será criada depois para cada cliente.</EmptyState></Panel> : <>
      <div className={styles.projectLayout}>
        <Panel title="Projetos em andamento" description="Selecione um projeto para abrir o painel operacional.">
          <div className={styles.projectList}>
            {props.projects.map((project) => {
              const count = props.engagements.filter((item) => item.project_id === project.id && item.status !== "CANCELED").length;
              return <button type="button" key={project.id} className={`${styles.projectCard} ${selectedProject?.id === project.id ? styles.projectCardActive : ""}`} onClick={() => selectProject(project.id)}>
                <span className={styles.projectCardIcon}><BriefcaseBusiness size={17} /></span><span className={styles.rowTitle}><strong>{project.name}</strong><small>{dateLabel(project.starts_on)} — {dateLabel(project.ends_on)}</small></span><span className={styles.projectCardMeta}><strong>{count}{project.goal_contracts ? ` / ${project.goal_contracts}` : ""}</strong><small>contratações</small></span><StatusChip active={project.status === "PUBLISHED"} label={projectStatusLabels[project.status]} tone={project.status === "PAUSED" ? "warning" : project.status === "CLOSED" ? "neutral" : undefined} /><ArrowRight size={16} /></button>;
            })}
          </div>
        </Panel>

        {selectedProject && <section className={styles.projectDetail} aria-label={`Detalhes de ${selectedProject.name}`}>
          <header className={styles.projectDetailHeader}><div><p className="eyebrow">Projeto selecionado</p><h2>{selectedProject.name}</h2><p>{selectedProject.description || "Oferta comercial com etapas acompanhadas e aceite por contratação."}</p></div><div className={styles.toolbarGroup}><StatusChip active={selectedProject.status === "PUBLISHED"} label={projectStatusLabels[selectedProject.status]} /><button className={`${styles.button} ${styles.buttonSoft}`} type="button" onClick={openEngagementModal}><Plus size={16} /> Nova proposta</button></div></header>
          <nav className={styles.tabs} aria-label="Seções do projeto">{([ ["overview", "Visão geral", LayoutDashboard], ["engagements", "Contratações", Users], ["kanban", "Kanban", CheckCircle2], ["finance", "Financeiro", CircleDollarSign] ] as const).map(([value, label, Icon]) => <button type="button" key={value} className={`${styles.tab} ${tab === value ? styles.tabActive : ""}`} onClick={() => setTab(value)}><Icon size={15} /> {label}</button>)}</nav>
          {tab === "overview" && <ProjectOverview activeEngagements={activeEngagements} contractedCents={contractedCents} acceptedCents={acceptedCents} projectPackages={projectPackages} projectSteps={projectSteps} engagements={projectEngagements} />}
          {tab === "engagements" && <EngagementsTable engagements={projectEngagements} customerById={customerById} packageById={packageById} />}
          {tab === "kanban" && <ProjectKanban engagements={projectEngagements} customerById={customerById} />}
          {tab === "finance" && <ProjectFinance contractedCents={contractedCents} acceptedCents={acceptedCents} installments={props.installments.filter((item) => projectEngagements.some((engagement) => engagement.id === item.engagement_id))} />}
        </section>}
      </div>
    </>}

    {newProjectOpen && <Modal title="Novo projeto" onClose={() => setNewProjectOpen(false)}>
      <div className={styles.form}><Field label="Nome do projeto" wide><input value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="Ex.: Visagismo 2026" autoFocus /></Field><Field label="Descrição" wide><textarea value={projectDescription} onChange={(event) => setProjectDescription(event.target.value)} placeholder="O que a jornada entrega para o cliente?" /></Field><Field label="Início"><input type="date" value={projectStartsOn} onChange={(event) => setProjectStartsOn(event.target.value)} /></Field><Field label="Fim"><input type="date" value={projectEndsOn} onChange={(event) => setProjectEndsOn(event.target.value)} /></Field><Field label="Encerrar novas vendas em"><input type="date" value={projectSalesCloseOn} onChange={(event) => setProjectSalesCloseOn(event.target.value)} /></Field><Field label="Meta de contratações"><input type="number" min="1" value={projectGoal} onChange={(event) => setProjectGoal(event.target.value)} /></Field><Field label="Pacote inicial" wide><input value={packageName} onChange={(event) => setPackageName(event.target.value)} /></Field><Field label="Valor praticado"><input inputMode="decimal" value={packagePrice} onChange={(event) => setPackagePrice(event.target.value)} /></Field><Field label="Quantidade de sessões"><input type="number" min="1" value={packageSessions} onChange={(event) => setPackageSessions(event.target.value)} /></Field><Field label="Descrição do pacote" wide><input value={packageDescription} onChange={(event) => setPackageDescription(event.target.value)} placeholder="Inclui planejamento, execução e revisão" /></Field></div><footer className={styles.modalActions}><button className={`${styles.button} ${styles.buttonSoft}`} type="button" onClick={() => setNewProjectOpen(false)}>Cancelar</button><button className={styles.button} type="button" disabled={saving || !projectName.trim()} onClick={() => void createProject()}>{saving ? "Criando…" : "Criar e publicar"}</button></footer>
    </Modal>}
    {newEngagementOpen && selectedProject && <Modal title="Nova proposta" onClose={() => setNewEngagementOpen(false)}><div className={styles.form}><Field label="Cliente" wide><select value={engagementCustomerId} onChange={(event) => setEngagementCustomerId(event.target.value)}><option value="">Selecione um cliente</option>{props.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.full_name}</option>)}</select></Field><Field label="Pacote"><select value={engagementPackageId} onChange={(event) => { const packageId = event.target.value; setEngagementPackageId(packageId); const selected = projectPackages.find((item) => item.id === packageId); if (selected) setEngagementPrice((selected.price_cents / 100).toFixed(2).replace(".", ",")); }}>{projectPackages.map((item) => <option key={item.id} value={item.id}>{item.name} · {formatCents(item.price_cents)}</option>)}</select></Field><Field label="Preço praticado"><input inputMode="decimal" value={engagementPrice} onChange={(event) => setEngagementPrice(event.target.value)} /></Field></div><p className={styles.muted}>A proposta fica pendente de ciência do cliente. O valor é congelado na contratação e as sessões do projeto não geram cobrança duplicada.</p><footer className={styles.modalActions}><button className={`${styles.button} ${styles.buttonSoft}`} type="button" onClick={() => setNewEngagementOpen(false)}>Cancelar</button><button className={styles.button} type="button" disabled={saving || !engagementCustomerId || !engagementPackageId} onClick={() => void createEngagement()}>{saving ? "Salvando…" : "Criar proposta"}</button></footer></Modal>}
  </div>;
}

function ProjectOverview({ activeEngagements, contractedCents, acceptedCents, projectPackages, projectSteps, engagements }: { activeEngagements: number; contractedCents: number; acceptedCents: number; projectPackages: Props["packages"]; projectSteps: Props["steps"]; engagements: Props["engagements"] }) {
  return <div className={styles.stack}><div className={styles.projectStats}><article><span>Ativas</span><strong>{activeEngagements}</strong><small>contratações em execução</small></article><article><span>Contratado</span><strong>{formatCents(contractedCents)}</strong><small>propostas e contratos válidos</small></article><article><span>Aceito</span><strong>{formatCents(acceptedCents)}</strong><small>base para resultado realizado</small></article></div><div className={styles.projectColumns}><Panel title="Pacotes publicados" description="O cliente escolhe um pacote na proposta.">{projectPackages.length ? <div className={styles.list}>{projectPackages.map((item) => <div className={styles.row} key={item.id}><span className={styles.rowTitle}><strong>{item.name}</strong><small>{item.sessions_count} sessões · {item.description || "Sem descrição"}</small></span><strong>{formatCents(item.price_cents)}</strong><StatusChip active={item.active} label={item.active ? "Publicado" : "Pausado"} /></div>)}</div> : <EmptyState title="Sem pacotes">Adicione um pacote para vender o projeto.</EmptyState>}</Panel><Panel title="Etapas da jornada" description="Cada contratação percorre estas etapas.">{projectSteps.length ? <ol className={styles.stepList}>{projectSteps.map((step) => <li key={step.id}><span>{step.position}</span><div><strong>{step.name}</strong><small>{step.kind === "SERVICE" ? "Serviço vinculado" : "Etapa interna"}</small></div></li>)}</ol> : <EmptyState title="Sem etapas">Configure o primeiro fluxo do projeto.</EmptyState>}</Panel></div><Panel title="Últimas movimentações" description="Acompanhe o avanço sem expor notas internas ao cliente.">{engagements.length ? <div className={styles.list}>{engagements.slice(0, 4).map((item) => <div className={styles.row} key={item.id}><span>{engagementStatusLabels[item.status]}</span><strong>{formatCents(item.contracted_cents)}</strong><small>{dateLabel(item.created_at.slice(0, 10))}</small></div>)}</div> : <EmptyState title="Nenhuma contratação">Crie uma proposta para iniciar a jornada.</EmptyState>}</Panel></div>;
}

function EngagementsTable({ engagements, customerById, packageById }: { engagements: Props["engagements"]; customerById: Map<string, Props["customers"][number]>; packageById: Map<string, Props["packages"][number]> }) {
  return <Panel title="Contratações" description="Uma contratação por cliente. Propostas continuam fora do fluxo ativo até o aceite.">{engagements.length ? <div className={styles.engagementList}>{engagements.map((item) => <div className={styles.engagementRow} key={item.id}><span className={styles.avatar}>{(customerById.get(item.customer_id)?.full_name ?? "CL").split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><span className={styles.rowTitle}><strong>{customerById.get(item.customer_id)?.full_name ?? "Cliente"}</strong><small>{packageById.get(item.package_id)?.name ?? "Pacote"}</small></span><strong>{formatCents(item.contracted_cents)}</strong><StatusChip active={item.status === "ACTIVE" || item.status === "COMPLETED"} label={engagementStatusLabels[item.status]} tone={item.status === "PROPOSAL" ? "warning" : item.status === "CANCELED" ? "danger" : undefined} /><small>{dateLabel((item.accepted_at ?? item.created_at).slice(0, 10))}</small></div>)}</div> : <EmptyState title="Sem contratações">Use “Nova proposta” para criar a primeira contratação.</EmptyState>}</Panel>;
}

function ProjectKanban({ engagements, customerById }: { engagements: Props["engagements"]; customerById: Map<string, Props["customers"][number]> }) {
  const lanes = [["PROPOSAL", "Aguardando aceite"], ["ACTIVE", "Em execução"], ["COMPLETED", "Concluídas"], ["CANCELED", "Canceladas"]] as const;
  return <div className={styles.kanban}>{lanes.map(([status, label]) => <section className={styles.kanbanLane} key={status}><header><strong>{label}</strong><span>{engagements.filter((item) => item.status === status).length}</span></header>{engagements.filter((item) => item.status === status).map((item) => <article className={styles.kanbanCard} key={item.id}><small>Contratação</small><strong>{customerById.get(item.customer_id)?.full_name ?? "Cliente"}</strong><span>{formatCents(item.contracted_cents)}</span><small>{status === "PROPOSAL" ? "Aguardando ciência do cliente" : "Próxima etapa no fluxo"}</small></article>)}{engagements.every((item) => item.status !== status) && <p className={styles.kanbanEmpty}>Nenhuma contratação</p>}</section>)}</div>;
}

function ProjectFinance({ contractedCents, acceptedCents, installments }: { contractedCents: number; acceptedCents: number; installments: Props["installments"] }) {
  const openCents = installments.filter((item) => item.status === "OPEN").reduce((sum, item) => sum + item.amount_cents, 0);
  return <div className={styles.projectColumns}><Panel title="Resultado do projeto" description="Valores do módulo separados das sessões avulsas."><div className={styles.financeRows}><div><span>Valor contratado</span><strong>{formatCents(contractedCents)}</strong></div><div><span>Aceito</span><strong>{formatCents(acceptedCents)}</strong></div><div><span>Parcelas abertas</span><strong>{formatCents(openCents)}</strong></div></div><p className={styles.muted}>Custos e comissões entram no financeiro quando as etapas forem aprovadas. “Resultado” não é lucro líquido contábil.</p></Panel><Panel title="Parcelas" description="A cobrança do projeto usa o cronograma da contratação.">{installments.length ? <div className={styles.list}>{installments.map((item) => <div className={styles.row} key={item.id}><span>{dateLabel(item.due_on)}</span><strong>{formatCents(item.amount_cents)}</strong><StatusChip active={item.status === "PAID"} label={item.status === "PAID" ? "Recebida" : item.status === "CANCELED" ? "Cancelada" : "Em aberto"} tone={item.status === "OPEN" ? "warning" : item.status === "CANCELED" ? "danger" : undefined} /></div>)}</div> : <EmptyState title="Nenhuma parcela criada">O cronograma será preenchido na proposta.</EmptyState>}</Panel></div>;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <div className={styles.modalLayer} role="presentation"><button className={styles.modalBackdrop} type="button" aria-label={`Fechar ${title}`} onClick={onClose} /><section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="projects-modal-title"><header className={styles.modalHeader}><div><small>Módulo Projetos</small><h2 id="projects-modal-title">{title}</h2></div><button className={styles.modalClose} type="button" aria-label="Fechar" onClick={onClose}><X size={18} /></button></header>{children}</section></div>;
}

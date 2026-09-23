"use client";

import { useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, BriefcaseBusiness, Calculator, CalendarDays, Check, CheckCircle2, ChevronRight, CircleDollarSign, Clock3, Landmark, LayoutDashboard, Pencil, Plus, Save, Trash2, UserRound, Users, X } from "lucide-react";
import { PageHeader } from "@/components/ui";
import type { ProjectCostItemRecord, ProjectEngagementCommentPreview, ProjectEngagementInternalServiceRecord, ProjectKanbanBoardRecord, ProjectKanbanInternalCardRecord, ProjectKanbanSectorRecord, ProjectsPageData } from "./projects-server";
import type { ChartAccountRecord, CostCenterRecord, FinancialAccountRecord, FinancialTagRecord } from "./types";
import { centsFromInput, formatCents, humanizeError } from "./format";
import { ActionMessage, EmptyState, Field, Panel, StatusChip } from "./shared";
import { assertResult, connectedClient, runMutation } from "./mutation-utils";
import { normalizePhoneE164 } from "@/lib/phone";
import { formatCpfCnpj } from "@/lib/cpf-cnpj";
import styles from "./connected-manager.module.css";

type Props = ProjectsPageData;
type ManagerProps = Omit<Props, "projectBarbers" | "packageServiceAssignments" | "barberServices" | "kanbanSectors" | "engagementLastComments" | "financialAccounts" | "chartAccounts" | "costCenters" | "tags" | "projectSessions" | "projectCommissions" | "projectEngagementLinks" | "environments" | "internalServices" | "internalCards"> & { projectBarbers?: Props["projectBarbers"]; packageServiceAssignments?: Props["packageServiceAssignments"]; barberServices?: Props["barberServices"]; kanbanSectors?: Props["kanbanSectors"]; engagementLastComments?: Props["engagementLastComments"]; projectSessions?: Props["projectSessions"]; projectCommissions?: Props["projectCommissions"]; projectEngagementLinks?: Props["projectEngagementLinks"]; environments?: Props["environments"]; internalServices?: Props["internalServices"]; internalCards?: Props["internalCards"]; projectId?: string; financialAccounts?: FinancialAccountRecord[]; chartAccounts?: ChartAccountRecord[]; costCenters?: CostCenterRecord[]; tags?: FinancialTagRecord[] };
type ProjectTab = "overview" | "investments" | "packages" | "engagements" | "kanban" | "finance";
type ProjectFilter = "published" | "archived" | "all";
type CostKind = Exclude<ProjectCostItemRecord["kind"], "VARIABLE">;
type EngagementScheduleRow = { installment_number: number; due_on: string; amount_cents: number };
type PackageServiceAssignment = { service_id: string; barber_id: string; commission_cents: number };
type BookingEnvironmentOption = { id: string; name: string; sort_order: number };
type PackageDraft = {
  id: string | null;
  name: string;
  description: string;
  durationMinutes: string;
  sessionsCount: string;
  fixedCostPerHour: string;
  extraCosts: string;
  extraCostsDescription: string;
  taxRate: string;
  cardRate: string;
  profitMargin: string;
  deposit: string;
  practicedPrice: string;
  serviceAssignments: PackageServiceAssignment[];
};
type KanbanBoardDraft = ProjectKanbanBoardRecord;

const projectStatusLabels: Record<string, string> = { DRAFT: "Rascunho", PUBLISHED: "Publicado", PAUSED: "Pausado", CLOSED: "Encerrado", ARCHIVED: "Arquivado" };
type ProjectEventComment = {
  id: string;
  organization_id: string;
  project_id: string;
  engagement_id: string;
  body: string;
  author_name: string;
  created_at: string;
  updated_at: string;
};
type EventDueDateOverride = { fromDueOn: string | null; dueOn: string | null; boardId: string | null; receivedAt: string | null };
type EventDueDateOverrides = Record<string, EventDueDateOverride>;

const projectSessionStatusLabels: Record<string, string> = { OPEN: "Disponível", BOOKED: "Agendado", COMPLETED: "Concluído", CANCELED: "Cancelado após o prazo" };
const projectAppointmentStatusLabels: Record<string, string> = { CONFIRMED: "Agendado", IN_SERVICE: "Em serviço", COMPLETED: "Concluído", CANCELED: "Cancelado" };

function eventWithDueDateOverride<T extends Props["engagements"][number]>(engagement: T, overrides: EventDueDateOverrides): T {
  const override = overrides[engagement.id];
  if (!override || (engagement.event_due_on ?? null) !== override.fromDueOn || (engagement.kanban_board_id ?? null) !== override.boardId || (engagement.kanban_received_at ?? null) !== override.receivedAt) return engagement;
  return { ...engagement, event_due_on: override.dueOn };
}

function dateLabel(value: string | null) {
  if (!value) return "Sem data";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(new Date(`${value}T12:00:00`));
}

function shortDateLabel(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(`${value}T12:00:00`));
}

function dateTimeLabel(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function localTodayInputValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function localTomorrowInputValue() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
}

function externalLink(value: string) {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function parseOptionalInt(value: string) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function centsInput(value: number) {
  return (value / 100).toFixed(2).replace(".", ",");
}

function draftInstallment(row: EngagementScheduleRow, id: string, organizationId: string): Props["installments"][number] {
  return { id, organization_id: organizationId, engagement_id: "", installment_number: row.installment_number, due_on: row.due_on, amount_cents: row.amount_cents, status: "OPEN", paid_at: null, financial_entry_id: null, settled_cents: 0, remaining_cents: row.amount_cents, last_paid_at: null, payment_method: null, financial_account_id: null, financial_account_name: null, received_by: null, received_by_name: null };
}

function packageDraftFromRecord(item: Props["packages"][number]): PackageDraft {
  return {
    id: item.id,
    name: item.name,
    description: item.description ?? "",
    durationMinutes: String(item.duration_minutes ?? 60),
    sessionsCount: String(item.sessions_count ?? 1),
    fixedCostPerHour: centsInput(item.fixed_cost_per_hour_cents ?? 0),
    extraCosts: centsInput(item.extra_costs_cents ?? 0),
    extraCostsDescription: item.extra_costs_description ?? "",
    // These are rendered by <input type="number">; keep its required decimal-dot format.
    taxRate: String((item.tax_rate_bps ?? 0) / 100),
    cardRate: String((item.card_rate_bps ?? 0) / 100),
    profitMargin: String((item.profit_margin_bps ?? 5000) / 100),
    deposit: centsInput(item.deposit_cents ?? 0),
    practicedPrice: centsInput(item.price_cents ?? 0),
    serviceAssignments: [],
  };
}

function emptyPackageDraft(): PackageDraft {
  return { id: null, name: "", description: "", durationMinutes: "60", sessionsCount: "1", fixedCostPerHour: "0,00", extraCosts: "0,00", extraCostsDescription: "", taxRate: "0", cardRate: "0", profitMargin: "50", deposit: "0,00", practicedPrice: "0,00", serviceAssignments: [] };
}

function initialPackageDrafts(props: ManagerProps): PackageDraft[] {
  if (!props.projectId) return [];
  return props.packages.filter((item) => item.project_id === props.projectId && item.active).map((item) => ({
    ...packageDraftFromRecord(item),
    serviceAssignments: (props.packageServiceAssignments ?? []).filter((link) => link.project_package_id === item.id).map(({ service_id, barber_id, commission_cents }) => ({ service_id, barber_id, commission_cents })),
  }));
}

function percentToBps(value: string) {
  const numeric = Number(value.trim().replace(",", "."));
  if (!Number.isFinite(numeric) || numeric < 0) return 0;
  return Math.round(numeric * 100);
}

function safeCentsInput(value: string) {
  try {
    return centsFromInput(value || "0");
  } catch {
    return 0;
  }
}

function projectAllocationPerContract(items: ProjectCostItemRecord[], goalContracts: number | null) {
  if (!goalContracts || goalContracts <= 0) return 0;
  const total = items.filter((item) => item.active && (item.kind === "FIXED" || item.kind === "INVESTMENT")).reduce((sum, item) => sum + item.amount_cents, 0);
  return Math.round(total / goalContracts);
}

function packagePricing(draft: PackageDraft, allocationPerSessionCents = safeCentsInput(draft.fixedCostPerHour)) {
  const duration = Number.parseInt(draft.durationMinutes, 10) || 0;
  const sessions = Number.parseInt(draft.sessionsCount, 10) || 0;
  const fixedCost = allocationPerSessionCents;
  const extraCosts = safeCentsInput(draft.extraCosts);
  const commissionCosts = draft.serviceAssignments.reduce((sum, assignment) => sum + assignment.commission_cents, 0);
  const taxRate = percentToBps(draft.taxRate);
  const cardRate = percentToBps(draft.cardRate);
  const profitMargin = percentToBps(draft.profitMargin);
  const fixedCostTotal = fixedCost * sessions;
  const costTotal = fixedCostTotal + extraCosts + commissionCosts;
  const denominator = 1 - (taxRate + cardRate + profitMargin) / 10000;
  const suggested = denominator > 0 ? Math.max(0, Math.round(costTotal / denominator)) : 0;
  const practiced = safeCentsInput(draft.practicedPrice);
  const taxAmount = Math.round(practiced * taxRate / 10000);
  const cardAmount = Math.round(practiced * cardRate / 10000);
  const profit = practiced - costTotal - taxAmount - cardAmount;
  const difference = practiced - suggested;
  const differencePercent = suggested > 0 ? (difference / suggested) * 100 : null;
  return { duration, sessions, fixedCost, fixedCostTotal, extraCosts, commissionCosts, taxRate, cardRate, profitMargin, costTotal, suggested, practiced, taxAmount, cardAmount, profit, difference, differencePercent, warning: differencePercent !== null && differencePercent < -10, denominatorValid: denominator > 0 };
}

function packagePriceShare(amountCents: number, practicedCents: number) {
  if (practicedCents <= 0) return "(—)";
  return `(${((amountCents / practicedCents) * 100).toFixed(2).replace(".", ",")}%)`;
}

export function ProjectsManager(props: ManagerProps) {
  const router = useRouter();
  const projectSessionsData = useMemo(() => props.projectSessions ?? [], [props.projectSessions]);
  const projectCommissionsData = useMemo(() => props.projectCommissions ?? [], [props.projectCommissions]);
  const [tab, setTab] = useState<ProjectTab>("overview");
  const [message, setMessage] = useState("");
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [projectFilter, setProjectFilter] = useState<ProjectFilter>("published");
  const [newEngagementOpen, setNewEngagementOpen] = useState(false);
  const [editingEngagementId, setEditingEngagementId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [projectStartsOn, setProjectStartsOn] = useState("");
  const [projectSalesCloseOn, setProjectSalesCloseOn] = useState("");
  const [projectEndsOn, setProjectEndsOn] = useState("");
  const [projectGoal, setProjectGoal] = useState("10");
  const [projectBarberIds, setProjectBarberIds] = useState<string[]>([]);
  const [engagementCustomerId, setEngagementCustomerId] = useState("");
  const [engagementCustomerQuery, setEngagementCustomerQuery] = useState("");
  const [createdEngagementCustomers, setCreatedEngagementCustomers] = useState<Props["customers"]>([]);
  const [newEngagementCustomerOpen, setNewEngagementCustomerOpen] = useState(false);
  const [newEngagementCustomerSaving, setNewEngagementCustomerSaving] = useState(false);
  const [newEngagementCustomerMessage, setNewEngagementCustomerMessage] = useState("");
  const [newEngagementCustomerName, setNewEngagementCustomerName] = useState("");
  const [newEngagementCustomerPhone, setNewEngagementCustomerPhone] = useState("");
  const [newEngagementCustomerEmail, setNewEngagementCustomerEmail] = useState("");
  const [newEngagementCustomerBirthDate, setNewEngagementCustomerBirthDate] = useState("");
  const [newEngagementCustomerNotes, setNewEngagementCustomerNotes] = useState("");
  const [newEngagementCustomerCpfCnpj, setNewEngagementCustomerCpfCnpj] = useState("");
  const [newEngagementDependentName, setNewEngagementDependentName] = useState("");
  const [newEngagementDependentBirthDate, setNewEngagementDependentBirthDate] = useState("");
  const [newEngagementDependentRelationship, setNewEngagementDependentRelationship] = useState("CHILD");
  const [engagementPackageId, setEngagementPackageId] = useState("");
  const [engagementPrice, setEngagementPrice] = useState("");
  const [engagementEntry, setEngagementEntry] = useState("0,00");
  const [engagementInstallments, setEngagementInstallments] = useState("1");
  const [engagementEntryDueOn, setEngagementEntryDueOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [engagementFirstDueOn, setEngagementFirstDueOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [engagementStatus, setEngagementStatus] = useState<"PROPOSAL" | "ACTIVE" | "COMPLETED">("PROPOSAL");
  const [signingDate, setSigningDate] = useState("");
  const [generatedEngagementSchedule, setGeneratedEngagementSchedule] = useState<EngagementScheduleRow[] | null>(null);
  const [receivingInstallment, setReceivingInstallment] = useState<Props["installments"][number] | null>(null);
  const [editingInstallment, setEditingInstallment] = useState<Props["installments"][number] | null>(null);
  const [eventEditorEngagementId, setEventEditorEngagementId] = useState<string | null>(null);
  const [eventEditorEngagement, setEventEditorEngagement] = useState<Props["engagements"][number] | null>(null);
  const [eventDescription, setEventDescription] = useState("");
  const [eventLink1, setEventLink1] = useState("");
  const [eventLink2, setEventLink2] = useState("");
  const [eventLink3, setEventLink3] = useState("");
  const [eventLinkTitle1, setEventLinkTitle1] = useState("Link 1");
  const [eventLinkTitle2, setEventLinkTitle2] = useState("Link 2");
  const [eventLinkTitle3, setEventLinkTitle3] = useState("Link 3");
  const [eventDueOn, setEventDueOn] = useState("");
  const [eventDueDateOverrides, setEventDueDateOverrides] = useState<EventDueDateOverrides>({});
  const [eventComments, setEventComments] = useState<ProjectEventComment[]>([]);
  const [eventCommentsLoading, setEventCommentsLoading] = useState(false);
  const [commentDraft, setCommentDraft] = useState("");
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [savingComment, setSavingComment] = useState(false);
  const [packageDrafts, setPackageDrafts] = useState<PackageDraft[]>(() => initialPackageDrafts(props));
  const [packageSavingId, setPackageSavingId] = useState<string | null>(null);
  const [financeOpen, setFinanceOpen] = useState(true);
  const [sessionsOpen, setSessionsOpen] = useState(true);
  const [bookingSession, setBookingSession] = useState<Props["projectSessions"][number] | null>(null);
  const [bookingProfessionalId, setBookingProfessionalId] = useState("");
  const [bookingServiceId, setBookingServiceId] = useState("");
  const [bookingDate, setBookingDate] = useState(() => new Date(Date.now() + 86400000).toISOString().slice(0, 10));
  const [bookingTime, setBookingTime] = useState("09:00");
  const [bookingEnvironmentId, setBookingEnvironmentId] = useState("");
  const [bookingAttendeeDependentId, setBookingAttendeeDependentId] = useState("");
  const [bookingEnvironments, setBookingEnvironments] = useState<BookingEnvironmentOption[]>([]);
  const [bookingAvailabilityLoading, setBookingAvailabilityLoading] = useState(false);
  const [bookingSaving, setBookingSaving] = useState(false);

  const isProjectDetail = Boolean(props.projectId);
  const selectedProject = props.projectId ? props.projects.find((project) => project.id === props.projectId) ?? null : null;
  const editingProject = editingProjectId ? props.projects.find((project) => project.id === editingProjectId) ?? null : null;
  const activeProjects = useMemo(() => props.projects.filter((project) => project.status === "PUBLISHED"), [props.projects]);
  const activeProjectIds = useMemo(() => new Set(activeProjects.map((project) => project.id)), [activeProjects]);
  const activeProjectEngagements = useMemo(() => props.engagements.filter((engagement) => activeProjectIds.has(engagement.project_id)), [activeProjectIds, props.engagements]);
  const activeProjectContractsCount = activeProjectEngagements.filter(projectContractIsActive).length;
  const activeProjectContractedCents = activeProjectEngagements.filter((item) => item.status !== "CANCELED").reduce((sum, item) => sum + item.contracted_cents, 0);
  const activeProjectEngagementIds = new Set(activeProjectEngagements.filter((item) => item.status !== "CANCELED").map((item) => item.id));
  const activeProjectReceivedCents = props.installments.filter((item) => activeProjectEngagementIds.has(item.engagement_id)).reduce((sum, item) => sum + installmentReceivedCents(item), 0);
  const visibleProjects = useMemo(() => {
    if (projectFilter === "published") return props.projects.filter((project) => project.status === "PUBLISHED");
    if (projectFilter === "archived") return props.projects.filter((project) => project.status === "ARCHIVED");
    return props.projects;
  }, [projectFilter, props.projects]);
  const projectPackages = useMemo(() => props.packages.filter((item) => item.project_id === selectedProject?.id && item.active), [props.packages, selectedProject?.id]);
  const projectEngagements = useMemo(() => props.engagements.filter((item) => item.project_id === selectedProject?.id), [props.engagements, selectedProject?.id]);
  const projectKanbanBoards = useMemo(() => props.kanbanBoards.filter((item) => item.project_id === selectedProject?.id && item.active), [props.kanbanBoards, selectedProject?.id]);
  const kanbanSectors = props.kanbanSectors ?? [];
  const engagementLastComments = props.engagementLastComments ?? {};
  const projectAllocationCents = useMemo(() => projectAllocationPerContract(props.costItems.filter((item) => item.project_id === selectedProject?.id), selectedProject?.goal_contracts ?? null), [props.costItems, selectedProject?.id, selectedProject?.goal_contracts]);
  const customerById = useMemo(() => new Map(props.customers.map((customer) => [customer.id, customer])), [props.customers]);
  const engagementCustomers = useMemo(() => {
    const customerIds = new Set(props.customers.map((customer) => customer.id));
    return [...props.customers, ...createdEngagementCustomers.filter((customer) => !customerIds.has(customer.id))];
  }, [createdEngagementCustomers, props.customers]);
  const matchingEngagementCustomers = useMemo(() => {
    const query = engagementCustomerQuery.trim().toLocaleLowerCase("pt-BR");
    if (!query) return [];
    return engagementCustomers.filter((customer) => `${customer.full_name} ${customer.phone_e164 ?? ""}`.toLocaleLowerCase("pt-BR").includes(query));
  }, [engagementCustomerQuery, engagementCustomers]);
  const selectedEngagementCustomer = engagementCustomers.find((customer) => customer.id === engagementCustomerId) ?? null;
  const editingEngagement = editingEngagementId ? projectEngagements.find((item) => item.id === editingEngagementId) ?? null : null;
  const packageById = useMemo(() => new Map(props.packages.map((item) => [item.id, item])), [props.packages]);
  const contractedCents = projectEngagements.filter((item) => item.status !== "CANCELED").reduce((sum, item) => sum + item.contracted_cents, 0);
  const projectSessions = useMemo(() => projectSessionsData.filter((session) => projectEngagements.some((engagement) => engagement.id === session.engagement_id)), [projectEngagements, projectSessionsData]);
  const projectCommissions = useMemo(() => projectCommissionsData.filter((commission) => commission.project_id === selectedProject?.id), [projectCommissionsData, selectedProject?.id]);
  const engagementSchedule = useMemo(() => {
    const total = Math.max(1, Number.parseInt(engagementInstallments, 10) || 1);
    const value = safeCentsInput(engagementPrice || "0");
    const entry = Math.min(value, Math.max(0, safeCentsInput(engagementEntry || "0")));
    const balance = Math.max(0, value - entry);
    const base = Math.floor(balance / total);
    return Array.from({ length: total }, (_, index) => ({ installment_number: index + 1, due_on: new Date(new Date(`${engagementFirstDueOn}T12:00:00`).setMonth(new Date(`${engagementFirstDueOn}T12:00:00`).getMonth() + index)).toISOString().slice(0, 10), amount_cents: index === total - 1 ? balance - base * (total - 1) : base }));
  }, [engagementEntry, engagementFirstDueOn, engagementInstallments, engagementPrice]);
  const engagementFinanceRows = useMemo(() => {
    const existing = props.installments.filter((item) => item.engagement_id === editingEngagementId);
    const entry = existing.find((item) => item.installment_number === 0);
    const schedule = generatedEngagementSchedule ?? engagementSchedule;
    const rows: Props["installments"][number][] = [];
    if (entry && (entry.status === "PAID" || (entry.settled_cents ?? 0) > 0)) rows.push(entry);
    else rows.push({ id: entry?.id ?? "draft-0", installment_number: 0, due_on: engagementEntryDueOn || entry?.due_on || new Date().toISOString().slice(0, 10), amount_cents: safeCentsInput(engagementEntry || "0"), engagement_id: editingEngagementId ?? "", status: "OPEN", paid_at: null, financial_entry_id: entry?.financial_entry_id ?? null, settled_cents: entry?.settled_cents ?? 0, remaining_cents: safeCentsInput(engagementEntry || "0"), last_paid_at: entry?.last_paid_at ?? null, payment_method: entry?.payment_method ?? null, financial_account_id: entry?.financial_account_id ?? null, financial_account_name: entry?.financial_account_name ?? null, received_by: entry?.received_by ?? null, received_by_name: entry?.received_by_name ?? null, organization_id: props.organizationId });
    if (generatedEngagementSchedule === null) {
      rows.push(...existing.filter((item) => item.installment_number > 0));
      if (!editingEngagementId) rows.push(...schedule.map((row) => draftInstallment(row, `draft-${row.installment_number}`, props.organizationId)));
    } else {
      rows.push(...existing.filter((item) => item.installment_number > 0 && (item.status === "PAID" || (item.settled_cents ?? 0) > 0)));
      rows.push(...schedule.map((row) => draftInstallment(row, `draft-${row.installment_number}`, props.organizationId)));
    }
    return rows.sort((a, b) => a.installment_number - b.installment_number);
  }, [editingEngagementId, engagementEntry, engagementEntryDueOn, engagementSchedule, generatedEngagementSchedule, props.installments, props.organizationId]);

  function resetProjectForm() {
    setProjectName("");
    setProjectDescription("");
    setProjectStartsOn("");
    setProjectSalesCloseOn("");
    setProjectEndsOn("");
    setProjectGoal("10");
    setProjectBarberIds([]);
  }

  function openNewProjectModal() {
    resetProjectForm();
    setEditingProjectId(null);
    setNewProjectOpen(true);
  }

  function openEditProjectModal(project: Props["projects"][number]) {
    setProjectName(project.name);
    setProjectDescription(project.description ?? "");
    setProjectStartsOn(project.starts_on ?? "");
    setProjectSalesCloseOn(project.sales_close_on ?? "");
    setProjectEndsOn(project.ends_on ?? "");
    setProjectGoal(project.goal_contracts ? String(project.goal_contracts) : "");
    setProjectBarberIds((props.projectBarbers ?? []).filter((item) => item.project_id === project.id).map((item) => item.barber_id));
    setEditingProjectId(project.id);
    setNewProjectOpen(false);
  }

  function closeProjectModal() {
    setNewProjectOpen(false);
    setEditingProjectId(null);
  }

  async function createProject() {
    if (saving) return;
    setSaving(true);
    const saved = await runMutation(setMessage, async () => {
      const result = await connectedClient().rpc("create_project", {
        p_organization_id: props.organizationId,
        p_name: projectName,
        p_description: projectDescription,
        p_starts_on: projectStartsOn || null,
        p_sales_close_on: projectSalesCloseOn || null,
        p_ends_on: projectEndsOn || null,
        p_goal_contracts: parseOptionalInt(projectGoal),
      });
      await assertResult(result);
      const project = Array.isArray(result.data) ? result.data[0] : result.data;
      if (project?.id) await assertResult(await connectedClient().rpc("set_project_barbers", { p_organization_id: props.organizationId, p_project_id: project.id, p_barber_ids: projectBarberIds }));
    }, "Projeto criado e publicado. Adicione os pacotes na sub tela Pacotes.");
    setSaving(false);
    if (saved) {
      closeProjectModal();
      resetProjectForm();
      router.refresh();
    }
  }

  async function updateProject() {
    if (saving || !editingProjectId) return;
    setSaving(true);
    const saved = await runMutation(setMessage, async () => {
      await assertResult(await connectedClient().rpc("update_project", {
        p_organization_id: props.organizationId,
        p_project_id: editingProjectId,
        p_name: projectName,
        p_description: projectDescription,
        p_starts_on: projectStartsOn || null,
        p_sales_close_on: projectSalesCloseOn || null,
        p_ends_on: projectEndsOn || null,
        p_goal_contracts: parseOptionalInt(projectGoal),
      }));
      await assertResult(await connectedClient().rpc("set_project_barbers", { p_organization_id: props.organizationId, p_project_id: editingProjectId, p_barber_ids: projectBarberIds }));
    }, "Projeto atualizado.");
    setSaving(false);
    if (saved) {
      closeProjectModal();
      resetProjectForm();
      router.refresh();
    }
  }

  async function toggleProjectArchive() {
    if (saving || !editingProjectId || !editingProject) return;
    const archived = editingProject.status !== "ARCHIVED";
    setSaving(true);
    const saved = await runMutation(setMessage, async () => {
      await assertResult(await connectedClient().rpc("set_project_archive_status", {
        p_organization_id: props.organizationId,
        p_project_id: editingProjectId,
        p_archived: archived,
      }));
    }, archived ? "Projeto arquivado." : "Projeto publicado.");
    setSaving(false);
    if (saved) {
      closeProjectModal();
      resetProjectForm();
      router.refresh();
    }
  }

  function openNewEngagementCustomer() {
    setNewEngagementCustomerName(engagementCustomerQuery.trim());
    setNewEngagementCustomerPhone("");
    setNewEngagementCustomerEmail("");
    setNewEngagementCustomerBirthDate("");
    setNewEngagementCustomerNotes("");
    setNewEngagementCustomerCpfCnpj("");
    setNewEngagementDependentName(""); setNewEngagementDependentBirthDate(""); setNewEngagementDependentRelationship("CHILD");
    setNewEngagementCustomerMessage("");
    setNewEngagementCustomerOpen(true);
  }

  function closeNewEngagementCustomer() {
    if (newEngagementCustomerSaving) return;
    setNewEngagementCustomerOpen(false);
    setNewEngagementCustomerMessage("");
  }

  async function createEngagementCustomer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newEngagementCustomerSaving) return;
    const formData = new FormData(event.currentTarget);
    const fullName = String(formData.get("full_name") ?? "").trim();
    const rawPhone = String(formData.get("phone_e164") ?? "").trim();
    const phone = normalizePhoneE164(rawPhone);
    if (!fullName) return;
    if (rawPhone && !phone) {
      setNewEngagementCustomerMessage("Informe um telefone válido com DDD e, se necessário, DDI.");
      return;
    }

    let createdCustomer: Props["customers"][number] | null = null;
    setNewEngagementCustomerSaving(true);
    const saved = await runMutation(setNewEngagementCustomerMessage, async () => {
      const result = await connectedClient().from("customers").insert({
        organization_id: props.organizationId,
        full_name: fullName,
        cpf_cnpj: String(formData.get("cpf_cnpj") ?? "").replace(/\D/g, "") || null,
        phone_e164: phone,
        email: String(formData.get("email") ?? "").trim().toLowerCase() || null,
        birth_date: String(formData.get("birth_date") ?? "") || null,
        notes: String(formData.get("notes") ?? "").trim() || null,
        active: true,
      }).select("id,full_name,phone_e164,email").single();
      await assertResult(result);
      if (!result.data) throw new Error("O cliente não retornou os dados após o cadastro.");
      createdCustomer = result.data as Props["customers"][number];
      if (newEngagementDependentName.trim() && newEngagementDependentBirthDate) await assertResult(await connectedClient().rpc("create_customer_dependent", { p_organization_id: props.organizationId, p_customer_id: createdCustomer.id, p_full_name: newEngagementDependentName.trim(), p_birth_date: newEngagementDependentBirthDate, p_relationship: newEngagementDependentRelationship }));
    }, "Cliente cadastrado e selecionado.");
    setNewEngagementCustomerSaving(false);

    const customer = createdCustomer as Props["customers"][number] | null;
    if (saved && customer) {
      setCreatedEngagementCustomers((current) => current.some((item) => item.id === customer.id) ? current : [...current, customer]);
      setEngagementCustomerId(customer.id);
      setEngagementCustomerQuery(customer.full_name);
      setNewEngagementCustomerOpen(false);
      setNewEngagementCustomerMessage("");
    }
  }

  async function saveEngagement() {
    if (!selectedProject || saving || !engagementCustomerId || !engagementPackageId) return;
    setSaving(true);
    const saved = await runMutation(setMessage, async () => {
      const value = centsFromInput(engagementPrice || "0");
      const entry = safeCentsInput(engagementEntry || "0");
      const count = Math.max(1, Number.parseInt(engagementInstallments, 10) || 1);
      if (entry > value) throw new Error("Entrada não pode superar o valor do contrato.");
      if (!engagementEntryDueOn || !engagementFirstDueOn) throw new Error("Informe os vencimentos da entrada e da primeira parcela.");
      await assertResult(await connectedClient().rpc("save_project_contract", {
        p_organization_id: props.organizationId,
        p_engagement_id: editingEngagementId,
        p_project_id: selectedProject.id,
        p_customer_id: engagementCustomerId,
        p_package_id: engagementPackageId,
        p_status: engagementStatus,
        p_contracted_cents: value,
        p_entry_cents: entry,
        p_installments_count: count,
        p_first_due_on: engagementFirstDueOn,
        p_entry_due_on: engagementEntryDueOn,
      }));
      if (editingEngagementId && editingEngagement && signingDate) {
        const signingStatus = editingEngagement.status === "PROPOSAL" ? "ACTIVE" : editingEngagement.status;
        const signingBoardId = editingEngagement.status === "PROPOSAL"
          ? projectKanbanBoards.find((board) => board.system_key === "ACTIVE")?.id ?? editingEngagement.kanban_board_id
          : editingEngagement.kanban_board_id;
        await assertResult(await connectedClient().rpc("set_project_engagement_status", {
          p_organization_id: props.organizationId,
          p_project_id: selectedProject.id,
          p_engagement_id: editingEngagement.id,
          p_status: signingStatus,
          p_accepted_on: signingDate,
          p_kanban_board_id: signingBoardId,
        }));
      }
    }, editingEngagementId ? "Contratação atualizada." : "Proposta criada e pronta para envio.");
    setSaving(false);
    if (saved) {
      setNewEngagementOpen(false);
      setEditingEngagementId(null);
      setEngagementCustomerId("");
      setEngagementCustomerQuery("");
      setEngagementPrice("");
      setEngagementEntry("0,00");
      setEngagementInstallments("1");
      setEngagementEntryDueOn(new Date().toISOString().slice(0, 10));
      setEngagementFirstDueOn(new Date().toISOString().slice(0, 10));
      setSigningDate("");
      setGeneratedEngagementSchedule(null);
      router.refresh();
    }
  }

  function openProjectSessionBooking(session: Props["projectSessions"][number]) {
    const engagement = props.engagements.find((item) => item.id === session.engagement_id);
    if (!engagement || session.status !== "OPEN") return;
    const assignments = (props.packageServiceAssignments ?? []).filter((item) => item.project_package_id === engagement.package_id);
    const firstAssignment = assignments[0];
    const defaultDate = localTomorrowInputValue();
    setBookingSession(session);
    setBookingProfessionalId(firstAssignment?.barber_id ?? props.barbers[0]?.id ?? "");
    setBookingServiceId(firstAssignment?.service_id ?? "");
    setBookingDate(defaultDate);
    setBookingTime("09:00");
    setBookingEnvironmentId("");
    setBookingAttendeeDependentId("");
    setBookingEnvironments([]);
    void loadBookingEnvironments(session, firstAssignment?.barber_id ?? props.barbers[0]?.id ?? "", firstAssignment?.service_id ?? "", defaultDate, "09:00");
  }

  function closeProjectSessionBooking() {
    if (bookingSaving) return;
    setBookingSession(null);
    setBookingProfessionalId("");
    setBookingServiceId("");
    setBookingEnvironmentId("");
    setBookingEnvironments([]);
  }

  async function loadBookingEnvironments(session: Props["projectSessions"][number], barberId: string, serviceId: string, date: string, time: string) {
    setBookingEnvironments([]);
    setBookingEnvironmentId("");
    if (!barberId || !serviceId || !date || !time) {
      setBookingAvailabilityLoading(false);
      return;
    }
    setBookingAvailabilityLoading(true);
    try {
      const result = await connectedClient().rpc("get_project_session_environments", {
        p_organization_id: props.organizationId,
        p_session_id: session.id,
        p_barber_id: barberId,
        p_service_id: serviceId,
        p_starts_at: new Date(`${date}T${time}:00`).toISOString(),
      });
      await assertResult(result);
      const environments = (result.data ?? []) as BookingEnvironmentOption[];
      setBookingEnvironments(environments);
      setBookingEnvironmentId(environments[0]?.id ?? "");
    } catch (error) {
      setMessage(humanizeError(error));
    } finally {
      setBookingAvailabilityLoading(false);
    }
  }

  async function bookProjectSession() {
    if (!bookingSession || !bookingProfessionalId || !bookingServiceId || !bookingDate || !bookingTime || bookingSaving) return;
    setBookingSaving(true);
    const saved = await runMutation(setMessage, async () => {
      const appointmentResult = await connectedClient().rpc("create_project_appointment", {
        p_organization_id: props.organizationId,
        p_session_id: bookingSession.id,
        p_barber_id: bookingProfessionalId,
        p_service_id: bookingServiceId,
        p_starts_at: new Date(`${bookingDate}T${bookingTime}:00`).toISOString(),
        p_environment_id: bookingEnvironmentId || null,
        p_override_reason: null,
        p_notes: "Atendimento de projeto",
      });
      await assertResult(appointmentResult);
      if (bookingAttendeeDependentId && appointmentResult.data) await assertResult(await connectedClient().rpc("set_appointment_attendee", { p_appointment_id: String(appointmentResult.data), p_attendee_dependent_id: bookingAttendeeDependentId }));
    }, "Sessão agendada.");
    setBookingSaving(false);
    if (saved) {
      closeProjectSessionBooking();
      router.refresh();
    }
  }

  async function cancelProjectSession(session: Props["projectSessions"][number]) {
    if (!session.appointment_id || bookingSaving) return;
    setBookingSaving(true);
    const saved = await runMutation(setMessage, async () => {
      await assertResult(await connectedClient().rpc("cancel_appointment", {
        p_appointment_id: session.appointment_id,
        p_reason: "Cancelamento de sessão do projeto",
        p_requested_by_customer: false,
      }));
    }, "Sessão cancelada.");
    setBookingSaving(false);
    if (saved) router.refresh();
  }

  function generateEngagementInstallments() {
    const value = safeCentsInput(engagementPrice || "0");
    const entry = Math.min(value, Math.max(0, safeCentsInput(engagementEntry || "0")));
    const total = Math.max(1, Number.parseInt(engagementInstallments, 10) || 1);
    const existing = props.installments.filter((item) => item.engagement_id === editingEngagementId);
    const paidRows = existing.filter((item) => item.installment_number > 0 && (item.status === "PAID" || (item.settled_cents ?? 0) > 0));
    const paidTotal = paidRows.reduce((sum, item) => sum + (item.settled_cents ?? item.amount_cents), 0);
    const remaining = Math.max(0, value - entry - paidTotal);
    const openCount = Math.max(0, total - paidRows.length);
    const lastPaid = paidRows.reduce((max, item) => Math.max(max, item.installment_number), 0);
    const lastPaidDue = paidRows.find((item) => item.installment_number === lastPaid)?.due_on;
    const start = new Date(`${lastPaidDue ?? engagementFirstDueOn}T12:00:00`);
    if (lastPaidDue) start.setMonth(start.getMonth() + 1);
    else start.setMonth(start.getMonth());
    const base = openCount > 0 ? Math.floor(remaining / openCount) : 0;
    setGeneratedEngagementSchedule(Array.from({ length: openCount }, (_, index) => {
      const installmentNumber = lastPaid + index + 1;
      const due = new Date(start);
      due.setMonth(start.getMonth() + index);
      return { installment_number: installmentNumber, due_on: due.toISOString().slice(0, 10), amount_cents: index === openCount - 1 ? remaining - base * (openCount - 1) : base };
    }));
  }

  function openEngagementModal() {
    const firstPackage = projectPackages[0];
    setEngagementCustomerId("");
    setEngagementCustomerQuery("");
    setEngagementPackageId(firstPackage?.id ?? "");
    setEngagementPrice(firstPackage ? (firstPackage.price_cents / 100).toFixed(2).replace(".", ",") : "");
    setEngagementEntry(firstPackage ? centsInput(firstPackage.deposit_cents) : "0,00");
    setEngagementInstallments("1");
    setEngagementEntryDueOn(new Date().toISOString().slice(0, 10));
    setEngagementFirstDueOn(new Date().toISOString().slice(0, 10));
    setEngagementStatus("PROPOSAL");
    setSigningDate("");
    setGeneratedEngagementSchedule(null);
    setNewEngagementOpen(true);
  }

  function openEditEngagementModal(engagement: Props["engagements"][number]) {
    setEditingEngagementId(engagement.id);
    setEngagementCustomerId(engagement.customer_id);
    setEngagementCustomerQuery(customerById.get(engagement.customer_id)?.full_name ?? "");
    setEngagementPackageId(engagement.package_id);
    setEngagementPrice(centsInput(engagement.contracted_cents));
    const rows = props.installments.filter((item) => item.engagement_id === engagement.id);
    const entry = rows.find((item) => item.installment_number === 0);
    const paidRows = rows.filter((item) => item.installment_number > 0);
    const firstInstallment = rows.find((item) => item.installment_number === 1);
    setEngagementEntry(entry ? centsInput(entry.amount_cents) : "0,00");
    setEngagementInstallments(String(Math.max(1, paidRows.length)));
    setEngagementEntryDueOn(entry?.due_on ?? new Date().toISOString().slice(0, 10));
    setEngagementFirstDueOn(firstInstallment?.due_on ?? new Date().toISOString().slice(0, 10));
    setEngagementStatus(engagement.status === "CANCELED" ? "PROPOSAL" : engagement.status);
    setSigningDate(engagement.accepted_at?.slice(0, 10) ?? "");
    setGeneratedEngagementSchedule(null);
    setNewEngagementOpen(true);
  }

  function closeEngagementModal() {
    setNewEngagementOpen(false);
    setNewEngagementCustomerOpen(false);
    setEditingEngagementId(null);
    setGeneratedEngagementSchedule(null);
  }

  function updatePackageDraft(index: number, patch: Partial<PackageDraft>) {
    setPackageDrafts((current) => current.map((draft, draftIndex) => draftIndex === index ? { ...draft, ...patch } : draft));
  }

  function addPackageDraft() {
    if (packageDrafts.length >= 4) return;
    setPackageDrafts((current) => [...current, emptyPackageDraft()]);
  }

  async function savePackage(draft: PackageDraft): Promise<string | null> {
    if (!selectedProject || packageSavingId) return null;
    const pricing = packagePricing(draft, projectAllocationCents);
    if (!draft.name.trim()) {
      setMessage("Informe o nome do pacote.");
      return null;
    }
    if (!pricing.denominatorValid) {
      setMessage("A soma de margem, taxa e imposto precisa ser menor que 100%.");
      return null;
    }
    setPackageSavingId(draft.id ?? "new");
    let savedPackageId = draft.id;
    const saved = await runMutation(setMessage, async () => {
      const result = await connectedClient().rpc("upsert_project_package", {
        p_organization_id: props.organizationId,
        p_project_id: selectedProject.id,
        p_package_id: draft.id,
        p_name: draft.name,
        p_description: draft.description,
        p_duration_minutes: pricing.duration,
        p_sessions_count: pricing.sessions,
        p_fixed_cost_per_hour_cents: pricing.fixedCost,
        p_extra_costs_cents: pricing.extraCosts,
        p_extra_costs_description: draft.extraCostsDescription,
        p_tax_rate_bps: pricing.taxRate,
        p_card_rate_bps: pricing.cardRate,
        p_profit_margin_bps: pricing.profitMargin,
        p_deposit_cents: safeCentsInput(draft.deposit),
        p_practiced_price_cents: pricing.practiced,
        p_service_assignments: draft.serviceAssignments,
      });
      await assertResult(result);
      const row = Array.isArray(result.data) ? result.data[0] : result.data;
      if (!savedPackageId && row && typeof row === "object" && "id" in row && typeof row.id === "string") savedPackageId = row.id;
      if (!savedPackageId) throw new Error("Pacote salvo sem identificador.");
    }, draft.id ? "Pacote atualizado." : "Pacote criado.");
    setPackageSavingId(null);
    if (saved) {
      if (savedPackageId && !draft.id) setPackageDrafts((current) => current.map((item) => item === draft ? { ...item, id: savedPackageId } : item));
      router.refresh();
    }
    return saved ? savedPackageId : null;
  }

  async function openReceiveInstallment(installment: Props["installments"][number]) {
    if (!installment.financial_entry_id) return;
    setReceivingInstallment(installment);
  }

  async function receiveInstallment(form: HTMLFormElement) {
    if (!receivingInstallment?.financial_entry_id || saving) return;
    const data = new FormData(form);
    setSaving(true);
    const saved = await runMutation(setMessage, async () => {
      await assertResult(await connectedClient().rpc("settle_project_installment_receipt", {
        p_entry_id: receivingInstallment.financial_entry_id,
        p_financial_account_id: String(data.get("financial_account_id") ?? ""),
        p_amount_cents: centsFromInput(String(data.get("amount") ?? "0")),
        p_settled_on: String(data.get("settled_on") ?? ""),
        p_payment_method: String(data.get("payment_method") ?? "OTHER"),
        p_reference: String(data.get("reference") ?? "") || null,
        p_idempotency_key: `manager:project-installment:${receivingInstallment.id}:${crypto.randomUUID()}`,
        p_chart_account_id: String(data.get("chart_account_id") ?? ""),
        p_cost_center_id: String(data.get("cost_center_id") ?? "") || null,
        p_document_number: String(data.get("document_number") ?? "") || null,
        p_tag_ids: data.getAll("tag_ids").map(String),
      }));
    }, "Recebimento registrado no módulo Financeiro.");
    setSaving(false);
    if (saved) { setReceivingInstallment(null); router.refresh(); }
  }

  async function updateInstallment(form: HTMLFormElement) {
    if (!editingInstallment || saving) return;
    const data = new FormData(form);
    setSaving(true);
    const saved = await runMutation(setMessage, async () => {
      await assertResult(await connectedClient().rpc("update_project_installment", {
        p_organization_id: props.organizationId,
        p_installment_id: editingInstallment.id,
        p_amount_cents: centsFromInput(String(data.get("amount") ?? "0")),
        p_due_on: String(data.get("due_on") ?? ""),
      }));
    }, "Parcela atualizada.");
    setSaving(false);
    if (saved) { setEditingInstallment(null); router.refresh(); }
  }

  async function loadEventComments(engagementId: string) {
    const client = connectedClient();
    if (typeof client.from !== "function") return;
    setEventCommentsLoading(true);
    try {
      const result = await client.from("project_engagement_comments").select("id,organization_id,project_id,engagement_id,body,author_name,created_at,updated_at").eq("organization_id", props.organizationId).eq("engagement_id", engagementId).order("created_at", { ascending: false });
      await assertResult(result);
      setEventComments((result.data ?? []) as ProjectEventComment[]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Comentários não puderam ser carregados.");
    } finally {
      setEventCommentsLoading(false);
    }
  }

  function openEventEditor(engagement: Props["engagements"][number]) {
    setEventEditorEngagementId(engagement.id);
    setEventEditorEngagement(engagement);
    setEventDescription(engagement.event_description ?? "");
    setEventLink1(engagement.event_link_1 ?? "");
    setEventLink2(engagement.event_link_2 ?? "");
    setEventLink3(engagement.event_link_3 ?? "");
    const sharedLinks = (props.projectEngagementLinks ?? []).filter((link) => link.engagement_id === engagement.id && link.created_by_role === "OWNER");
    setEventLinkTitle1(sharedLinks[0]?.label ?? "Link 1");
    setEventLinkTitle2(sharedLinks[1]?.label ?? "Link 2");
    setEventLinkTitle3(sharedLinks[2]?.label ?? "Link 3");
    setEventDueOn(engagement.event_due_on ?? "");
    setCommentDraft("");
    setEditingCommentId(null);
    setEventComments([]);
    void loadEventComments(engagement.id);
  }

  function closeEventEditor() {
    setEventEditorEngagementId(null);
    setEventEditorEngagement(null);
    setCommentDraft("");
    setEditingCommentId(null);
    setEventComments([]);
  }

  function setDueDateOverride(engagement: Props["engagements"][number], dueOn: string) {
    const previous = eventDueDateOverrides[engagement.id];
    setEventDueDateOverrides((current) => ({
      ...current,
      [engagement.id]: { fromDueOn: engagement.event_due_on ?? null, dueOn: dueOn || null, boardId: engagement.kanban_board_id ?? null, receivedAt: engagement.kanban_received_at ?? null },
    }));
    return previous;
  }

  function restoreDueDateOverride(engagementId: string, previous: EventDueDateOverride | undefined) {
    setEventDueDateOverrides((current) => {
      const next = { ...current };
      if (previous) next[engagementId] = previous;
      else delete next[engagementId];
      return next;
    });
  }

  async function saveEventDetails() {
    const engagement = eventEditorEngagement ?? props.engagements.find((item) => item.id === eventEditorEngagementId);
    const eventProject = selectedProject ?? props.projects.find((project) => project.id === engagement?.project_id);
    if (!eventProject || !engagement || saving) return;
    const previousDueDateOverride = setDueDateOverride(engagement, eventDueOn);
    setSaving(true);
    const saved = await runMutation(setMessage, async () => {
      await assertResult(await connectedClient().rpc("save_project_engagement_event", {
        p_organization_id: props.organizationId,
        p_project_id: eventProject.id,
        p_engagement_id: engagement.id,
        p_description: eventDescription,
        p_link_1: eventLink1,
        p_link_2: eventLink2,
        p_link_3: eventLink3,
        p_due_on: eventDueOn || null,
      }));
      await assertResult(await connectedClient().rpc("owner_sync_project_engagement_links", { p_organization_id: props.organizationId, p_project_id: eventProject.id, p_engagement_id: engagement.id, p_titles: [eventLinkTitle1, eventLinkTitle2, eventLinkTitle3], p_urls: [eventLink1, eventLink2, eventLink3] }));
    }, "Evento atualizado.");
    setSaving(false);
    if (saved) {
      closeEventEditor();
      router.refresh();
    } else restoreDueDateOverride(engagement.id, previousDueDateOverride);
  }

  async function saveEventDueDate(engagement: Props["engagements"][number], dueOn: string) {
    const eventProject = selectedProject ?? props.projects.find((project) => project.id === engagement.project_id);
    if (!eventProject || saving) return false;
    const previousDueDateOverride = setDueDateOverride(engagement, dueOn);
    setSaving(true);
    const saved = await runMutation(setMessage, async () => {
      await assertResult(await connectedClient().rpc("save_project_engagement_event", {
        p_organization_id: props.organizationId,
        p_project_id: eventProject.id,
        p_engagement_id: engagement.id,
        p_description: engagement.event_description ?? "",
        p_link_1: engagement.event_link_1 ?? "",
        p_link_2: engagement.event_link_2 ?? "",
        p_link_3: engagement.event_link_3 ?? "",
        p_due_on: dueOn || null,
      }));
    }, "Data prazo atualizada.");
    setSaving(false);
    if (!saved) restoreDueDateOverride(engagement.id, previousDueDateOverride);
    if (saved) router.refresh();
    return saved;
  }

  async function saveEventComment() {
    const engagement = eventEditorEngagement ?? props.engagements.find((item) => item.id === eventEditorEngagementId);
    const eventProject = selectedProject ?? props.projects.find((project) => project.id === engagement?.project_id);
    if (!eventProject || !engagement || !commentDraft.trim() || savingComment) return;
    setSavingComment(true);
    const saved = await runMutation(setMessage, async () => {
      await assertResult(await connectedClient().rpc("save_project_engagement_comment", {
        p_organization_id: props.organizationId,
        p_project_id: eventProject.id,
        p_engagement_id: engagement.id,
        p_comment_id: editingCommentId,
        p_body: commentDraft,
      }));
    }, editingCommentId ? "Comentário atualizado." : "Comentário adicionado.");
    setSavingComment(false);
    if (saved) {
      setCommentDraft("");
      setEditingCommentId(null);
      await loadEventComments(engagement.id);
    }
  }

  return <div className={styles.stack}>
    <PageHeader
      eyebrow={isProjectDetail ? "Projeto" : undefined}
      title={isProjectDetail ? (selectedProject?.name ?? "Projeto não encontrado") : "Projetos"}
      description={isProjectDetail ? (selectedProject?.description || "Oferta comercial com etapas acompanhadas e aceite por contratação.") : "Ofertas com prazo, pacotes, contratações e execução acompanhada em uma única jornada."}
      actions={isProjectDetail ? <div className={styles.toolbarGroup}><button className={`${styles.button} ${styles.buttonSoft} ${styles.iconButton}`} type="button" onClick={() => router.push("/gestor/projetos")} aria-label="Voltar para Projetos" title="Voltar para Projetos"><ArrowLeft size={17} /></button>{selectedProject && <><StatusChip active={selectedProject.status === "PUBLISHED"} label={projectStatusLabels[selectedProject.status]} /><button className={styles.button} type="button" onClick={openEngagementModal}><Plus size={16} /> Novo contrato</button></>}</div> : <div className={styles.toolbarGroup}><button className={styles.button} type="button" onClick={openNewProjectModal}><Plus size={16} /> Novo projeto</button></div>}
    />
    <ActionMessage message={message} />

    {!isProjectDetail && <section className={styles.projectStats} aria-label="Resumo de projetos">
      <article><span>Projetos publicados</span><strong>{activeProjects.length}</strong><small>Somente projetos ativos</small></article>
      <article><span>Contratações ativas</span><strong>{activeProjectContractsCount}</strong><small>{activeProjectEngagements.filter((item) => item.status === "PROPOSAL").length} propostas aguardando aceite</small></article>
      <article><span>Valor contratado</span><strong>{formatCents(activeProjectContractedCents)}</strong><small>Contratos e propostas válidos</small></article>
      <article><span>Total Recebido</span><strong>{formatCents(activeProjectReceivedCents)}</strong><small>Entradas e parcelas recebidas nos projetos ativos</small></article>
    </section>}

    {props.projects.length === 0 ? <Panel title="Comece pelo primeiro projeto" description="Crie uma oferta comercial com prazo, pacote inicial e etapas padrão."><EmptyState title="Nenhum projeto criado" action={<button className={styles.button} type="button" onClick={openNewProjectModal}><Plus size={16} /> Criar projeto</button>}>O projeto é a oferta reutilizável. A contratação será criada depois para cada cliente.</EmptyState></Panel> : isProjectDetail ? selectedProject ? <section className={styles.projectDetail} aria-label={`Detalhes de ${selectedProject.name}`}>
          <nav className={styles.tabs} aria-label="Seções do projeto">{([ ["overview", "Visão geral", LayoutDashboard], ["investments", "Investimentos", Landmark], ["packages", "Pacotes", Calculator], ["engagements", "Contratações", Users], ["kanban", "Kanban", CheckCircle2], ["finance", "Financeiro", CircleDollarSign] ] as const).map(([value, label, Icon]) => <button type="button" key={value} className={`${styles.tab} ${tab === value ? styles.tabActive : ""}`} onClick={() => setTab(value)}><Icon size={15} /> {label}</button>)}</nav>
          {tab === "overview" && <ProjectOverview goalContracts={selectedProject.goal_contracts} projectCostItems={props.costItems.filter((item) => item.project_id === selectedProject.id)} projectPackages={projectPackages} kanbanBoards={projectKanbanBoards} engagements={projectEngagements} customerById={customerById} packageById={packageById} installments={props.installments.filter((item) => projectEngagements.some((engagement) => engagement.id === item.engagement_id))} />}
          {tab === "investments" && <ProjectInvestments organizationId={props.organizationId} projectId={selectedProject.id} goalContracts={selectedProject.goal_contracts} items={props.costItems.filter((item) => item.project_id === selectedProject.id)} />}
          {tab === "packages" && <ProjectPackages packages={packageDrafts} barbers={props.barbers} barberServices={props.barberServices ?? []} services={props.services} fixedCostCents={projectAllocationCents} savingId={packageSavingId} onAdd={addPackageDraft} onChange={updatePackageDraft} onSave={savePackage} />}
          {tab === "engagements" && <EngagementsTable engagements={projectEngagements} customerById={customerById} packageById={packageById} installments={props.installments.filter((item) => projectEngagements.some((engagement) => engagement.id === item.engagement_id))} projectSessions={projectSessions} kanbanBoards={projectKanbanBoards} onEdit={openEditEngagementModal} />}
          {tab === "kanban" && <ProjectKanban key={JSON.stringify([projectKanbanBoards, projectEngagements, props.internalCards])} organizationId={props.organizationId} projectId={selectedProject.id} boards={projectKanbanBoards} sectors={kanbanSectors} engagementsWithDueDateOverrides={eventDueDateOverrides} barbers={props.barbers} engagements={projectEngagements} internalCards={(props.internalCards ?? []).filter((card) => card.project_id === selectedProject.id)} packageAssignments={(props.packageServiceAssignments ?? []).filter((assignment) => props.packages.some((pkg) => pkg.id === assignment.project_package_id && pkg.project_id === selectedProject.id))} packages={props.packages.filter((pkg) => pkg.project_id === selectedProject.id)} services={props.services} internalServices={props.internalServices ?? []} customerById={customerById} lastComments={engagementLastComments} onOpenEvent={openEventEditor} onDueDateChange={saveEventDueDate} />}
          {tab === "finance" && <ProjectFinance contractedCents={contractedCents} installments={props.installments.filter((item) => projectEngagements.some((engagement) => engagement.id === item.engagement_id))} commissions={projectCommissions} barbers={props.barbers} />}
        </section> : <Panel title="Projeto não encontrado" description="Este projeto não está disponível para esta barbearia."><EmptyState title="Volte para Projetos"><button className={styles.button} type="button" onClick={() => router.push("/gestor/projetos")}><ArrowLeft size={16} /> Voltar para Projetos</button></EmptyState></Panel> : <Panel className={styles.projectListPanel} title="Projetos em andamento" description="Selecione um projeto para abrir o painel operacional." action={<label className={styles.projectFilter}><span>Exibir</span><select aria-label="Filtrar projetos" value={projectFilter} onChange={(event) => setProjectFilter(event.target.value as ProjectFilter)}><option value="published">Publicados</option><option value="archived">Arquivados</option><option value="all">Todos</option></select></label>}>
          <div className={styles.projectList}>
            {visibleProjects.length === 0 ? <EmptyState title={projectFilter === "archived" ? "Nenhum projeto arquivado" : "Nenhum projeto publicado"}>{projectFilter === "archived" ? "Arquive um projeto para encontrá-lo nesta lista." : "Crie e publique um projeto para começar."}</EmptyState> : visibleProjects.map((project) => {
              const count = props.engagements.filter((item) => item.project_id === project.id && item.status !== "CANCELED").length;
              return <div className={styles.projectCardRow} key={project.id}><button type="button" className={styles.projectCard} onClick={() => router.push(`/gestor/projetos/${project.id}`)} aria-label={`Abrir projeto ${project.name}`}>
                <span className={styles.projectCardIcon}><BriefcaseBusiness size={17} /></span><span className={styles.rowTitle}><strong>{project.name}</strong><small>{dateLabel(project.starts_on)} — {dateLabel(project.ends_on)}</small></span><span className={styles.projectCardMeta}><strong>{count}{project.goal_contracts ? ` / ${project.goal_contracts}` : ""}</strong><small>contratações</small></span><StatusChip active={project.status === "PUBLISHED"} label={projectStatusLabels[project.status]} tone={project.status === "PAUSED" ? "warning" : project.status === "CLOSED" || project.status === "ARCHIVED" ? "neutral" : undefined} /><ArrowRight size={16} /></button><button type="button" className={`${styles.button} ${styles.buttonSoft} ${styles.iconButton}`} onClick={() => openEditProjectModal(project)} aria-label={`Editar projeto ${project.name}`} title="Editar projeto"><Pencil size={16} /></button></div>;
            })}
          </div>
        </Panel>}

    {!isProjectDetail && props.projects.length > 0 && <GeneralProjectKanban key={JSON.stringify([kanbanSectors, props.kanbanBoards, props.projects, props.engagements])} organizationId={props.organizationId} sectors={kanbanSectors} boards={props.kanbanBoards} projects={props.projects} engagements={props.engagements} engagementsWithDueDateOverrides={eventDueDateOverrides} barbers={props.barbers} customerById={customerById} lastComments={engagementLastComments} onOpenEvent={openEventEditor} onDueDateChange={saveEventDueDate} />}

    {(newProjectOpen || editingProjectId) && <Modal title={editingProjectId ? "Editar projeto" : "Novo projeto"} onClose={closeProjectModal}>
      <div className={styles.form}><Field label="Nome do projeto" wide><input value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="Ex.: Visagismo 2026" autoFocus /></Field><Field label="Descrição" wide><textarea value={projectDescription} onChange={(event) => setProjectDescription(event.target.value)} placeholder="O que a jornada entrega para o cliente?" /></Field><Field label="Início"><input type="date" value={projectStartsOn} onChange={(event) => setProjectStartsOn(event.target.value)} /></Field><Field label="Fim"><input type="date" value={projectEndsOn} onChange={(event) => setProjectEndsOn(event.target.value)} /></Field><Field label="Encerrar novas vendas em"><input type="date" value={projectSalesCloseOn} onChange={(event) => setProjectSalesCloseOn(event.target.value)} /></Field><Field label="Meta de contratações"><input type="number" min="1" value={projectGoal} onChange={(event) => setProjectGoal(event.target.value)} /></Field><Field label="Profissionais vinculados" wide><select multiple value={projectBarberIds} onChange={(event) => setProjectBarberIds(Array.from(event.target.selectedOptions, (option) => option.value))} aria-label="Profissionais vinculados">{props.barbers.map((barber) => <option key={barber.id} value={barber.id}>{barber.display_name}</option>)}</select><small className={styles.muted}>Selecione os profissionais que poderão abrir este projeto no App do Barbeiro.</small></Field></div><footer className={styles.modalActions}>{editingProjectId && editingProject && <button className={`${styles.button} ${editingProject.status === "ARCHIVED" ? "" : styles.buttonDanger}`} type="button" disabled={saving} onClick={() => void toggleProjectArchive()}>{editingProject.status === "ARCHIVED" ? "Publicar projeto" : "Arquivar projeto"}</button>}<button className={`${styles.button} ${styles.buttonSoft}`} type="button" onClick={closeProjectModal}>Cancelar</button><button className={styles.button} type="button" disabled={saving || !projectName.trim()} onClick={() => void (editingProjectId ? updateProject() : createProject())}>{saving ? (editingProjectId ? "Salvando…" : "Criando…") : (editingProjectId ? "Salvar alterações" : "Criar e publicar")}</button></footer>
    </Modal>}
    {newEngagementOpen && selectedProject && <Modal title="Novo contrato" wide onClose={closeEngagementModal}>
      <div className={styles.form}>
        <Field label="Cliente" wide><span className="input-shell"><UserRound size={17} /><input required aria-label="Cliente" value={selectedEngagementCustomer?.full_name ?? engagementCustomerQuery} onChange={(event) => { setEngagementCustomerQuery(event.target.value); setEngagementCustomerId(""); }} placeholder="Buscar por nome ou telefone" /></span></Field>
        {engagementCustomerQuery.trim() && !engagementCustomerId && <div className={`${styles.formWide} customer-search-results`}>{matchingEngagementCustomers.map((customer) => <button className="customer-search-result" key={customer.id} type="button" aria-label={`Selecionar ${customer.full_name}`} onClick={() => { setEngagementCustomerId(customer.id); setEngagementCustomerQuery(customer.full_name); }}><strong>{customer.full_name}</strong><small>{customer.phone_e164 ?? "Sem telefone"}</small></button>)}{matchingEngagementCustomers.length === 0 && <><p className="customer-search-selected">Nenhum cliente encontrado.</p><button className="customer-search-create" type="button" onClick={openNewEngagementCustomer}><Plus size={15} /> Cadastrar novo cliente</button></>}</div>}
        {selectedEngagementCustomer && <p className={`${styles.formWide} customer-search-selected`}><Check size={15} /> {selectedEngagementCustomer.full_name} selecionado</p>}
        <Field label="Pacote"><select aria-label="Pacote" value={engagementPackageId} onChange={(event) => { const packageId = event.target.value; setEngagementPackageId(packageId); const selected = projectPackages.find((item) => item.id === packageId); if (selected) { setEngagementPrice(centsInput(selected.price_cents)); setEngagementEntry(centsInput(selected.deposit_cents)); setEngagementInstallments(String(Math.max(1, selected.sessions_count))); } }}>{projectPackages.map((item) => <option key={item.id} value={item.id}>{item.name} · {formatCents(item.price_cents)}</option>)}</select></Field>
        <Field label="Valor"><input inputMode="decimal" value={engagementPrice} onChange={(event) => setEngagementPrice(event.target.value)} /></Field>
        <Field label="Entrada"><input inputMode="decimal" value={engagementEntry} onChange={(event) => setEngagementEntry(event.target.value)} /></Field>
        <Field label="Total de parcelas"><input type="number" min="1" max="120" value={engagementInstallments} onChange={(event) => setEngagementInstallments(event.target.value)} /></Field>
        <Field label="Vencimento da Entrada"><input type="date" value={engagementEntryDueOn} onChange={(event) => setEngagementEntryDueOn(event.target.value)} /></Field>
        <Field label="1º vencimento"><input type="date" value={engagementFirstDueOn} onChange={(event) => setEngagementFirstDueOn(event.target.value)} /></Field>
        <div className={styles.installmentGenerator}><Field label="Valor da parcela"><input readOnly value={formatCents((generatedEngagementSchedule ?? engagementSchedule)[0]?.amount_cents ?? 0)} /></Field><button className={`${styles.button} ${styles.buttonSoft}`} type="button" onClick={generateEngagementInstallments} disabled={saving}>Gerar Parcelas</button></div>
        <div className={`${styles.formWide} ${styles.contractFinance}`}><button className={styles.sectionToggle} type="button" onClick={() => setFinanceOpen((current) => !current)} aria-expanded={financeOpen}><ChevronRight size={16} className={financeOpen ? styles.sectionToggleOpen : ""} /> Financeiro</button>{financeOpen && <div className={styles.engagementFinanceTable}><div className={styles.engagementFinanceHeader}><span>N.</span><span>Valor da parcela</span><span>Data vencimento</span><span>Data Pgto</span><span>Forma de pagamento</span><span>Conta</span><span>Usuário que recebeu</span><span>Ações</span></div>{engagementFinanceRows.map((row) => <div className={`${styles.engagementFinanceRow} ${installmentIsOverdue(row) ? styles.engagementFinanceOverdue : ""}`} key={row.id}><span>{row.installment_number}</span><strong>{formatCents(row.amount_cents)}</strong><span>{dateLabel(row.due_on)}</span><span>{row.last_paid_at ? dateLabel(row.last_paid_at) : "—"}</span><span>{row.payment_method ?? "—"}</span><span>{row.financial_account_name ?? row.financial_account_id ?? "—"}</span><span>{row.received_by_name ?? row.received_by ?? "—"}</span><span className={styles.toolbarGroup}><button className={`${styles.button} ${styles.buttonSoft}`} type="button" disabled={row.id.startsWith("draft-")} onClick={() => setEditingInstallment(row)}>Editar</button><button className={styles.button} type="button" disabled={!row.financial_entry_id || (row.remaining_cents ?? row.amount_cents) <= 0} onClick={() => void openReceiveInstallment(row)}>Receber</button></span></div>)}</div>}</div>
        {editingEngagementId && <div className={`${styles.formWide} ${styles.contractFinance}`}><button className={styles.sectionToggle} type="button" onClick={() => setSessionsOpen((current) => !current)} aria-expanded={sessionsOpen}><ChevronRight size={16} className={sessionsOpen ? styles.sectionToggleOpen : ""} /> Sessões</button>{sessionsOpen && <div className={`${styles.engagementFinanceTable} ${styles.engagementSessionsTable}`}><div className={`${styles.engagementFinanceHeader} ${styles.engagementSessionsHeader}`}><span>Sessão</span><span>Data</span><span>Hora</span><span>Profissional</span><span>Status</span><span>Ações</span></div>{projectSessions.filter((session) => session.engagement_id === editingEngagementId).map((session) => { const appointment = session.appointment; const barber = props.barbers.find((item) => item.id === session.barber_id); const date = appointment?.service_period ? new Date(appointment.service_period.slice(1, 25)).toLocaleDateString("pt-BR") : "—"; const time = appointment?.service_period ? new Date(appointment.service_period.slice(1, 25)).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—"; const statusLabel = appointment?.status === "CANCELED" ? (appointment.cancellation_outcome === "ON_TIME" ? "Cancelado no prazo" : "Cancelado após o prazo") : appointment ? projectAppointmentStatusLabels[appointment.status] ?? appointment.status : projectSessionStatusLabels[session.status]; return <div className={`${styles.engagementFinanceRow} ${styles.engagementSessionsRow}`} key={session.id}><strong>{session.session_number}</strong><span>{date}</span><span>{time}</span><span>{barber?.display_name ?? "—"}</span><StatusChip active={session.status === "COMPLETED"} label={statusLabel} tone={appointment?.status === "CANCELED" || session.status === "CANCELED" ? "danger" : appointment?.status === "IN_SERVICE" ? "warning" : undefined} /><span className={styles.toolbarGroup}>{session.status === "OPEN" && <button className={styles.button} type="button" onClick={() => openProjectSessionBooking(session)}><CalendarDays size={14} /> Agendar</button>}{session.status === "BOOKED" && session.appointment_id && <button className={`${styles.button} ${styles.buttonSoft}`} type="button" disabled={bookingSaving} onClick={() => void cancelProjectSession(session)}>Cancelar</button>}</span></div>; })}</div>}</div>}
      </div>
      <p className={styles.muted}>{editingEngagementId ? "Modo de edição: altere os dados da contratação do cliente." : "Contrato gera entrada e parcelas no módulo Financeiro, sem cobrança duplicada das sessões."}</p>
      <footer className={styles.modalActions}>{editingEngagement && <div className={styles.signDateField}><Field label="Data da assinatura"><input aria-label="Data da assinatura" type="date" value={signingDate} onChange={(event) => setSigningDate(event.target.value)} /></Field></div>}<button className={`${styles.button} ${styles.buttonSoft}`} type="button" onClick={closeEngagementModal}>Cancelar</button><button className={styles.button} type="button" disabled={saving || !engagementCustomerId || !engagementPackageId || !engagementEntryDueOn || !engagementFirstDueOn} onClick={() => void saveEngagement()}>{saving ? "Salvando…" : editingEngagementId ? "Salvar alterações" : "Criar contrato"}</button></footer>
    </Modal>}
    {bookingSession && (() => {
      const bookingEngagement = props.engagements.find((item) => item.id === bookingSession.engagement_id);
      const assignments = (props.packageServiceAssignments ?? []).filter((item) => item.project_package_id === bookingEngagement?.package_id);
      const professionals = [...new Map(assignments.map((assignment) => [assignment.barber_id, props.barbers.find((barber) => barber.id === assignment.barber_id)]).filter((entry): entry is [string, Props["barbers"][number]] => Boolean(entry[1]))).values()];
      const services = assignments.filter((assignment) => assignment.barber_id === bookingProfessionalId).map((assignment) => ({ assignment, service: props.services.find((service) => service.id === assignment.service_id) })).filter((item): item is { assignment: typeof assignments[number]; service: Props["services"][number] } => Boolean(item.service));
      const bookingCustomer = bookingEngagement ? customerById.get(bookingEngagement.customer_id) : null;
      return <Modal title="Reserve um horário" onClose={closeProjectSessionBooking}><div className={styles.form}><p className={styles.muted}>Sessão {bookingSession.session_number} · cliente e pacote contratado ficam vinculados ao atendimento.</p><Field label="Pessoa atendida" wide><select value={bookingAttendeeDependentId} onChange={(event) => setBookingAttendeeDependentId(event.target.value)}><option value="">Cliente titular</option>{(bookingCustomer?.dependents ?? []).map((dependent) => <option key={dependent.id} value={dependent.id}>{dependent.full_name}</option>)}</select></Field><Field label="Profissional" wide><select value={bookingProfessionalId} onChange={(event) => { const barberId = event.target.value; const first = assignments.find((assignment) => assignment.barber_id === barberId); const serviceId = first?.service_id ?? ""; setBookingProfessionalId(barberId); setBookingServiceId(serviceId); void loadBookingEnvironments(bookingSession, barberId, serviceId, bookingDate, bookingTime); }}><option value="">Selecione</option>{professionals.map((barber) => <option value={barber.id} key={barber.id}>{barber.display_name}</option>)}</select></Field><Field label="Serviço do pacote" wide><select value={bookingServiceId} onChange={(event) => { const serviceId = event.target.value; setBookingServiceId(serviceId); void loadBookingEnvironments(bookingSession, bookingProfessionalId, serviceId, bookingDate, bookingTime); }} disabled={!services.length}><option value="">Selecione</option>{services.map(({ service }) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></Field><Field label="Data"><span className="input-shell"><CalendarDays size={16} /><input type="date" value={bookingDate} min={new Date().toISOString().slice(0, 10)} onChange={(event) => { const date = event.target.value; setBookingDate(date); void loadBookingEnvironments(bookingSession, bookingProfessionalId, bookingServiceId, date, bookingTime); }} /></span></Field><Field label="Hora"><span className="input-shell"><Clock3 size={16} /><input type="time" value={bookingTime} onChange={(event) => { const time = event.target.value; setBookingTime(time); void loadBookingEnvironments(bookingSession, bookingProfessionalId, bookingServiceId, bookingDate, time); }} /></span></Field><Field label="Ambiente" wide><select value={bookingEnvironmentId} onChange={(event) => setBookingEnvironmentId(event.target.value)} disabled={bookingAvailabilityLoading || !bookingProfessionalId || !bookingServiceId}><option value="">{bookingAvailabilityLoading ? "Consultando ambientes…" : bookingEnvironments.length ? "Selecione um ambiente disponível" : "Nenhuma sala disponível"}</option>{bookingEnvironments.map((environment) => <option value={environment.id} key={environment.id}>{environment.sort_order}º · {environment.name}</option>)}</select>{!bookingAvailabilityLoading && !bookingEnvironments.length && <small className={styles.muted}>Nenhuma cadeira/sala está livre para este profissional no dia e horário escolhidos.</small>}</Field></div><footer className={styles.modalActions}><button className={`${styles.button} ${styles.buttonSoft}`} type="button" onClick={closeProjectSessionBooking}>Cancelar</button><button className={styles.button} type="button" disabled={bookingSaving || bookingAvailabilityLoading || !bookingProfessionalId || !bookingServiceId || !bookingDate || !bookingTime || !bookingEnvironmentId} onClick={() => void bookProjectSession()}>{bookingSaving ? "Agendando…" : "Agendar sessão"}</button></footer></Modal>;
    })()}
    {newEngagementCustomerOpen && newEngagementOpen && <div className="modal-layer" role="presentation"><button className="modal-layer__backdrop" type="button" aria-label="Fechar cadastro de cliente" onClick={closeNewEngagementCustomer} /><form className="form-modal" role="dialog" aria-modal="true" aria-label="Novo cliente" onSubmit={(event) => void createEngagementCustomer(event)}>
      <div className="form-modal__head"><span><small>Cadastro manual</small><strong>Cadastre um cliente</strong></span><button type="button" className="icon-button" onClick={closeNewEngagementCustomer} aria-label="Fechar cadastro de cliente" disabled={newEngagementCustomerSaving}><X size={19} /></button></div>
      <div className="form-modal__body">
        <ActionMessage message={newEngagementCustomerMessage} tone="error" />
        <Field label="Nome completo"><input name="full_name" required minLength={2} maxLength={160} value={newEngagementCustomerName} onChange={(event) => setNewEngagementCustomerName(event.target.value)} autoFocus /></Field>
        <Field label="CPF/CNPJ"><input name="cpf_cnpj" inputMode="numeric" placeholder="CPF ou CNPJ" value={newEngagementCustomerCpfCnpj} onChange={(event) => setNewEngagementCustomerCpfCnpj(formatCpfCnpj(event.target.value))} /></Field>
        <Field label="Dependente (opcional)"><input name="dependent_full_name" value={newEngagementDependentName} onChange={(event) => setNewEngagementDependentName(event.target.value)} placeholder="Nome do dependente" /></Field>
        <Field label="Nascimento do dependente"><input name="dependent_birth_date" type="date" value={newEngagementDependentBirthDate} onChange={(event) => setNewEngagementDependentBirthDate(event.target.value)} /></Field>
        <Field label="Parentesco"><select name="dependent_relationship" value={newEngagementDependentRelationship} onChange={(event) => setNewEngagementDependentRelationship(event.target.value)}><option value="CHILD">Filho(a)</option><option value="SPOUSE">Cônjuge</option><option value="EMPLOYEE">Funcionário</option><option value="PARENT">Pai/Mãe</option><option value="OTHER">Outros</option></select></Field>
        <Field label="Telefone"><input name="phone_e164" inputMode="tel" placeholder="11999999999 ou +5511999999999" pattern="[+0-9][0-9\s().-]{7,20}" value={newEngagementCustomerPhone} onChange={(event) => setNewEngagementCustomerPhone(event.target.value)} /></Field>
        <Field label="E-mail"><input name="email" type="email" value={newEngagementCustomerEmail} onChange={(event) => setNewEngagementCustomerEmail(event.target.value)} /></Field>
        <Field label="Nascimento (opcional)"><input name="birth_date" type="date" value={newEngagementCustomerBirthDate} onChange={(event) => setNewEngagementCustomerBirthDate(event.target.value)} /></Field>
        <Field label="Observações" wide><textarea name="notes" maxLength={1000} value={newEngagementCustomerNotes} onChange={(event) => setNewEngagementCustomerNotes(event.target.value)} /></Field>
      </div>
      <div className="form-modal__footer"><button className="button button--ghost" type="button" onClick={closeNewEngagementCustomer} disabled={newEngagementCustomerSaving}>Cancelar</button><button className="button button--dark" type="submit" disabled={newEngagementCustomerSaving}>{newEngagementCustomerSaving ? "Cadastrando…" : "Cadastrar"}</button></div>
    </form></div>}
    {eventEditorEngagementId && (() => {
      const engagement = eventEditorEngagement ?? props.engagements.find((item) => item.id === eventEditorEngagementId);
      const eventProject = props.projects.find((project) => project.id === engagement?.project_id);
      const board = props.kanbanBoards.find((item) => item.id === engagement?.kanban_board_id);
      const customer = engagement ? customerById.get(engagement.customer_id) : null;
      if (!engagement || !eventProject) return null;
      const eventLinks: Array<{ label: string; title: string; value: string; setTitle: (value: string) => void; setter: (value: string) => void }> = [
        { label: "Link 1", title: eventLinkTitle1, value: eventLink1, setTitle: setEventLinkTitle1, setter: setEventLink1 },
        { label: "Link 2", title: eventLinkTitle2, value: eventLink2, setTitle: setEventLinkTitle2, setter: setEventLink2 },
        { label: "Link 3", title: eventLinkTitle3, value: eventLink3, setTitle: setEventLinkTitle3, setter: setEventLink3 },
      ];
      return <Modal title={board?.name ?? "Evento"} wide onClose={closeEventEditor}>
          <div className={styles.eventModalLayout}>
          <div className={styles.eventMain}>
            <div className={styles.eventContext}><div><span>Data recebido</span><strong>{dateTimeLabel(engagement.kanban_received_at ?? engagement.created_at)}</strong><small>{engagement.kanban_received_by_name ?? "Usuário"}</small></div><label><span>Data prazo</span><input aria-label="Data prazo" type="date" value={eventDueOn} onChange={(event) => setEventDueOn(event.target.value)} /></label></div>
            {board && <ProjectInternalServiceCard organizationId={props.organizationId} projectId={eventProject.id} engagementId={engagement.id} board={board} barberName={props.barbers.find((item) => item.id === board.responsible_barber_id)?.display_name ?? "Responsável do quadro"} barbers={props.barbers} packageAssignments={(props.packageServiceAssignments ?? []).filter((item) => item.project_package_id === engagement.package_id && item.barber_id === board.responsible_barber_id)} services={props.services} existing={(props.internalServices ?? []).find((item) => item.engagement_id === engagement.id && item.kanban_board_id === board.id) ?? null} onSaved={() => router.refresh()} />}
            <Field label="Cliente" wide><input aria-label="Cliente do evento" value={customer?.full_name ?? "Cliente não informado"} readOnly /></Field>
            <Field label="Descrição" wide><textarea aria-label="Descrição do evento" value={eventDescription} onChange={(event) => setEventDescription(event.target.value)} placeholder="Adicione detalhes para orientar a execução…" rows={6} /></Field>
            <section className={styles.eventLinks} aria-labelledby="event-links-title"><h3 id="event-links-title">Links</h3>{eventLinks.map(({ label, title, value, setTitle, setter }) => <Field label={label} wide key={label}><div className={styles.eventLinkField}><input aria-label={`${label} - Título`} type="text" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Título" /><input aria-label={`${label} - URL`} type="url" value={value} onChange={(event) => setter(event.target.value)} placeholder="https://" />{value.trim() && <a href={externalLink(value)} target="_blank" rel="noreferrer">Abrir link</a>}</div></Field>)}{(props.projectEngagementLinks ?? []).filter((link) => link.engagement_id === eventEditorEngagementId && link.created_by_role === "BARBER").map((link) => <p key={link.id}><a href={link.url} target="_blank" rel="noreferrer">{link.label}</a> · adicionado pelo profissional</p>)}</section>
            <footer className={styles.modalActions}><button className={`${styles.button} ${styles.buttonSoft}`} type="button" onClick={closeEventEditor}>Cancelar</button><button className={styles.button} type="button" disabled={saving} onClick={() => void saveEventDetails()}>{saving ? "Salvando…" : "Salvar evento"}</button></footer>
          </div>
          <aside className={styles.eventComments} aria-label="Comentários"><div className={styles.eventCommentsHeader}><h3>Comentários</h3><span>{eventComments.length}</span></div><Field label={editingCommentId ? "Editar comentário" : "Adicionar comentário"} wide><textarea aria-label={editingCommentId ? "Editar comentário" : "Adicionar comentário"} value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} placeholder="Escreva uma atualização para a equipe…" rows={4} /></Field><button className={`${styles.button} ${styles.buttonSoft}`} type="button" disabled={savingComment || !commentDraft.trim()} onClick={() => void saveEventComment()}>{savingComment ? "Salvando…" : editingCommentId ? "Salvar comentário" : "Adicionar comentário"}</button>{eventCommentsLoading ? <p className={styles.muted}>Carregando comentários…</p> : eventComments.length === 0 ? <p className={styles.muted}>Nenhum comentário ainda.</p> : <div className={styles.eventCommentList}>{eventComments.map((comment) => <article className={styles.eventComment} key={comment.id}><p>{comment.body}</p><footer><span>{comment.author_name} · {dateTimeLabel(comment.created_at)}</span><button type="button" onClick={() => { setEditingCommentId(comment.id); setCommentDraft(comment.body); }}>Editar</button></footer></article>)}</div>}</aside>
        </div>
      </Modal>;
    })()}
    {receivingInstallment && <Modal title="Receber parcela" wide onClose={() => setReceivingInstallment(null)}><form className={styles.form} onSubmit={(event) => { event.preventDefault(); void receiveInstallment(event.currentTarget); }}>
      <Field label="Contraparte / Cliente"><input value={customerById.get(projectEngagements.find((item) => item.id === receivingInstallment.engagement_id)?.customer_id ?? "")?.full_name ?? "Cliente do contrato"} readOnly /></Field>
      <Field label="Tipo"><input value="Receita" readOnly /></Field>
      <Field label="Descrição" wide><input value={`Parcela ${receivingInstallment.installment_number} do contrato de projeto`} readOnly /></Field>
      <Field label="Saldo restante"><input value={centsInput(receivingInstallment.remaining_cents ?? receivingInstallment.amount_cents)} readOnly /></Field>
      <Field label="Valor final lançado (R$)"><input name="amount" required inputMode="decimal" defaultValue={centsInput(receivingInstallment.remaining_cents ?? receivingInstallment.amount_cents)} /></Field>
      <Field label="Data do lançamento"><input name="issue_date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} readOnly /></Field>
      <Field label="Vencimento"><input name="due_date" type="date" defaultValue={receivingInstallment.due_on} readOnly /></Field>
      <Field label="Data de recebimento"><input name="settled_on" type="date" required defaultValue={localTodayInputValue()} /></Field>
      <Field label="Plano de conta"><select name="chart_account_id" required defaultValue={props.chartAccounts?.find((item) => item.active && item.kind === "REVENUE")?.id ?? ""}><option value="" disabled>Selecione</option>{(props.chartAccounts ?? []).filter((item) => item.active && item.kind === "REVENUE").map((item) => <option key={item.id} value={item.id}>{item.code ? `${item.code} · ` : ""}{item.name}</option>)}</select></Field>
      <Field label="Banco ou caixa"><select name="financial_account_id" required defaultValue={(props.financialAccounts ?? []).find((item) => item.active)?.id ?? ""}><option value="" disabled>Selecione</option>{(props.financialAccounts ?? []).filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
      <Field label="Centro de custo"><select name="cost_center_id" defaultValue=""><option value="">Não informar</option>{(props.costCenters ?? []).filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
      <Field label="Número do documento"><input name="document_number" defaultValue={`PROJ-${receivingInstallment.id.slice(0, 8)}`} required /></Field>
      <Field label="Tags"><select name="tag_ids" multiple size={Math.min(Math.max((props.tags ?? []).filter((item) => item.active).length, 2), 4)} disabled={(props.tags ?? []).filter((item) => item.active).length === 0}>{(props.tags ?? []).filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
      <Field label="Forma de recebimento"><select name="payment_method" defaultValue="CASH"><option value="CASH">Dinheiro</option><option value="PIX">PIX</option><option value="CARD">Cartão</option><option value="TRANSFER">Transferência</option><option value="OTHER">Outro</option></select></Field>
      <Field label="Observações" wide><input name="reference" placeholder="PIX, NSU ou comprovante" /></Field>
      <footer className={styles.modalActions}><button className={`${styles.button} ${styles.buttonSoft}`} type="button" onClick={() => setReceivingInstallment(null)}>Cancelar</button><button className={styles.button} type="submit" disabled={saving}>Confirmar recebimento</button></footer>
    </form></Modal>}
    {editingInstallment && <Modal title="Editar parcela" onClose={() => setEditingInstallment(null)}><form className={styles.form} onSubmit={(event) => { event.preventDefault(); void updateInstallment(event.currentTarget); }}><Field label="Valor"><input name="amount" inputMode="decimal" defaultValue={centsInput(editingInstallment.amount_cents)} /></Field><Field label="Data vencimento"><input name="due_on" type="date" defaultValue={editingInstallment.due_on} /></Field><footer className={styles.modalActions}><button className={`${styles.button} ${styles.buttonSoft}`} type="button" onClick={() => setEditingInstallment(null)}>Cancelar</button><button className={styles.button} type="submit">Salvar parcela</button></footer></form></Modal>}
  </div>;
}

const costKindLabels: Record<CostKind, string> = { FIXED: "Custos Fixos", INVESTMENT: "Investimentos" };
const costKindDescriptions: Record<CostKind, string> = {
  FIXED: "Despesas que existem independentemente do projeto e entram no rateio operacional.",
  INVESTMENT: "Desembolsos iniciais para estrutura, itens essenciais e divulgação do projeto.",
};

function ProjectInvestments({ organizationId, projectId, goalContracts, items }: { organizationId: string; projectId: string; goalContracts: number | null; items: ProjectCostItemRecord[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(items);
  const [kind, setKind] = useState<CostKind>("FIXED");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const totals = (value: CostKind) => rows.filter((item) => item.kind === value && item.active).reduce((sum, item) => sum + item.amount_cents, 0);
  const fixedTotal = totals("FIXED");
  const investmentTotal = totals("INVESTMENT");
  const total = fixedTotal + investmentTotal;
  const allocationTotal = fixedTotal + investmentTotal;
  const allocationPerContract = goalContracts && goalContracts > 0 ? Math.round(allocationTotal / goalContracts) : null;

  async function addCostItem(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !name.trim()) return;
    let savedItem: ProjectCostItemRecord | null = null;
    setSaving(true);
    const saved = await runMutation(setMessage, async () => {
      const result = await connectedClient().rpc("upsert_project_cost_item", {
        p_organization_id: organizationId,
        p_project_id: projectId,
        p_id: null,
        p_kind: kind,
        p_name: name,
        p_description: description,
        p_amount_cents: safeCentsInput(amount),
      });
      await assertResult(result);
      const row = Array.isArray(result.data) ? result.data[0] : result.data;
      if (row && typeof row === "object") savedItem = row as ProjectCostItemRecord;
    }, "Custo adicionado.");
    setSaving(false);
    if (saved && savedItem) {
      setRows((current) => [savedItem as ProjectCostItemRecord, ...current]);
      setName("");
      setDescription("");
      setAmount("");
      router.refresh();
    }
  }

  async function removeCostItem(item: ProjectCostItemRecord) {
    if (saving) return;
    setSaving(true);
    const removed = await runMutation(setMessage, async () => {
      await assertResult(await connectedClient().rpc("delete_project_cost_item", { p_organization_id: organizationId, p_project_id: projectId, p_id: item.id }));
    }, "Custo removido.");
    setSaving(false);
    if (removed) {
      setRows((current) => current.filter((row) => row.id !== item.id));
      router.refresh();
    }
  }

  return <div className={styles.investmentWorkspace}>
    <header className={styles.sectionHeader}><div><h2>Investimentos</h2><p>Organize custos fixos e desembolsos iniciais para precificar o projeto com clareza.</p></div><div className={styles.investmentTotal}><span>Total cadastrado</span><strong>{formatCents(total)}</strong></div></header>
    <ActionMessage message={message} />
    <div className={styles.investmentMetrics} aria-label="Resumo de custos do projeto"><article><span>Custos fixos</span><strong>{formatCents(fixedTotal)}</strong><small>rateados na operação</small></article><article><span>Investimentos</span><strong>{formatCents(investmentTotal)}</strong><small>desembolso inicial</small></article></div>
    <form className={styles.investmentAddForm} onSubmit={(event) => void addCostItem(event)}><div className={styles.investmentFormTitle}><Landmark size={16} /><strong>Adicionar custo ou investimento</strong></div><div className={styles.investmentFormGrid}><Field label="Item / descrição"><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Cenário, aluguel, internet…" /></Field><Field label="Categoria"><select value={kind} onChange={(event) => setKind(event.target.value as CostKind)}>{Object.entries(costKindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field label="Valor (R$)"><input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0,00" /></Field><Field label="Observação" wide><input value={description} onChange={(event) => setDescription(event.target.value)} placeholder={kind === "INVESTMENT" ? "Ex.: Agência terceirizada ou campanha de ads" : "Detalhe opcional do custo"} /></Field></div><button className={styles.button} type="submit" disabled={saving || !name.trim()}><Plus size={15} /> Adicionar</button></form>
    <div className={styles.investmentSections}>{(Object.keys(costKindLabels) as CostKind[]).map((sectionKind) => { const sectionItems = rows.filter((item) => item.kind === sectionKind && item.active); return <section className={styles.investmentSection} key={sectionKind}><header><div><h3>{costKindLabels[sectionKind]}</h3><p>{costKindDescriptions[sectionKind]}</p></div><strong>{formatCents(totals(sectionKind))}</strong></header>{sectionItems.length ? <div className={styles.investmentList}>{sectionItems.map((item) => <div className={styles.investmentRow} key={item.id}><span className={styles.investmentDot} /><span className={styles.rowTitle}><strong>{item.name}</strong><small>{item.description || "Custo do projeto"}</small></span><strong>{formatCents(item.amount_cents)}</strong><button className={`${styles.button} ${styles.buttonSoft} ${styles.iconButton}`} type="button" aria-label={`Remover ${item.name}`} title="Remover" disabled={saving} onClick={() => void removeCostItem(item)}><X size={14} /></button></div>)}</div> : <p className={styles.investmentEmpty}>Nenhum item cadastrado nesta categoria.</p>}</section>; })}</div>
    <div className={styles.investmentAllocation}><div><strong>Rateio estimado do projeto</strong><p>Custos fixos + investimentos iniciais divididos pela meta de contratações.</p></div><div className={styles.investmentFormula}><span>{formatCents(allocationTotal)} ÷ {goalContracts && goalContracts > 0 ? `${goalContracts} contratações` : "meta não definida"}</span><strong>{allocationPerContract === null ? "—" : formatCents(allocationPerContract)}</strong></div></div>
  </div>;
}

type PackageServiceInput = { serviceId: string; barberId: string; commission: string };

function ProjectPackages({ packages, barbers, barberServices, services, fixedCostCents, savingId, onAdd, onChange, onSave }: { packages: PackageDraft[]; barbers: Props["barbers"]; barberServices: NonNullable<Props["barberServices"]>; services: Props["services"]; fixedCostCents: number; savingId: string | null; onAdd: () => void; onChange: (index: number, patch: Partial<PackageDraft>) => void; onSave: (draft: PackageDraft) => Promise<string | null> }) {
  const [message, setMessage] = useState("");
  const [serviceInputs, setServiceInputs] = useState<Record<string, PackageServiceInput>>({});
  const [collapsedBreakdowns, setCollapsedBreakdowns] = useState<Record<string, boolean>>({});

  function addServiceInput(key: string) {
    setMessage("");
    setServiceInputs((current) => ({ ...current, [key]: { serviceId: "", barberId: "", commission: "" } }));
  }

  function updateServiceInput(key: string, patch: Partial<PackageServiceInput>) {
    setServiceInputs((current) => ({ ...current, [key]: { ...current[key], ...patch } }));
  }

  async function saveServiceInput(index: number, key: string, draft: PackageDraft) {
    const input = serviceInputs[key];
    if (!input?.serviceId || !input.barberId || !input.commission.trim()) {
      setMessage("Selecione o serviço e o profissional e informe a comissão.");
      return;
    }
    let commissionCents: number;
    try {
      commissionCents = centsFromInput(input.commission);
    } catch {
      setMessage("Informe um valor válido para a comissão.");
      return;
    }
    const eligible = barberServices.some((link) => link.service_id === input.serviceId && link.barber_id === input.barberId);
    if (!eligible) {
      setMessage("O profissional selecionado não está habilitado para este serviço.");
      return;
    }
    if (draft.serviceAssignments.some((assignment) => assignment.service_id === input.serviceId && assignment.barber_id === input.barberId)) {
      setMessage("Este profissional já foi vinculado a este serviço no pacote.");
      return;
    }
    const serviceAssignment = { service_id: input.serviceId, barber_id: input.barberId, commission_cents: commissionCents };
    const nextDraft = { ...draft, serviceAssignments: [...draft.serviceAssignments, serviceAssignment] };
    if (!draft.id) {
      onChange(index, { serviceAssignments: nextDraft.serviceAssignments });
      setServiceInputs((current) => { const next = { ...current }; delete next[key]; return next; });
      setMessage("");
      return;
    }
    const savedPackageId = await onSave(nextDraft);
    if (!savedPackageId) return;
    onChange(index, { id: savedPackageId, serviceAssignments: nextDraft.serviceAssignments });
    setServiceInputs((current) => { const next = { ...current }; delete next[key]; return next; });
    setMessage("");
  }

  function removeServiceAssignment(index: number, draft: PackageDraft, assignmentIndex: number) {
    onChange(index, { serviceAssignments: draft.serviceAssignments.filter((_, itemIndex) => itemIndex !== assignmentIndex) });
  }

  return <div className={styles.packageWorkspace}>
    <header className={styles.sectionHeader}><div><h2>Pacotes</h2><p>Crie até quatro ofertas para este projeto e compare preço sugerido com o valor praticado.</p></div><div className={styles.toolbarGroup}><button className={`${styles.button} ${styles.buttonSoft}`} type="button" onClick={() => setMessage("Função em desenvolvimento")}><BriefcaseBusiness size={15} /> Adicionar Contrato</button><button className={styles.button} type="button" onClick={onAdd} disabled={packages.length >= 4 || Boolean(savingId)}><Plus size={16} /> Adicionar pacote ({packages.length}/4)</button></div></header>
    <ActionMessage message={message} />
    {packages.length === 0 ? <EmptyState title="Nenhum pacote configurado">Adicione o primeiro pacote para começar a vender este projeto.</EmptyState> : <div className={styles.packageGrid}>
      {packages.map((draft, index) => {
        const pricing = packagePricing(draft, fixedCostCents);
        const isSaving = savingId === (draft.id ?? "new");
        const key = draft.id ?? `new-${index}`;
        const breakdownCollapsed = Boolean(collapsedBreakdowns[key]);
        const breakdownContentId = `package-breakdown-${key}`;
        const serviceInput = serviceInputs[key];
        const eligibleBarbers = serviceInput?.serviceId
          ? barbers.filter((barber) => barberServices.some((link) => link.service_id === serviceInput.serviceId && link.barber_id === barber.id))
          : [];
        return <article className={styles.packageCard} key={key}>
          <header className={styles.packageCardHeader}><div className={styles.packageHeaderEditor}><span className={styles.packageBadge}>{index + 1}º pacote</span><input className={styles.packageTitleInput} aria-label={`Título do pacote ${index + 1}`} value={draft.name} onChange={(event) => onChange(index, { name: event.target.value })} placeholder="Experiência" /><textarea className={styles.packageSubtitleInput} aria-label={`Texto do pacote ${index + 1}`} value={draft.description} onChange={(event) => onChange(index, { description: event.target.value })} placeholder="Defina uma oferta com duração, sessões e preço próprio." rows={2} /></div><span className={styles.packageLimitLabel}>Pacote {index + 1}/4</span></header>
          <div className={styles.packagePriceHero}><span>Preço de Venda</span><strong>{formatCents(pricing.practiced)}</strong></div>
          <div className={styles.packageForm}>
            <div className={styles.packageFormGrid}><Field label="Duração da sessão (min)"><input type="number" min="5" max="14400" step="5" value={draft.durationMinutes} onChange={(event) => onChange(index, { durationMinutes: event.target.value })} /></Field><Field label="Total de sessões"><input type="number" min="1" max="100" value={draft.sessionsCount} onChange={(event) => onChange(index, { sessionsCount: event.target.value })} /></Field><Field label="Custo Fixo"><input className={styles.packageReadonlyField} inputMode="decimal" value={centsInput(pricing.fixedCostTotal)} readOnly aria-label="Custo Fixo" /></Field><Field label="Custos Extras (R$)"><input inputMode="decimal" value={draft.extraCosts} onChange={(event) => onChange(index, { extraCosts: event.target.value })} /></Field><Field label="Descrição dos Extras" wide><input value={draft.extraCostsDescription} onChange={(event) => onChange(index, { extraCostsDescription: event.target.value })} placeholder="Impressões, álbum, brindes…" /></Field><Field label="Impostos (%)"><input type="number" min="0" max="100" step="0.01" value={draft.taxRate} onChange={(event) => onChange(index, { taxRate: event.target.value })} /></Field><Field label="Taxas banco/cartão (%)"><input type="number" min="0" max="100" step="0.01" value={draft.cardRate} onChange={(event) => onChange(index, { cardRate: event.target.value })} /></Field><Field label="Margem de lucro (%)"><input type="number" min="0" max="100" step="0.01" value={draft.profitMargin} onChange={(event) => onChange(index, { profitMargin: event.target.value })} /></Field><Field label="Sinal/entrada (R$)"><input inputMode="decimal" value={draft.deposit} onChange={(event) => onChange(index, { deposit: event.target.value })} /></Field><Field label="Preço praticado"><input inputMode="decimal" value={draft.practicedPrice} onChange={(event) => onChange(index, { practicedPrice: event.target.value })} />{pricing.differencePercent !== null && <p className={`${styles.packagePriceDifference} ${pricing.difference >= 0 ? styles.packagePriceAbove : styles.packagePriceBelow}`}>{pricing.difference >= 0 ? "Acima" : "Abaixo"} do sugerido em {formatCents(Math.abs(pricing.difference))} ({Math.abs(pricing.differencePercent).toFixed(1).replace(".", ",")}%)</p>}{pricing.warning && <p className={styles.packagePriceWarning}>O preço está fugindo muito do padrão de precificação. Reavalie os custos e investimentos em relação ao total de vendas pretendido.</p>}</Field><Field label="Precificação Sugerida"><input className={styles.packageReadonlyField} inputMode="decimal" value={formatCents(pricing.suggested)} readOnly aria-label="Precificação Sugerida" /></Field></div>
            <div className={styles.packageServices}>
              <div className={styles.packageServicesHeader}><span className={styles.packageFieldLabel}>Serviços e profissionais do pacote</span><button className={`${styles.button} ${styles.buttonSoft}`} type="button" onClick={() => addServiceInput(key)} disabled={Boolean(serviceInput) || Boolean(savingId)}><Plus size={14} /> Adicionar serviço</button></div>
              {draft.serviceAssignments.length > 0 && <div className={styles.packageServiceList}>{draft.serviceAssignments.map((assignment, assignmentIndex) => {
                const service = services.find((item) => item.id === assignment.service_id);
                const barber = barbers.find((item) => item.id === assignment.barber_id);
                return <div className={styles.packageServiceAssignment} key={`${assignment.service_id}-${assignment.barber_id}`}><span>{service?.name ?? "Serviço"}</span><span>{barber?.display_name ?? "Profissional"}</span><strong>{formatCents(assignment.commission_cents)}</strong><button className={`${styles.button} ${styles.buttonSoft} ${styles.iconButton}`} type="button" aria-label={`Remover ${service?.name ?? "serviço"} - ${barber?.display_name ?? "profissional"}`} onClick={() => removeServiceAssignment(index, draft, assignmentIndex)}><Trash2 size={14} /></button></div>;
              })}</div>}
              {serviceInput && <div className={styles.packageAssignmentEditor}>
                <label className={`${styles.field} ${styles.packageAssignmentWideField}`}><span>Serviço</span><select aria-label={`Serviço do pacote ${index + 1}`} value={serviceInput.serviceId} onChange={(event) => updateServiceInput(key, { serviceId: event.target.value, barberId: "" })}><option value="">Selecione o serviço</option>{services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label>
                <label className={`${styles.field} ${styles.packageAssignmentWideField}`}><span>Profissional</span><select aria-label={`Profissional do serviço ${index + 1}`} value={serviceInput.barberId} onChange={(event) => updateServiceInput(key, { barberId: event.target.value })} disabled={!serviceInput.serviceId}><option value="">Selecione o profissional</option>{eligibleBarbers.map((barber) => <option key={barber.id} value={barber.id}>{barber.display_name}</option>)}</select>{!serviceInput.serviceId && <small className={styles.packageAssignmentHint}>Escolha um serviço para listar os profissionais habilitados.</small>}{serviceInput.serviceId && eligibleBarbers.length === 0 && <small className={`${styles.muted} ${styles.packageAssignmentHint}`}>Nenhum profissional habilitado para este serviço.</small>}</label>
                <label className={styles.field}><span>Comissão (R$)</span><input aria-label={`Comissão do serviço ${index + 1}`} inputMode="decimal" placeholder="0,00" value={serviceInput.commission} onChange={(event) => updateServiceInput(key, { commission: event.target.value })} /></label>
                <button className={`${styles.button} ${styles.buttonSoft} ${styles.iconButton}`} type="button" aria-label="Salvar serviço" title="Salvar serviço" onClick={() => void saveServiceInput(index, key, draft)} disabled={!serviceInput.serviceId || !serviceInput.barberId || !serviceInput.commission.trim() || Boolean(savingId)}><Save size={15} /></button>
                <button className={`${styles.button} ${styles.buttonSoft} ${styles.iconButton}`} type="button" aria-label="Cancelar serviço" title="Cancelar serviço" onClick={() => setServiceInputs((current) => { const next = { ...current }; delete next[key]; return next; })}><X size={15} /></button>
              </div>}
              {!services.length && <p className={styles.muted}>Nenhum serviço ativo disponível.</p>}
              {services.length > 0 && !draft.serviceAssignments.length && !serviceInput && <p className={styles.muted}>Nenhum serviço adicionado a este pacote.</p>}
            </div>
          </div>
          <div className={styles.packageBreakdown}><header className={`${styles.packageBreakdownHeader} ${breakdownCollapsed ? styles.packageBreakdownHeaderCollapsed : ""}`}><button className={styles.packageBreakdownToggle} type="button" aria-label={`${breakdownCollapsed ? "Expandir" : "Recolher"} decomposição do preço`} aria-expanded={!breakdownCollapsed} aria-controls={breakdownContentId} onClick={() => setCollapsedBreakdowns((current) => ({ ...current, [key]: !current[key] }))}><ChevronRight className={breakdownCollapsed ? "" : styles.packageBreakdownToggleExpanded} size={15} /></button><h4>Decomposição do preço</h4></header><div id={breakdownContentId} hidden={breakdownCollapsed}><dl><div><dt>Custo fixo</dt><dd>{formatCents(pricing.fixedCostTotal)} <small className={styles.packageBreakdownPercent}>{packagePriceShare(pricing.fixedCostTotal, pricing.practiced)}</small></dd></div><div><dt>Custos extras</dt><dd>{formatCents(pricing.extraCosts)} <small className={styles.packageBreakdownPercent}>{packagePriceShare(pricing.extraCosts, pricing.practiced)}</small></dd></div><div><dt>Custos com comissão</dt><dd>{formatCents(pricing.commissionCosts)} <small className={styles.packageBreakdownPercent}>{packagePriceShare(pricing.commissionCosts, pricing.practiced)}</small></dd></div><div className={styles.packageCostTotal}><dt>Custo total da entrega</dt><dd>{formatCents(pricing.costTotal)} <small className={styles.packageBreakdownPercent}>{packagePriceShare(pricing.costTotal, pricing.practiced)}</small></dd></div><div><dt>Impostos estimados</dt><dd>{formatCents(pricing.taxAmount)} <small className={styles.packageBreakdownPercent}>{packagePriceShare(pricing.taxAmount, pricing.practiced)}</small></dd></div><div><dt>Taxa cartão estimada</dt><dd>{formatCents(pricing.cardAmount)} <small className={styles.packageBreakdownPercent}>{packagePriceShare(pricing.cardAmount, pricing.practiced)}</small></dd></div><div><dt>Lucro estimado</dt><dd className={pricing.profit >= 0 ? styles.packagePositive : styles.packageNegative}>{formatCents(pricing.profit)} <small className={styles.packageBreakdownPercent}>{packagePriceShare(pricing.profit, pricing.practiced)}</small></dd></div><div><dt>Sinal de reserva</dt><dd>{formatCents(safeCentsInput(draft.deposit))} <small className={styles.packageBreakdownPercent}>{packagePriceShare(safeCentsInput(draft.deposit), pricing.practiced)}</small></dd></div></dl><div className={styles.packageBalance}><span>Saldo após o sinal</span><strong>{formatCents(pricing.practiced - safeCentsInput(draft.deposit))}{" "}<small className={styles.packageBalancePercent}>{packagePriceShare(pricing.practiced - safeCentsInput(draft.deposit), pricing.practiced)}</small></strong></div></div></div>
          <footer className={styles.packageCardActions}><button className={styles.button} type="button" disabled={Boolean(savingId) || !draft.name.trim()} onClick={() => void onSave(draft)}><Save size={15} /> {isSaving ? "Salvando…" : "Salvar pacote"}</button></footer>
        </article>;
      })}
    </div>}
  </div>;
}

function projectContractIsActive(engagement: Props["engagements"][number]) {
  return engagement.status !== "CANCELED" && Boolean(engagement.accepted_at);
}

function installmentReceivedCents(installment: Props["installments"][number]) {
  if (installment.status !== "PAID" && (installment.settled_cents ?? 0) <= 0) return 0;
  return (installment.settled_cents ?? 0) > 0 ? installment.settled_cents ?? 0 : installment.amount_cents;
}

function projectContractCostsCents(engagement: Props["engagements"][number], packageById: Map<string, Props["packages"][number]>) {
  const packageRecord = packageById.get(engagement.package_id);
  if (!packageRecord) return 0;
  const taxCents = Math.round(engagement.contracted_cents * packageRecord.tax_rate_bps / 10000);
  const cardCents = Math.round(engagement.contracted_cents * packageRecord.card_rate_bps / 10000);
  return packageRecord.extra_costs_cents + taxCents + cardCents;
}

function ProjectOverview({ goalContracts, projectCostItems, projectPackages, kanbanBoards, engagements, customerById, packageById, installments }: { goalContracts: number | null; projectCostItems: ProjectCostItemRecord[]; projectPackages: Props["packages"]; kanbanBoards: ProjectKanbanBoardRecord[]; engagements: Props["engagements"]; customerById: Map<string, Props["customers"][number]>; packageById: Map<string, Props["packages"][number]>; installments: Props["installments"] }) {
  const activeContracts = engagements.filter(projectContractIsActive);
  const soldCents = engagements.filter((item) => item.status !== "CANCELED").reduce((sum, item) => sum + item.contracted_cents, 0);
  const receivedCents = installments.filter((item) => engagements.some((engagement) => engagement.id === item.engagement_id && engagement.status !== "CANCELED")).reduce((sum, item) => sum + installmentReceivedCents(item), 0);
  const projectedCents = goalContracts && projectPackages[0] ? goalContracts * projectPackages[0].price_cents : 0;
  const investmentCents = projectCostItems.filter((item) => item.active).reduce((sum, item) => sum + item.amount_cents, 0);
  const activeContractCostsCents = activeContracts.reduce((sum, item) => sum + projectContractCostsCents(item, packageById), 0);
  const netProfitCents = receivedCents - investmentCents - activeContractCostsCents;
  const remainingContracts = goalContracts === null ? null : Math.max(0, goalContracts - activeContracts.length);
  const recentContracts = engagements
    .filter((item) => item.status !== "PROPOSAL" && Boolean(item.accepted_at))
    .sort((a, b) => new Date(b.accepted_at ?? b.created_at).getTime() - new Date(a.accepted_at ?? a.created_at).getTime())
    .slice(0, 10);

  return <div className={styles.stack}><div className={styles.projectStats}><article><span>Meta de contratos</span><strong>{activeContracts.length} / {goalContracts ?? "—"}</strong><small>{remainingContracts === null ? "Defina uma meta na criação do projeto" : remainingContracts > 0 ? `Faltam ${remainingContracts} ${remainingContracts === 1 ? "contrato" : "contratos"} para a meta` : "Meta de contratos atingida"}</small></article><article><span>Faturamento realizado</span><strong>{formatCents(soldCents)}</strong><div className={styles.projectStatDetails}><small>Projetado: {formatCents(projectedCents)}</small><small>Total recebido: {formatCents(receivedCents)}</small></div></article><article><span>Lucro líquido atual</span><strong>{formatCents(netProfitCents)}</strong><small>Recebido − investimentos − extras, impostos e taxas</small></article></div><div className={styles.projectColumns}><PackageClientSummary packages={projectPackages} engagements={engagements} /><KanbanFunnel boards={kanbanBoards} engagements={engagements} /></div><Panel title="Últimas movimentações" description="As 10 últimas contratações assinadas neste projeto.">{recentContracts.length ? <div className={styles.movementTableWrap}><table className={styles.movementTable}><thead><tr><th>Nome do cliente</th><th>Pacote contratado</th><th>Valor da entrada</th><th>Saldo do contrato</th><th>Data da assinatura do contrato</th></tr></thead><tbody>{recentContracts.map((item) => { const financials = engagementFinancials(item, installments); return <tr key={item.id}><td>{customerById.get(item.customer_id)?.full_name ?? "Cliente não informado"}</td><td>{packageById.get(item.package_id)?.name ?? "Pacote não informado"}</td><td>{formatCents(financials.entryCents)}</td><td>{formatCents(financials.balanceCents)}</td><td>{dateLabel((item.accepted_at ?? item.created_at).slice(0, 10))}</td></tr>; })}</tbody></table></div> : <EmptyState title="Nenhuma contratação assinada">Crie uma proposta e aguarde o aceite para iniciar a jornada.</EmptyState>}</Panel></div>;
}

function PackageClientSummary({ packages, engagements }: { packages: Props["packages"]; engagements: Props["engagements"] }) {
  const rows = packages.map((item) => ({
    ...item,
    clientCount: engagements.filter((engagement) => engagement.package_id === item.id && engagement.status !== "CANCELED").length,
  }));
  const maxCount = Math.max(1, ...rows.map((row) => row.clientCount));

  return <Panel title="Clientes por pacote" description="Pacotes publicados e total de clientes vinculados.">{rows.length ? <div className={styles.packageClientTableWrap}><table className={styles.packageClientTable} aria-label="Clientes por pacote"><thead><tr><th scope="col">#</th><th scope="col">Pacote publicado</th><th scope="col">Clientes</th></tr></thead><tbody>{rows.map((row, index) => { const width = row.clientCount > 0 ? Math.max(12, Math.round((row.clientCount / maxCount) * 100)) : 0; return <tr key={row.id}><td><span className={styles.packageClientIndex}>{index + 1}</span></td><th scope="row"><strong>{row.name}</strong><small>{row.sessions_count} sessões · {row.description || "Sem descrição"}</small><span className={styles.packageClientTrack}><span style={{ width: `${width}%` }} /></span></th><td><strong>{row.clientCount}</strong> {row.clientCount === 1 ? "cliente" : "clientes"}</td></tr>; })}</tbody></table></div> : <EmptyState title="Sem pacotes publicados">Adicione um pacote publicado para acompanhar seus clientes.</EmptyState>}</Panel>;
}

function KanbanFunnel({ boards, engagements }: { boards: ProjectKanbanBoardRecord[]; engagements: Props["engagements"] }) {
  const orderedBoards = [...boards].sort((a, b) => a.position - b.position);
  const counts = orderedBoards.map((board) => engagements.filter((item) => item.kanban_board_id === board.id || (!item.kanban_board_id && item.status === board.system_key)).length);
  const maxCount = Math.max(1, ...counts);
  return <Panel title="Funil Kanban" description={`${orderedBoards.length} ${orderedBoards.length === 1 ? "quadro" : "quadros"} no projeto; acompanhe os eventos por etapa.`}>{orderedBoards.length ? <div className={styles.kanbanFunnel} aria-label={`${orderedBoards.length} quadros no funil Kanban`}>{orderedBoards.map((board, index) => { const count = counts[index]; const width = count > 0 ? Math.max(24, Math.round((count / maxCount) * 100)) : 0; return <div className={styles.kanbanFunnelStage} key={board.id}><div className={styles.kanbanFunnelLabel}><span>{index + 1}</span><strong>{board.name}</strong><b>{count} {count === 1 ? "evento" : "eventos"}</b></div><div className={styles.kanbanFunnelTrack}><span style={{ width: `${width}%` }} /></div></div>; })}</div> : <EmptyState title="Nenhum quadro no Kanban">Adicione quadros na sub-tela Kanban para montar o funil.</EmptyState>}</Panel>;
}

function engagementFinancials(engagement: Props["engagements"][number], installments: Props["installments"]) {
  const schedule = installments.filter((item) => item.engagement_id === engagement.id).sort((a, b) => a.installment_number - b.installment_number || a.due_on.localeCompare(b.due_on));
  const entryCents = schedule.find((item) => item.installment_number === 0)?.amount_cents ?? 0;
  const payableRows = schedule.filter((item) => item.installment_number > 0);
  const balanceCents = Math.max(0, engagement.contracted_cents - entryCents);
  const totalInstallments = payableRows.length || 1;
  const paidInstallments = payableRows.length ? payableRows.filter((item) => item.status === "PAID").length : engagement.status === "COMPLETED" ? 1 : 0;
  const nextDueInstallment = payableRows.find((item) => item.status === "OPEN");
  const nextDueOn = nextDueInstallment?.due_on ?? null;
  const installmentAmountCents = payableRows[0]?.amount_cents ?? balanceCents;
  return { entryCents, balanceCents, totalInstallments, paidInstallments, installmentAmountCents, nextDueOn, overdue: schedule.some(installmentIsOverdue) };
}

function installmentIsOverdue(installment: Props["installments"][number] | undefined) {
  if (!installment || installment.status !== "OPEN" || (installment.remaining_cents ?? installment.amount_cents) <= 0) return false;
  const now = new Date();
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return installment.due_on < todayKey;
}

function internalServiceTone(status: string, deliveryOn: string | null) {
  if (status === "READY_FOR_REVIEW") return styles.internalServiceReady;
  if (status === "COMPLETED") return styles.internalServiceCompleted;
  if (!deliveryOn) return "";
  const now = new Date();
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  if (deliveryOn < todayKey) return styles.internalServiceOverdue;
  if (deliveryOn === todayKey) return styles.internalServiceDueToday;
  return "";
}

function ProjectInternalServiceCard({ organizationId, projectId, engagementId, internalCardId, board, barberName, barbers, packageAssignments, packages = [], services, existing, onSaved }: {
  organizationId: string; projectId: string; engagementId?: string | null; internalCardId?: string | null; board: ProjectKanbanBoardRecord; barberName: string; barbers: Props["barbers"];
  packageAssignments: Props["packageServiceAssignments"]; packages?: Props["packages"]; services: Props["services"];
  existing: ProjectEngagementInternalServiceRecord | null; onSaved: () => void;
}) {
  const [serviceDialogOpen, setServiceDialogOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [assignmentId, setAssignmentId] = useState("");
  const [draftAssignmentId, setDraftAssignmentId] = useState(existing?.package_assignment_id ?? "");
  const [commission, setCommission] = useState(centsInput(existing?.commission_cents ?? 0));
  const [deliveryOn, setDeliveryOn] = useState(existing?.delivery_on ?? "");
  const [record, setRecord] = useState(existing);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const availableAssignments = packageAssignments ?? [];
  const options = availableAssignments.flatMap((assignment) => {
    const service = services.find((item) => item.id === assignment.service_id && item.active);
    return service ? [{ assignment, service }] : [];
  });
  const selectedAssignment = options.find((option) => option.assignment.id === assignmentId) ?? null;

  async function saveInternalService() {
    if (!assignmentId || busy) return;
    let amountCents: number;
    try { amountCents = centsFromInput(commission); } catch { setMessage("Informe uma comissão válida em reais."); return; }
    if (amountCents < 0) { setMessage("A comissão não pode ser negativa."); return; }
    setBusy(true); setMessage("");
    const result = await runMutation(setMessage, async () => {
      const response = record?.id
        ? await connectedClient().rpc("manager_update_project_internal_service", {
          p_organization_id: organizationId, p_project_id: projectId, p_internal_service_id: record.id,
          p_commission_cents: amountCents, p_delivery_on: deliveryOn || null,
        })
        : internalCardId
        ? await connectedClient().rpc("upsert_project_kanban_internal_card_service", {
          p_organization_id: organizationId, p_project_id: projectId, p_internal_card_id: internalCardId,
          p_board_id: board.id, p_id: record?.id ?? null, p_service_assignment_id: assignmentId,
          p_commission_cents: amountCents, p_delivery_on: deliveryOn || null,
        })
        : await connectedClient().rpc("upsert_project_engagement_internal_service", {
          p_organization_id: organizationId, p_project_id: projectId, p_engagement_id: engagementId,
          p_board_id: board.id, p_id: record?.id ?? null, p_service_assignment_id: assignmentId,
          p_commission_cents: amountCents, p_delivery_on: deliveryOn || null,
        });
      await assertResult(response);
      const row = (Array.isArray(response.data) ? response.data[0] : response.data) as ProjectEngagementInternalServiceRecord | null;
      if (row) setRecord(row);
      else setRecord({ id: record?.id ?? "", organization_id: organizationId, project_id: projectId, engagement_id: engagementId ?? null, internal_card_id: internalCardId ?? null, kanban_board_id: board.id, package_assignment_id: assignmentId, service_id: selectedAssignment?.service.id ?? record?.service_id ?? "", service_name: selectedAssignment?.service.name ?? record?.service_name ?? "Serviço interno", barber_id: board.responsible_barber_id, commission_cents: amountCents, delivery_on: deliveryOn || null, status: "OPEN", commission_ledger_entry_id: null });
    }, "Serviço interno salvo.");
    setBusy(false);
    if (result) { setEditing(false); setServiceDialogOpen(false); onSaved(); }
  }

  async function completeInternalService() {
    if (!record?.id || busy) return;
    setBusy(true); setMessage("");
    const completed = await runMutation(setMessage, async () => {
      const response = await connectedClient().rpc("complete_project_engagement_internal_service", {
        p_organization_id: organizationId, p_internal_service_id: record.id,
        p_idempotency_key: `project-internal-service:${record.id}:commission:v1`,
      });
      await assertResult(response);
      const row = (Array.isArray(response.data) ? response.data[0] : response.data) as ProjectEngagementInternalServiceRecord | null;
      if (row) setRecord(row); else setRecord({ ...record, status: "COMPLETED" });
    }, "Serviço concluído. Comissão incluída em Comissões a pagar.");
    setBusy(false); setConfirmOpen(false);
    if (completed) onSaved();
  }

  async function deleteInternalService() {
    if (!record?.id || record.status !== "OPEN" || busy) return;
    setBusy(true); setMessage("");
    const deleted = await runMutation(setMessage, async () => {
      const response = await connectedClient().rpc("delete_project_engagement_internal_service", {
        p_organization_id: organizationId,
        p_id: record.id,
      });
      await assertResult(response);
      setRecord(null);
      setEditing(false);
    }, "Serviço interno excluído.");
    setBusy(false); setDeleteConfirmOpen(false);
    if (deleted) onSaved();
  }

  return <section className={`${styles.internalServiceCard} ${internalServiceTone(record?.status ?? "OPEN", record?.delivery_on ?? deliveryOn)}`} aria-label="Serviço Interno">
    <header><div><h3>Serviço Interno</h3><p>Responsável do quadro: <strong>{barberName}</strong></p></div>{!record && !(draftAssignmentId && editing) && <button className={`${styles.button} ${styles.buttonSoft}`} type="button" onClick={() => { setAssignmentId(""); setCommission("0,00"); setDeliveryOn(""); setServiceDialogOpen(true); }} disabled={options.length === 0}><Plus size={15} /> Adicionar Serviço Interno</button>}</header>
    {options.length === 0 && !record && <p className={styles.muted}>Não há serviços deste pacote vinculados ao responsável do quadro.</p>}
    {record && <div className={styles.internalServiceRow}>
      <div className={styles.internalServiceName}><strong>{record.service_name}</strong><small>Comissão para {barbers.find((item) => item.id === record.barber_id)?.display_name ?? barberName}</small></div>
      {editing ? <><label>Comissão (R$)<input aria-label="Comissão do serviço interno" inputMode="decimal" value={commission} onChange={(event) => setCommission(event.target.value)} /></label><label>Entrega<input aria-label="Entrega do serviço interno" type="date" value={deliveryOn} onChange={(event) => setDeliveryOn(event.target.value)} /></label></> : <><span>{formatCents(record.commission_cents)}</span><span>Entrega: {shortDateLabel(record.delivery_on)}</span></>}
      <div className={styles.internalServiceActions}>
        {record.status !== "COMPLETED" && editing && <button className={styles.iconButton} type="button" aria-label="Salvar serviço interno" title="Salvar" disabled={busy} onClick={() => void saveInternalService()}><Save size={16} /></button>}
        {record.status !== "COMPLETED" && !editing && <button className={styles.iconButton} type="button" aria-label="Editar serviço interno" title="Editar" onClick={() => { setCommission(centsInput(record.commission_cents)); setDeliveryOn(record.delivery_on ?? ""); setAssignmentId(record.package_assignment_id); setEditing(true); }}><Pencil size={16} /></button>}
        {record.status !== "COMPLETED" && !editing && <button className={`${styles.iconButton} ${styles.internalServicePay}`} type="button" aria-label="Concluir e gerar comissão a pagar" title="Concluir e gerar comissão a pagar" disabled={busy || !record.delivery_on} onClick={() => setConfirmOpen(true)}><CircleDollarSign size={17} /></button>}
        {record.status === "OPEN" && !editing && <button className={styles.iconButton} type="button" aria-label="Excluir serviço interno" title="Excluir serviço" disabled={busy} onClick={() => setDeleteConfirmOpen(true)}><Trash2 size={16} /></button>}
        {record.status === "READY_FOR_REVIEW" && <StatusChip active tone="success" label="Pronto para revisão" />}
        {record.status === "COMPLETED" && <StatusChip active tone="success" label="Concluído · comissão a pagar" />}
      </div>
    </div>}
    {message && <p className={styles.message} role="status">{message}</p>}
    {serviceDialogOpen && <Modal title="Adicionar Serviço Interno" onClose={() => setServiceDialogOpen(false)}>
      <div className={styles.form}>
        <p className={styles.muted}>{internalCardId ? "Serviços e comissões vêm dos pacotes do projeto e do responsável deste quadro." : "Serviços e comissões vêm do pacote e do responsável deste quadro."}</p>
        <Field label="Serviço interno"><select aria-label="Serviço interno" value={assignmentId} onChange={(event) => { const value = event.target.value; const option = options.find((item) => item.assignment.id === value); setAssignmentId(value); if (option) setCommission(centsInput(option.assignment.commission_cents)); }}><option value="">Selecione</option>{options.map(({ assignment, service }) => { const packageName = packages.find((pkg) => pkg.id === assignment.project_package_id)?.name; return <option key={assignment.id} value={assignment.id}>{packageName ? `${packageName} · ` : ""}{service.name} · {formatCents(assignment.commission_cents)}</option>; })}</select></Field>
        {selectedAssignment && <p className={styles.muted}>Comissão cadastrada no pacote: {formatCents(selectedAssignment.assignment.commission_cents)}</p>}
        <footer className={styles.modalActions}><button className={`${styles.button} ${styles.buttonSoft}`} type="button" onClick={() => setServiceDialogOpen(false)}>Cancelar</button><button className={styles.button} type="button" disabled={!assignmentId} onClick={() => { setDraftAssignmentId(assignmentId); setServiceDialogOpen(false); setEditing(true); }}>Adicionar serviço</button></footer>
      </div>
    </Modal>}
    {draftAssignmentId && editing && !record && <div className={styles.internalServiceDraft}>
      <strong>{options.find((item) => item.assignment.id === draftAssignmentId)?.service.name}</strong>
      <label>Comissão (R$)<input aria-label="Comissão do serviço interno" inputMode="decimal" value={commission} onChange={(event) => setCommission(event.target.value)} /></label>
      <label>Entrega<input aria-label="Entrega do serviço interno" type="date" value={deliveryOn} onChange={(event) => setDeliveryOn(event.target.value)} /></label>
      <div className={styles.internalServiceActions}><button className={styles.iconButton} type="button" aria-label="Salvar serviço interno" title="Salvar" disabled={busy} onClick={() => { setAssignmentId(draftAssignmentId); void saveInternalService(); }}><Save size={16} /></button><button className={styles.iconButton} type="button" aria-label="Cancelar serviço interno" title="Cancelar" onClick={() => { setDraftAssignmentId(""); setEditing(false); }}><X size={16} /></button></div>
    </div>}
    {confirmOpen && <Modal title="Confirmar geração de comissão" onClose={() => setConfirmOpen(false)}><div className={styles.form}><p>{(record?.commission_cents ?? 0) > 0 ? <>Concluir este serviço gerará uma comissão de <strong>{formatCents(record?.commission_cents ?? 0)}</strong> a pagar para {barberName}. Esta ação não realiza o pagamento agora.</> : <>A comissão cadastrada é <strong>R$ 0,00</strong>. O serviço será concluído sem gerar valor a pagar.</>}</p><footer className={styles.modalActions}><button className={`${styles.button} ${styles.buttonSoft}`} type="button" onClick={() => setConfirmOpen(false)}>Voltar</button><button className={styles.button} type="button" disabled={busy} onClick={() => void completeInternalService()}>Confirmar e concluir</button></footer></div></Modal>}
    {deleteConfirmOpen && <Modal title="Excluir serviço interno" onClose={() => setDeleteConfirmOpen(false)}><div className={styles.form}><p>Excluir <strong>{record?.service_name}</strong>? Só serviços sem conclusão podem ser excluídos. Essa ação não gera comissão.</p><footer className={styles.modalActions}><button className={`${styles.button} ${styles.buttonSoft}`} type="button" disabled={busy} onClick={() => setDeleteConfirmOpen(false)}>Manter serviço</button><button className={styles.button} type="button" disabled={busy} onClick={() => void deleteInternalService()}><Trash2 size={15} /> Excluir serviço</button></footer></div></Modal>}
  </section>;
}

function engagementSessionSummary(engagement: Props["engagements"][number], packageById: Map<string, Props["packages"][number]>, projectSessions: Props["projectSessions"]) {
  const sessions = projectSessions.filter((session) => session.engagement_id === engagement.id).sort((a, b) => a.session_number - b.session_number);
  const total = packageById.get(engagement.package_id)?.sessions_count ?? sessions.length;
  const latest = [...sessions].reverse().find((session) => session.status !== "OPEN") ?? sessions[0];
  if (!latest) return { label: `0/${total} Disponível`, tone: "neutral" as const };
  const appointment = latest.appointment;
  const statusLabel = appointment?.status === "CANCELED"
    ? (appointment.cancellation_outcome === "ON_TIME" ? "Cancelado no prazo" : "Cancelado após o prazo")
    : appointment
      ? projectAppointmentStatusLabels[appointment.status] ?? appointment.status
      : projectSessionStatusLabels[latest.status];
  const tone = appointment?.status === "CANCELED" || latest.status === "CANCELED" ? "danger" as const : appointment?.status === "IN_SERVICE" ? "warning" as const : latest.status === "COMPLETED" ? "success" as const : undefined;
  return { label: `${latest.status === "OPEN" ? 0 : latest.session_number}/${total} ${statusLabel}`, tone };
}

function EngagementsTable({ engagements, customerById, packageById, installments, projectSessions, kanbanBoards, onEdit }: { engagements: Props["engagements"]; customerById: Map<string, Props["customers"][number]>; packageById: Map<string, Props["packages"][number]>; installments: Props["installments"]; projectSessions: Props["projectSessions"]; kanbanBoards: ProjectKanbanBoardRecord[]; onEdit: (engagement: Props["engagements"][number]) => void }) {
  return <Panel title="Contratações" description="Uma contratação por cliente. Propostas continuam fora do fluxo ativo até o aceite.">{engagements.length ? <div className={styles.engagementTableWrap}><table className={styles.engagementTable}><thead><tr><th>Cliente</th><th>Pacote</th><th>Entrada</th><th>Parcelas</th><th>Valor</th><th>Vencimento</th><th>Saldo</th><th>Assinatura</th><th>Kanban</th><th>Sessões</th><th>Ações</th></tr></thead><tbody>{engagements.map((item) => { const financials = engagementFinancials(item, installments); const currentBoard = kanbanBoards.find((board) => board.id === item.kanban_board_id); const customerName = customerById.get(item.customer_id)?.full_name ?? "cliente"; const sessionSummary = engagementSessionSummary(item, packageById, projectSessions); return <tr className={financials.overdue ? styles.engagementOverdue : undefined} key={item.id}><td>{customerById.get(item.customer_id)?.full_name ?? "Cliente não informado"}</td><td>{packageById.get(item.package_id)?.name ?? "Pacote não informado"}</td><td>{formatCents(financials.entryCents)}</td><td>{financials.paidInstallments}/{financials.totalInstallments}</td><td>{formatCents(financials.installmentAmountCents)}</td><td>{shortDateLabel(financials.nextDueOn)}</td><td>{formatCents(financials.balanceCents)}</td><td>{item.accepted_at ? shortDateLabel(item.accepted_at.slice(0, 10)) : "Não assinada"}</td><td><span className={`${styles.statusSelect} ${currentBoard ? styles.statusSelectKanban : ""}`} aria-label={`Kanban atual da contratação de ${customerName}`}>{currentBoard?.name ?? "Sem quadro"}</span></td><td><StatusChip active={sessionSummary.tone !== "neutral"} label={sessionSummary.label} tone={sessionSummary.tone} /></td><td><button className={`${styles.button} ${styles.buttonSoft} ${styles.buttonSmall}`} type="button" onClick={() => onEdit(item)} aria-label={`Editar contratação de ${customerName}`}><Pencil size={14} /> Editar</button></td></tr>; })}</tbody></table></div> : <EmptyState title="Sem contratações">Use “Novo contrato” para criar a primeira contratação.</EmptyState>}</Panel>;
}

export function kanbanDeadlineTone(dueOn: string | null | undefined) {
  if (!dueOn) return "";
  const today = new Date();
  const todayKey = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const [year, month, day] = dueOn.split("-").map(Number);
  const dueKey = Date.UTC(year, month - 1, day);
  const daysUntil = Math.round((dueKey - todayKey) / 86400000);
  if (daysUntil < 0) return "overdue";
  if (daysUntil >= 7) return "green";
  if (daysUntil >= 3) return "yellow";
  if (daysUntil >= 1) return "orange";
  return "";
}

function kanbanReceivedLabel(value: string | null | undefined) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value ?? new Date().toISOString()));
}

function KanbanEventCard({ engagement, customerName, contextLabel, lastComment, dragging, onOpenEvent, onDueDateChange, onDragStart, onDragEnd }: { engagement: Props["engagements"][number]; customerName: string; contextLabel?: string; lastComment?: ProjectEngagementCommentPreview; dragging: boolean; onOpenEvent: () => void; onDueDateChange: (dueOn: string) => Promise<boolean> | void; onDragStart: (event: React.DragEvent<HTMLElement>) => void; onDragEnd: () => void }) {
  const tone = kanbanDeadlineTone(engagement.event_due_on);
  return <article className={`${styles.kanbanCard} ${tone ? styles[`kanbanCardDeadline${tone[0].toUpperCase()}${tone.slice(1)}` as keyof typeof styles] : ""}`} draggable onDoubleClick={onOpenEvent} onDragStart={onDragStart} onDragEnd={onDragEnd} title="Duplo clique para abrir o evento" data-dragging={dragging ? "true" : undefined}>
    <div className={styles.kanbanCardMeta}><div><small>Recebido</small><strong>{kanbanReceivedLabel(engagement.kanban_received_at ?? engagement.created_at)}</strong><em>{engagement.kanban_received_by_name ?? "Usuário"}</em></div><label><span>Prazo</span><input aria-label={`Data prazo de ${customerName}`} type="date" value={engagement.event_due_on ?? ""} onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()} onChange={(event) => void onDueDateChange(event.target.value)} /></label></div>
    {contextLabel && <small className={styles.kanbanCardContext}>{contextLabel}</small>}
    <strong>{customerName}</strong>
    {engagement.event_description && <p className={styles.kanbanCardDescription}>{engagement.event_description}</p>}
    {lastComment && <p className={styles.kanbanCardComment}><span>Último comentário</span>{lastComment.body}</p>}
  </article>;
}

function GeneralProjectKanban({ organizationId, sectors: initialSectors, boards, projects, engagements, engagementsWithDueDateOverrides, barbers, customerById, lastComments, onOpenEvent, onDueDateChange }: { organizationId: string; sectors: ProjectKanbanSectorRecord[]; boards: ProjectKanbanBoardRecord[]; projects: Props["projects"]; engagements: Props["engagements"]; engagementsWithDueDateOverrides: EventDueDateOverrides; barbers: Props["barbers"]; customerById: Map<string, Props["customers"][number]>; lastComments: Record<string, ProjectEngagementCommentPreview>; onOpenEvent: (engagement: Props["engagements"][number]) => void; onDueDateChange: (engagement: Props["engagements"][number], dueOn: string) => Promise<boolean> }) {
  const router = useRouter();
  const [sectors, setSectors] = useState<ProjectKanbanSectorRecord[]>(() => [...initialSectors].sort((a, b) => a.position - b.position));
  const [generalEngagements, setGeneralEngagements] = useState(() => engagements);
  const [editing, setEditing] = useState(false);
  const [responsibleFilter, setResponsibleFilter] = useState("ALL");
  const [projectFilter, setProjectFilter] = useState("ALL");
  const [savingSectorId, setSavingSectorId] = useState<string | null>(null);
  const [draggingEngagementId, setDraggingEngagementId] = useState<string | null>(null);
  const [dragOverSectorId, setDragOverSectorId] = useState<string | null>(null);
  const [newSectorOpen, setNewSectorOpen] = useState(false);
  const [newSectorName, setNewSectorName] = useState("");
  const [newSectorResponsibleId, setNewSectorResponsibleId] = useState(barbers[0]?.id ?? "");
  const [message, setMessage] = useState("");
  const [pendingMove, setPendingMove] = useState<{ engagementId: string; destinationSectorId: string; destinationBoardId: string; boards: ProjectKanbanBoardRecord[] } | null>(null);
  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const publishedProjectIds = useMemo(() => new Set(projects.filter((project) => project.status === "PUBLISHED").map((project) => project.id)), [projects]);
  const publishedProjects = useMemo(() => projects.filter((project) => publishedProjectIds.has(project.id)), [projects, publishedProjectIds]);
  const boardById = useMemo(() => new Map(boards.filter((board) => board.active && publishedProjectIds.has(board.project_id)).map((board) => [board.id, board])), [boards, publishedProjectIds]);
  const visibleEngagements = generalEngagements.filter((engagement) => {
    const board = boardById.get(engagement.kanban_board_id);
    const sector = sectors.find((item) => item.id === board?.sector_id);
    return publishedProjectIds.has(engagement.project_id) && Boolean(board?.sector_id) && (projectFilter === "ALL" || engagement.project_id === projectFilter) && (responsibleFilter === "ALL" || sector?.responsible_barber_id === responsibleFilter);
  });

  function cardsForSector(sector: ProjectKanbanSectorRecord) {
    return visibleEngagements.filter((engagement) => sectors.find((item) => item.id === boardById.get(engagement.kanban_board_id)?.sector_id)?.id === sector.id).map((engagement) => eventWithDueDateOverride(engagement, engagementsWithDueDateOverrides));
  }

  async function saveSector(sector: ProjectKanbanSectorRecord) {
    if (savingSectorId || !sector.name.trim() || !sector.responsible_barber_id) return;
    setSavingSectorId(sector.id);
    let updated: ProjectKanbanSectorRecord | null = null;
    const saved = await runMutation(setMessage, async () => {
      const result = await connectedClient().rpc("upsert_project_kanban_sector", { p_organization_id: organizationId, p_id: sector.id, p_name: sector.name, p_position: sector.position, p_responsible_barber_id: sector.responsible_barber_id });
      await assertResult(result);
      const row = Array.isArray(result.data) ? result.data[0] : result.data;
      if (row && typeof row === "object") updated = row as ProjectKanbanSectorRecord;
    }, "Setor atualizado.");
    setSavingSectorId(null);
    if (saved) {
      if (updated) setSectors((current) => current.map((item) => item.id === updated?.id ? updated as ProjectKanbanSectorRecord : item));
      router.refresh();
    }
  }

  async function createSector() {
    if (savingSectorId || !newSectorName.trim() || !newSectorResponsibleId) return;
    setSavingSectorId("new");
    let created: ProjectKanbanSectorRecord | null = null;
    const saved = await runMutation(setMessage, async () => {
      const result = await connectedClient().rpc("upsert_project_kanban_sector", { p_organization_id: organizationId, p_id: null, p_name: newSectorName, p_position: sectors.length + 1, p_responsible_barber_id: newSectorResponsibleId });
      await assertResult(result);
      const row = Array.isArray(result.data) ? result.data[0] : result.data;
      if (row && typeof row === "object") created = row as ProjectKanbanSectorRecord;
    }, "Setor adicionado.");
    setSavingSectorId(null);
    if (saved && created) {
      setSectors((current) => [...current, created as ProjectKanbanSectorRecord]);
      setNewSectorName("");
      setNewSectorResponsibleId(barbers[0]?.id ?? "");
      setNewSectorOpen(false);
      router.refresh();
    }
  }

  function requestMove(engagementId: string, destinationSectorId: string) {
    const engagement = generalEngagements.find((item) => item.id === engagementId);
    if (!engagement || savingSectorId) return;
    if (boardById.get(engagement.kanban_board_id)?.sector_id === destinationSectorId) return;
    const destinationBoards = boards.filter((board) => board.project_id === engagement.project_id && board.sector_id === destinationSectorId && board.active).sort((a, b) => a.position - b.position);
    if (!destinationBoards.length) {
      setMessage("Este setor não possui quadro deste projeto para receber o evento.");
      return;
    }
    setPendingMove({ engagementId, destinationSectorId, destinationBoardId: "", boards: destinationBoards });
  }

  async function moveEngagement(engagementId: string, destinationBoardId: string) {
    const engagement = generalEngagements.find((item) => item.id === engagementId);
    if (!engagement || savingSectorId) return false;
    const previousBoardId = engagement.kanban_board_id;
    const destinationBoard = boards.find((board) => board.id === destinationBoardId && board.project_id === engagement.project_id && board.active);
    if (!destinationBoard || previousBoardId === destinationBoard.id) return false;
    const previousReceivedAt = engagement.kanban_received_at;
    const previousReceivedByName = engagement.kanban_received_by_name;
    const previousDueOn = engagement.event_due_on;
    setGeneralEngagements((current) => current.map((item) => item.id === engagementId ? { ...item, kanban_board_id: destinationBoard.id, kanban_received_at: new Date().toISOString(), kanban_received_by_name: "Você", event_due_on: null } : item));
    setSavingSectorId(engagementId);
    const saved = await runMutation(setMessage, async () => {
      await assertResult(await connectedClient().rpc("move_project_engagement_to_kanban_board", { p_organization_id: organizationId, p_project_id: engagement.project_id, p_engagement_id: engagement.id, p_destination_board_id: destinationBoard.id }));
    }, "Evento movido para o setor destino.");
    setSavingSectorId(null);
    if (!saved) setGeneralEngagements((current) => current.map((item) => item.id === engagementId ? { ...item, kanban_board_id: previousBoardId, kanban_received_at: previousReceivedAt, kanban_received_by_name: previousReceivedByName, event_due_on: previousDueOn } : item));
    else router.refresh();
    return saved;
  }

  async function confirmMove() {
    if (!pendingMove?.destinationBoardId || savingSectorId) return;
    const request = pendingMove;
    const saved = await moveEngagement(request.engagementId, request.destinationBoardId);
    if (saved) setPendingMove(null);
  }

  return <section className={styles.generalKanbanPanel} aria-label="Kanban Geral dos projetos"><header className={styles.kanbanToolbar}><div><h2>Kanban Geral</h2><p>Visualize os eventos de todos os projetos por setor.</p></div><div className={styles.toolbarGroup}>{editing && <button className={`${styles.button} ${styles.buttonSoft}`} type="button" onClick={() => setNewSectorOpen(true)} disabled={Boolean(savingSectorId) || !barbers.length}><Plus size={15} /> Adicionar setor</button>}<button className={`${styles.button} ${editing ? styles.buttonSoft : ""}`} type="button" onClick={() => setEditing((current) => !current)} disabled={Boolean(savingSectorId)}><Pencil size={15} /> {editing ? "Concluir edição" : "Editar Kanban"}</button></div></header><div className={styles.generalKanbanFilters}><label><span>Responsável</span><select aria-label="Filtrar Kanban Geral por responsável" value={responsibleFilter} onChange={(event) => setResponsibleFilter(event.target.value)}><option value="ALL">Todos</option>{barbers.filter((barber) => sectors.some((sector) => sector.responsible_barber_id === barber.id)).map((barber) => <option key={barber.id} value={barber.id}>{barber.display_name}</option>)}</select></label><label><span>Projeto</span><select aria-label="Filtrar Kanban Geral por projeto" value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}><option value="ALL">Todos</option>{publishedProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label></div><ActionMessage message={message} />{sectors.length === 0 ? <EmptyState title="Nenhum setor configurado">Edite o Kanban Geral para adicionar o primeiro setor.</EmptyState> : <div className={styles.kanban}>{sectors.map((sector) => { const cards = cardsForSector(sector); return <section className={`${styles.kanbanLane} ${dragOverSectorId === sector.id ? styles.kanbanLaneDropTarget : ""}`} key={sector.id} onDragOver={(event) => { event.preventDefault(); setDragOverSectorId(sector.id); }} onDrop={(event) => { event.preventDefault(); const engagementId = event.dataTransfer.getData("text/plain") || draggingEngagementId; setDraggingEngagementId(null); setDragOverSectorId(null); if (engagementId) requestMove(engagementId, sector.id); }}><header><div className={styles.kanbanLaneTitle}>{editing ? <input aria-label={`Nome do setor ${sector.name}`} value={sector.name} onChange={(event) => setSectors((current) => current.map((item) => item.id === sector.id ? { ...item, name: event.target.value } : item))} /> : <strong>{sector.name}</strong>}{editing && <button className={`${styles.button} ${styles.buttonSoft} ${styles.iconButton}`} type="button" aria-label={`Salvar setor ${sector.name}`} disabled={savingSectorId === sector.id || !sector.name.trim() || !sector.responsible_barber_id} onClick={() => void saveSector(sector)}><Save size={14} /></button>}</div><span>{cards.length}</span></header><label className={styles.kanbanResponsible}><span>Responsável</span><select aria-label={`Responsável do setor ${sector.name}`} value={sector.responsible_barber_id} disabled={!editing || Boolean(savingSectorId)} onChange={(event) => setSectors((current) => current.map((item) => item.id === sector.id ? { ...item, responsible_barber_id: event.target.value } : item))}><option value="">Selecione</option>{barbers.map((barber) => <option value={barber.id} key={barber.id}>{barber.display_name}</option>)}</select></label>{cards.map((item) => <KanbanEventCard key={item.id} engagement={item} customerName={customerById.get(item.customer_id)?.full_name ?? "Cliente"} contextLabel={projectById.get(item.project_id)?.name ?? "Projeto"} lastComment={lastComments[item.id]} dragging={draggingEngagementId === item.id} onOpenEvent={() => onOpenEvent(item)} onDueDateChange={(dueOn) => void onDueDateChange(item, dueOn)} onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", item.id); setDraggingEngagementId(item.id); }} onDragEnd={() => { setDraggingEngagementId(null); setDragOverSectorId(null); }} />)}{cards.length === 0 && <p className={styles.kanbanEmpty}>Nenhum evento</p>}</section>; })}</div>}{pendingMove && <Modal title="Selecionar quadro destino" onClose={() => setPendingMove(null)}><div className={styles.form}><p className={styles.muted}>Escolha o quadro do projeto para o qual este evento será movido.</p><Field label="Quadro do projeto" wide><select aria-label="Quadro destino do evento" value={pendingMove.destinationBoardId} disabled={Boolean(savingSectorId)} onChange={(event) => setPendingMove((current) => current ? { ...current, destinationBoardId: event.target.value } : current)}><option value="">Selecione um quadro</option>{pendingMove.boards.map((board) => <option value={board.id} key={board.id}>{board.name}</option>)}</select></Field></div><footer className={styles.modalActions}><button className={`${styles.button} ${styles.buttonSoft}`} type="button" onClick={() => setPendingMove(null)} disabled={Boolean(savingSectorId)}>Cancelar</button><button className={styles.button} type="button" onClick={() => void confirmMove()} disabled={Boolean(savingSectorId) || !pendingMove.destinationBoardId}>Mover evento</button></footer></Modal>}{newSectorOpen && <Modal title="Adicionar setor ao Kanban Geral" onClose={() => setNewSectorOpen(false)}><div className={styles.form}><Field label="Nome do setor" wide><input aria-label="Nome do setor" value={newSectorName} onChange={(event) => setNewSectorName(event.target.value)} placeholder="Ex.: Comercial" autoFocus /></Field><Field label="Responsável" wide><select aria-label="Responsável do novo setor" value={newSectorResponsibleId} onChange={(event) => setNewSectorResponsibleId(event.target.value)}><option value="">Selecione um profissional</option>{barbers.map((barber) => <option value={barber.id} key={barber.id}>{barber.display_name}</option>)}</select></Field></div><footer className={styles.modalActions}><button className={`${styles.button} ${styles.buttonSoft}`} type="button" onClick={() => setNewSectorOpen(false)}>Cancelar</button><button className={styles.button} type="button" disabled={Boolean(savingSectorId) || !newSectorName.trim() || !newSectorResponsibleId} onClick={() => void createSector()}><Plus size={15} /> Adicionar</button></footer></Modal>}</section>;
}

function ProjectKanban({ organizationId, projectId, boards: initialBoards, sectors, barbers, engagements, internalCards: initialInternalCards, packageAssignments, packages, services, internalServices, engagementsWithDueDateOverrides, customerById, lastComments, onOpenEvent, onDueDateChange }: { organizationId: string; projectId: string; boards: ProjectKanbanBoardRecord[]; sectors: ProjectKanbanSectorRecord[]; barbers: Props["barbers"]; engagements: Props["engagements"]; internalCards: ProjectKanbanInternalCardRecord[]; packageAssignments: Props["packageServiceAssignments"]; packages: Props["packages"]; services: Props["services"]; internalServices: Props["internalServices"]; engagementsWithDueDateOverrides: EventDueDateOverrides; customerById: Map<string, Props["customers"][number]>; lastComments: Record<string, ProjectEngagementCommentPreview>; onOpenEvent: (engagement: Props["engagements"][number]) => void; onDueDateChange: (engagement: Props["engagements"][number], dueOn: string) => Promise<boolean> }) {
  const router = useRouter();
  const [boards, setBoards] = useState<KanbanBoardDraft[]>(() => [...initialBoards].sort((a, b) => a.position - b.position));
  const [kanbanEngagements, setKanbanEngagements] = useState(() => engagements);
  const [internalCards, setInternalCards] = useState(initialInternalCards);
  const [editing, setEditing] = useState(false);
  const [savingBoardId, setSavingBoardId] = useState<string | null>(null);
  const [savingEngagementId, setSavingEngagementId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [newBoardOpen, setNewBoardOpen] = useState(false);
  const [newBoardName, setNewBoardName] = useState("");
  const [newBoardResponsibleId, setNewBoardResponsibleId] = useState(barbers[0]?.id ?? "");
  const [newBoardSectorId, setNewBoardSectorId] = useState(sectors[0]?.id ?? "");
  const [pendingDelete, setPendingDelete] = useState<{ board: KanbanBoardDraft; cardsCount: number; destinationId: string } | null>(null);
  const [draggingEngagementId, setDraggingEngagementId] = useState<string | null>(null);
  const [draggingInternalCardId, setDraggingInternalCardId] = useState<string | null>(null);
  const [dragOverBoardId, setDragOverBoardId] = useState<string | null>(null);
  const [openInternalCard, setOpenInternalCard] = useState<ProjectKanbanInternalCardRecord | null>(null);
  const orderedBoards = [...boards].sort((a, b) => a.position - b.position);
  const cardsForBoard = (board: KanbanBoardDraft) => kanbanEngagements.filter((item) => item.kanban_board_id === board.id || (!item.kanban_board_id && item.status === board.system_key)).map((engagement) => eventWithDueDateOverride(engagement, engagementsWithDueDateOverrides));
  const internalCardsForBoard = (board: KanbanBoardDraft) => internalCards.filter((card) => card.kanban_board_id === board.id);

  function requestDelete(board: KanbanBoardDraft) {
    const cardsCount = cardsForBoard(board).length + internalCardsForBoard(board).length;
    setPendingDelete({ board, cardsCount, destinationId: orderedBoards.find((candidate) => candidate.id !== board.id)?.id ?? "" });
  }

  async function createStandaloneCard() {
    if (!orderedBoards.length || savingBoardId || savingEngagementId) return;
    setSavingEngagementId("new-internal-card");
    let created: ProjectKanbanInternalCardRecord | null = null;
    const saved = await runMutation(setMessage, async () => {
      const result = await connectedClient().rpc("create_project_kanban_internal_card", { p_organization_id: organizationId, p_project_id: projectId });
      await assertResult(result);
      const row = Array.isArray(result.data) ? result.data[0] : result.data;
      if (row && typeof row === "object") created = row as ProjectKanbanInternalCardRecord;
    }, "Card avulso criado no primeiro quadro.");
    setSavingEngagementId(null);
    if (saved && created) {
      setInternalCards((current) => [...current, created as ProjectKanbanInternalCardRecord]);
      router.refresh();
    }
  }

  async function moveStandaloneCard(cardId: string, destinationBoardId: string) {
    const card = internalCards.find((item) => item.id === cardId);
    if (!card || savingBoardId || savingEngagementId || card.kanban_board_id === destinationBoardId) return;
    const previousBoardId = card.kanban_board_id;
    setInternalCards((current) => current.map((item) => item.id === cardId ? { ...item, kanban_board_id: destinationBoardId } : item));
    setSavingEngagementId(cardId);
    const saved = await runMutation(setMessage, async () => {
      await assertResult(await connectedClient().rpc("move_project_kanban_internal_card", { p_organization_id: organizationId, p_project_id: projectId, p_internal_card_id: cardId, p_destination_board_id: destinationBoardId }));
    }, "Card movido para o quadro destino.");
    setSavingEngagementId(null);
    if (!saved) setInternalCards((current) => current.map((item) => item.id === cardId ? { ...item, kanban_board_id: previousBoardId } : item));
    else router.refresh();
  }

  async function saveBoard(board: KanbanBoardDraft) {
    if (savingBoardId || savingEngagementId || !board.name.trim() || !board.responsible_barber_id) return;
    setSavingBoardId(board.id);
    let updated: ProjectKanbanBoardRecord | null = null;
    const saved = await runMutation(setMessage, async () => {
      const rpcName = sectors.length ? "upsert_project_kanban_board_with_sector" : "upsert_project_kanban_board";
      const result = await connectedClient().rpc(rpcName, { p_organization_id: organizationId, p_project_id: projectId, p_id: board.id, p_name: board.name, p_position: board.position, p_responsible_barber_id: board.responsible_barber_id, ...(sectors.length ? { p_sector_id: board.sector_id || null } : {}) });
      await assertResult(result);
      const row = Array.isArray(result.data) ? result.data[0] : result.data;
      if (row && typeof row === "object") updated = row as ProjectKanbanBoardRecord;
    }, "Quadro atualizado.");
    setSavingBoardId(null);
    if (saved) {
      if (updated) setBoards((current) => current.map((item) => item.id === updated?.id ? updated as ProjectKanbanBoardRecord : item));
      router.refresh();
    }
  }

  async function createBoard() {
    if (savingBoardId || savingEngagementId || !newBoardName.trim() || !newBoardResponsibleId) return;
    setSavingBoardId("new");
    let created: ProjectKanbanBoardRecord | null = null;
    const saved = await runMutation(setMessage, async () => {
      const rpcName = sectors.length ? "upsert_project_kanban_board_with_sector" : "upsert_project_kanban_board";
      const result = await connectedClient().rpc(rpcName, { p_organization_id: organizationId, p_project_id: projectId, p_id: null, p_name: newBoardName, p_position: orderedBoards.length + 1, p_responsible_barber_id: newBoardResponsibleId, ...(sectors.length ? { p_sector_id: newBoardSectorId || null } : {}) });
      await assertResult(result);
      const row = Array.isArray(result.data) ? result.data[0] : result.data;
      if (row && typeof row === "object") created = row as ProjectKanbanBoardRecord;
    }, "Quadro adicionado.");
    setSavingBoardId(null);
    if (saved && created) {
      setBoards((current) => [...current, created as ProjectKanbanBoardRecord]);
      setNewBoardName("");
      setNewBoardResponsibleId(barbers[0]?.id ?? "");
      setNewBoardSectorId(sectors[0]?.id ?? "");
      setNewBoardOpen(false);
      router.refresh();
    }
  }

  async function deleteBoard() {
    if (!pendingDelete || savingBoardId || savingEngagementId || (pendingDelete.cardsCount > 0 && !pendingDelete.destinationId)) return;
    setSavingBoardId(pendingDelete.board.id);
    const saved = await runMutation(setMessage, async () => {
      await assertResult(await connectedClient().rpc("delete_project_kanban_board", { p_organization_id: organizationId, p_project_id: projectId, p_id: pendingDelete.board.id, p_destination_id: pendingDelete.cardsCount > 0 ? pendingDelete.destinationId : null }));
    }, pendingDelete.cardsCount > 0 ? "Quadro removido e cards movidos." : "Quadro removido.");
    setSavingBoardId(null);
    if (saved) {
      setBoards((current) => current.filter((board) => board.id !== pendingDelete.board.id));
      setPendingDelete(null);
      router.refresh();
    }
  }

  async function moveEngagement(engagementId: string, destinationBoardId: string) {
    if (savingBoardId || savingEngagementId) return;
    const engagement = kanbanEngagements.find((item) => item.id === engagementId);
    if (!engagement || engagement.kanban_board_id === destinationBoardId) return;
    const previousBoardId = engagement.kanban_board_id;
    const previousReceivedAt = engagement.kanban_received_at;
    const previousReceivedByName = engagement.kanban_received_by_name;
    const previousDueOn = engagement.event_due_on;
    setKanbanEngagements((current) => current.map((item) => item.id === engagementId ? { ...item, kanban_board_id: destinationBoardId, kanban_received_at: new Date().toISOString(), kanban_received_by_name: "Você", event_due_on: null } : item));
    setSavingEngagementId(engagementId);
    const saved = await runMutation(setMessage, async () => {
      const result = await connectedClient().rpc("move_project_engagement_to_kanban_board", { p_organization_id: organizationId, p_project_id: projectId, p_engagement_id: engagementId, p_destination_board_id: destinationBoardId });
      await assertResult(result);
    }, "Evento movido para o quadro destino.");
    setSavingEngagementId(null);
    if (!saved) setKanbanEngagements((current) => current.map((item) => item.id === engagementId ? { ...item, kanban_board_id: previousBoardId, kanban_received_at: previousReceivedAt, kanban_received_by_name: previousReceivedByName, event_due_on: previousDueOn } : item));
    else router.refresh();
  }

  function handleDragStart(event: React.DragEvent<HTMLElement>, engagementId: string) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", `engagement:${engagementId}`);
    setDraggingEngagementId(engagementId);
  }

  function handleInternalCardDragStart(event: React.DragEvent<HTMLElement>, internalCardId: string) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", `internal-card:${internalCardId}`);
    setDraggingInternalCardId(internalCardId);
  }

  function handleDrop(event: React.DragEvent<HTMLElement>, destinationBoardId: string) {
    event.preventDefault();
    const cardPayload = event.dataTransfer.getData("text/plain");
    setDragOverBoardId(null);
    setDraggingEngagementId(null);
    setDraggingInternalCardId(null);
    if (cardPayload.startsWith("internal-card:")) void moveStandaloneCard(cardPayload.slice("internal-card:".length), destinationBoardId);
    else {
      const engagementId = cardPayload.startsWith("engagement:") ? cardPayload.slice("engagement:".length) : cardPayload || draggingEngagementId;
      if (engagementId) void moveEngagement(engagementId, destinationBoardId);
    }
  }

  return <div className={styles.kanbanWorkspace}>
    <header className={styles.kanbanToolbar}><div><h2>Quadro Kanban</h2><p>Arraste uma contratação ou card avulso para outro quadro.</p></div><div className={styles.toolbarGroup}><button className={`${styles.button} ${styles.buttonSoft}`} type="button" onClick={() => void createStandaloneCard()} disabled={Boolean(savingBoardId || savingEngagementId) || !orderedBoards.length}><Plus size={15} /> Criar Card</button>{editing && <button className={`${styles.button} ${styles.buttonSoft}`} type="button" onClick={() => setNewBoardOpen(true)} disabled={Boolean(savingBoardId || savingEngagementId) || !barbers.length}><Plus size={15} /> Adicionar quadro</button>}<button className={`${styles.button} ${editing ? styles.buttonSoft : ""}`} type="button" onClick={() => setEditing((current) => !current)} disabled={Boolean(savingBoardId || savingEngagementId)}><Pencil size={15} /> {editing ? "Concluir edição" : "Editar Quadro"}</button></div></header>
    <ActionMessage message={message} />
    {orderedBoards.length === 0 ? <EmptyState title="Nenhum quadro configurado"><button className={styles.button} type="button" onClick={() => setNewBoardOpen(true)} disabled={!barbers.length}><Plus size={15} /> Adicionar quadro</button></EmptyState> : <div className={styles.kanban}>{orderedBoards.map((board) => { const cards = cardsForBoard(board); const standaloneCards = internalCardsForBoard(board); const laneClassName = `${styles.kanbanLane} ${dragOverBoardId === board.id ? styles.kanbanLaneDropTarget : ""}`; return <section className={laneClassName} key={board.id} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDragOverBoardId(board.id); }} onDrop={(event) => handleDrop(event, board.id)}><header><div className={styles.kanbanLaneTitle}>{editing ? <input aria-label={`Título do quadro ${board.name}`} value={board.name} onChange={(event) => setBoards((current) => current.map((item) => item.id === board.id ? { ...item, name: event.target.value } : item))} /> : <strong>{board.name}</strong>}{editing && <button className={`${styles.button} ${styles.buttonSoft} ${styles.iconButton}`} type="button" aria-label={`Salvar título ${board.name}`} title="Salvar título" disabled={savingBoardId === board.id || Boolean(savingEngagementId) || !board.name.trim() || !board.responsible_barber_id} onClick={() => void saveBoard(board)}><Save size={14} /></button>}</div><div className={styles.kanbanLaneActions}><span>{cards.length + standaloneCards.length}</span>{editing && <button className={`${styles.button} ${styles.buttonSoft} ${styles.iconButton}`} type="button" aria-label={`Remover quadro ${board.name}`} title="Remover quadro" disabled={orderedBoards.length <= 1 || Boolean(savingBoardId || savingEngagementId)} onClick={() => requestDelete(board)}><Trash2 size={14} /></button>}</div></header>{sectors.length > 0 && <label className={styles.kanbanResponsible}><span>Setor</span><select aria-label={`Setor do quadro ${board.name}`} value={board.sector_id ?? ""} disabled={!editing || Boolean(savingBoardId || savingEngagementId)} onChange={(event) => setBoards((current) => current.map((item) => item.id === board.id ? { ...item, sector_id: event.target.value } : item))}><option value="">Sem setor</option>{sectors.map((sector) => <option value={sector.id} key={sector.id}>{sector.name}</option>)}</select></label>}<label className={styles.kanbanResponsible}><span>Responsável</span><select aria-label={`Responsável do quadro ${board.name}`} value={board.responsible_barber_id} disabled={!editing || Boolean(savingBoardId || savingEngagementId)} onChange={(event) => setBoards((current) => current.map((item) => item.id === board.id ? { ...item, responsible_barber_id: event.target.value } : item))}><option value="">Selecione</option>{barbers.map((barber) => <option value={barber.id} key={barber.id}>{barber.display_name}</option>)}</select></label>{cards.map((item) => <KanbanEventCard key={item.id} engagement={item} customerName={customerById.get(item.customer_id)?.full_name ?? "Cliente"} lastComment={lastComments[item.id]} dragging={draggingEngagementId === item.id} onOpenEvent={() => onOpenEvent(item)} onDueDateChange={(dueOn) => void onDueDateChange(item, dueOn)} onDragStart={(event) => handleDragStart(event, item.id)} onDragEnd={() => { setDraggingEngagementId(null); setDragOverBoardId(null); }} />)}{standaloneCards.map((card) => <article className={styles.kanbanCard} key={card.id} draggable onDoubleClick={() => setOpenInternalCard(card)} onDragStart={(event) => handleInternalCardDragStart(event, card.id)} onDragEnd={() => { setDraggingInternalCardId(null); setDragOverBoardId(null); }} title="Duplo clique para abrir o serviço interno" data-dragging={draggingInternalCardId === card.id ? "true" : undefined}><small className={styles.kanbanCardContext}>Sem cliente · Serviço interno do projeto</small><strong>{card.title}</strong><p className={styles.kanbanCardDescription}>Responsável: {barbers.find((barber) => barber.id === board.responsible_barber_id)?.display_name ?? "Profissional do quadro"}</p></article>)}{cards.length + standaloneCards.length === 0 && <p className={styles.kanbanEmpty}>Nenhuma contratação</p>}</section>; })}</div>}
    {newBoardOpen && <Modal title="Adicionar quadro" onClose={() => setNewBoardOpen(false)}><div className={styles.form}><Field label="Título do quadro" wide><input value={newBoardName} onChange={(event) => setNewBoardName(event.target.value)} placeholder="Ex.: Em revisão" autoFocus /></Field>{sectors.length > 0 && <Field label="Setor" wide><select aria-label="Setor do novo quadro" value={newBoardSectorId} onChange={(event) => setNewBoardSectorId(event.target.value)}><option value="">Sem setor</option>{sectors.map((sector) => <option value={sector.id} key={sector.id}>{sector.name}</option>)}</select></Field>}<Field label="Responsável" wide><select aria-label="Responsável do novo quadro" value={newBoardResponsibleId} onChange={(event) => setNewBoardResponsibleId(event.target.value)}><option value="">Selecione um profissional</option>{barbers.map((barber) => <option value={barber.id} key={barber.id}>{barber.display_name}</option>)}</select></Field></div><footer className={styles.modalActions}><button className={`${styles.button} ${styles.buttonSoft}`} type="button" onClick={() => setNewBoardOpen(false)}>Cancelar</button><button className={styles.button} type="button" disabled={Boolean(savingBoardId) || !newBoardName.trim() || !newBoardResponsibleId} onClick={() => void createBoard()}><Plus size={15} /> Adicionar</button></footer></Modal>}
    {pendingDelete && <Modal title="Remover quadro" onClose={() => setPendingDelete(null)}><p className={styles.muted}>{pendingDelete.cardsCount > 0 ? `Este quadro possui ${pendingDelete.cardsCount} card${pendingDelete.cardsCount === 1 ? "" : "s"}. Selecione o destino antes de remover.` : "Este quadro está vazio e poderá ser removido."}</p>{pendingDelete.cardsCount > 0 && <div className={styles.form}><Field label="Mover cards para" wide><select aria-label="Quadro destino" value={pendingDelete.destinationId} onChange={(event) => setPendingDelete((current) => current ? { ...current, destinationId: event.target.value } : current)}><option value="">Selecione um quadro</option>{orderedBoards.filter((board) => board.id !== pendingDelete.board.id).map((board) => <option value={board.id} key={board.id}>{board.name}</option>)}</select></Field></div>}<footer className={styles.modalActions}><button className={`${styles.button} ${styles.buttonSoft}`} type="button" onClick={() => setPendingDelete(null)}>Cancelar</button><button className={styles.button} type="button" disabled={Boolean(savingBoardId) || (pendingDelete.cardsCount > 0 && !pendingDelete.destinationId)} onClick={() => void deleteBoard()}><Trash2 size={15} /> Remover quadro</button></footer></Modal>}
    {openInternalCard && (() => {
      const board = boards.find((item) => item.id === openInternalCard.kanban_board_id);
      return board ? <Modal title={`${openInternalCard.title} · Serviço Interno`} wide onClose={() => setOpenInternalCard(null)}><ProjectInternalServiceCard organizationId={organizationId} projectId={projectId} internalCardId={openInternalCard.id} board={board} barberName={barbers.find((item) => item.id === board.responsible_barber_id)?.display_name ?? "Responsável do quadro"} barbers={barbers} packageAssignments={packageAssignments.filter((assignment) => assignment.barber_id === board.responsible_barber_id)} packages={packages} services={services} existing={internalServices.find((item) => item.internal_card_id === openInternalCard.id && item.kanban_board_id === board.id) ?? null} onSaved={() => router.refresh()} /><footer className={styles.modalActions}><button className={`${styles.button} ${styles.buttonSoft}`} type="button" onClick={() => setOpenInternalCard(null)}>Fechar</button></footer></Modal> : null;
    })()}
    <p className={styles.kanbanNote}>Quadros sem setor definido não aparecem no kanban geral</p>
  </div>;
}

function ProjectFinance({ contractedCents, installments, commissions, barbers }: { contractedCents: number; installments: Props["installments"]; commissions: Props["projectCommissions"]; barbers: Props["barbers"] }) {
  const [selectedBarberId, setSelectedBarberId] = useState<string | null>(null);
  const receivedCents = installments.reduce((sum, item) => sum + installmentReceivedCents(item), 0);
  const outstandingCents = installments.reduce((sum, item) => sum + installmentOutstandingCents(item), 0);
  const commissionCents = commissions.reduce((sum, item) => sum + item.commission_cents, 0);
  const monthlyInstallments = [...installments.reduce((groups, item) => {
    if (item.status === "CANCELED") return groups;
    const month = item.due_on.slice(0, 7);
    const group = groups.get(month) ?? { month, outstandingCents: 0, receivedCents: 0 };
    group.outstandingCents += installmentOutstandingCents(item);
    group.receivedCents += installmentReceivedCents(item);
    groups.set(month, group);
    return groups;
  }, new Map<string, { month: string; outstandingCents: number; receivedCents: number }>()).values()].sort((a, b) => a.month.localeCompare(b.month));
  const commissionTotals = [...commissions.reduce((groups, item) => {
    const group = groups.get(item.barber_id) ?? { barberId: item.barber_id, generatedCents: 0, paidCents: 0 };
    group.generatedCents += item.commission_cents;
    group.paidCents += item.paid_commission_cents;
    groups.set(item.barber_id, group);
    return groups;
  }, new Map<string, { barberId: string; generatedCents: number; paidCents: number }>()).values()].sort((a, b) => barberName(a.barberId, barbers).localeCompare(barberName(b.barberId, barbers), "pt-BR"));
  const selectedBarber = selectedBarberId ? commissionTotals.find((item) => item.barberId === selectedBarberId) : null;
  const selectedBarberCommissions = selectedBarberId ? commissions.filter((item) => item.barber_id === selectedBarberId && item.payable_commission_cents > 0).sort((a, b) => b.service_date.localeCompare(a.service_date)) : [];

  return <div className={styles.projectColumns}>
    <Panel title="Resultado do projeto" description="Valores do módulo separados das sessões avulsas."><div className={styles.financeRows}><div><span>Total Faturado</span><strong>{formatCents(contractedCents)}</strong></div><div><span>Total Recebido</span><strong>{formatCents(receivedCents)}</strong></div><div><span>À Receber</span><strong>{formatCents(outstandingCents)}</strong></div><div><span>Comissões à pagar</span><strong>{formatCents(commissionCents)}</strong></div></div><p className={styles.muted}>Comissões são calculadas exclusivamente pelo valor cadastrado no pacote e entram após a conclusão do atendimento.</p></Panel>
    <Panel title="Parcelas" description="Totais recebidos e à receber agrupados pelo mês de vencimento.">{monthlyInstallments.length ? <div className={styles.movementTableWrap}><table className={styles.financeReportTable}><thead><tr><th>Mês de referência</th><th>À receber</th><th>Recebido</th></tr></thead><tbody>{monthlyInstallments.map((item) => <tr key={item.month}><th scope="row">{monthReferenceLabel(item.month)}</th><td>{formatCents(item.outstandingCents)}</td><td>{formatCents(item.receivedCents)}</td></tr>)}</tbody></table></div> : <EmptyState title="Nenhuma parcela criada">O cronograma será preenchido na proposta.</EmptyState>}</Panel>
    <Panel title="Comissões do projeto" description="Totais agrupados por profissional. Dê duplo clique em uma linha para abrir o relatório de valores à receber.">{commissionTotals.length ? <div className={styles.movementTableWrap}><table className={styles.financeReportTable}><thead><tr><th>Profissional</th><th>Total gerado</th><th>Total pago</th></tr></thead><tbody>{commissionTotals.map((item) => <tr key={item.barberId} onDoubleClick={() => setSelectedBarberId(item.barberId)} title="Duplo clique para ver serviços, clientes e valores à receber"><th scope="row"><button className={styles.financeReportLink} type="button" onClick={() => setSelectedBarberId(item.barberId)}>{barberName(item.barberId, barbers)}</button></th><td>{formatCents(item.generatedCents)}</td><td>{formatCents(item.paidCents)}</td></tr>)}</tbody></table></div> : <EmptyState title="Nenhuma comissão gerada">Conclua uma sessão para gerar a comissão do profissional.</EmptyState>}</Panel>
    {selectedBarber && <Modal title={`Comissões à receber · ${barberName(selectedBarber.barberId, barbers)}`} wide onClose={() => setSelectedBarberId(null)}><div className={styles.financeReportModalBody}>{selectedBarberCommissions.length ? <div className={styles.movementTableWrap}><table className={styles.financeReportTable}><thead><tr><th>Serviço</th><th>Cliente</th><th>À receber</th></tr></thead><tbody>{selectedBarberCommissions.map((item) => <tr key={item.internal_service_id ?? item.appointment_item_id ?? item.appointment_id}><td>{item.service_name}{item.source_type === "PROJECT_INTERNAL" && <small> · Serviço interno</small>}</td><td>{item.customer_name ?? "—"}</td><td>{formatCents(item.payable_commission_cents)}</td></tr>)}</tbody></table></div> : <EmptyState title="Nenhum valor pendente">Este profissional não possui comissão à receber no projeto.</EmptyState>}<div className={styles.modalActions}><button className={`${styles.button} ${styles.buttonSoft}`} type="button" onClick={() => setSelectedBarberId(null)}>Fechar</button></div></div></Modal>}
  </div>;
}

function installmentOutstandingCents(installment: Props["installments"][number]) {
  if (installment.status === "CANCELED") return 0;
  if (installment.remaining_cents !== null && installment.remaining_cents !== undefined) return Math.max(0, installment.remaining_cents);
  return Math.max(0, installment.amount_cents - installmentReceivedCents(installment));
}

function barberName(barberId: string, barbers: Props["barbers"]) {
  return barbers.find((item) => item.id === barberId)?.display_name ?? "Profissional não encontrado";
}

function monthReferenceLabel(month: string) {
  return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));
}

function Modal({ title, wide = false, onClose, children }: { title: string; wide?: boolean; onClose: () => void; children: React.ReactNode }) {
  const titleId = useId();
  return <div className={styles.modalLayer} role="presentation"><button className={styles.modalBackdrop} type="button" aria-label={`Fechar ${title}`} onClick={onClose} /><section className={`${styles.modal} ${wide ? styles.modalProjectWide : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId}><header className={styles.modalHeader}><div><small>Módulo Projetos</small><h2 id={titleId}>{title}</h2></div><button className={styles.modalClose} type="button" aria-label="Fechar" onClick={onClose}><X size={18} /></button></header>{children}</section></div>;
}

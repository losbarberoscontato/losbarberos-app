import type { BillingStatus } from "@/lib/domain/types";

const statusLabels: Record<BillingStatus, string> = {
  PROVISIONING: "Provisionando",
  TRIALING: "Em trial",
  ACTIVE: "Ativa",
  GRACE: "Em carência",
  BLOCKED: "Bloqueada",
  CANCELED_RETENTION: "Em retenção",
  CLOSED: "Encerrada",
};

export function formatAdminStatus(status: BillingStatus | null | undefined) {
  return status ? statusLabels[status] : "Sem assinatura";
}

export function formatAdminInstant(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(date);
}

export function organizationInitials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "LB";
}

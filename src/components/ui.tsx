import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import type { AppointmentStatus } from "@/data/demo";
import { getStatusLabel } from "@/data/demo";

export function Avatar({
  initials,
  tone = "sage",
  size = "md",
}: {
  initials: string;
  tone?: "sage" | "amber" | "blue" | "rose" | "ink";
  size?: "sm" | "md" | "lg" | "xl";
}) {
  return (
    <span className={`avatar avatar--${tone} avatar--${size}`} aria-hidden="true">
      {initials}
    </span>
  );
}

export function StatusChip({ status }: { status: AppointmentStatus }) {
  return (
    <span className={`status-chip status-chip--${status.toLowerCase()}`}>
      <span className="status-chip__dot" />
      {getStatusLabel(status)}
    </span>
  );
}

export function AccessChip({ status }: { status: string }) {
  const label: Record<string, string> = {
    ACTIVE: "Ativa",
    TRIALING: "Em teste",
    GRACE: "Em carência",
    BLOCKED: "Bloqueada",
  };

  return (
    <span className={`access-chip access-chip--${status.toLowerCase()}`}>
      <span />
      {label[status] ?? status}
    </span>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </header>
  );
}

export function StatCard({
  label,
  value,
  hint,
  trend,
  icon,
  accent = "sage",
}: {
  label: string;
  value: string;
  hint: string;
  trend?: "up" | "down" | "neutral";
  icon: ReactNode;
  accent?: "sage" | "amber" | "blue" | "rose";
}) {
  return (
    <article className={`stat-card stat-card--${accent}`}>
      <div className="stat-card__top">
        <span>{label}</span>
        <span className="stat-card__icon">{icon}</span>
      </div>
      <strong>{value}</strong>
      <p className={`stat-card__hint stat-card__hint--${trend ?? "neutral"}`}>
        {trend === "up" && <ArrowUpRight size={14} />}
        {trend === "down" && <ArrowDownRight size={14} />}
        {hint}
      </p>
    </article>
  );
}

export function SectionHeading({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function ProgressRing({ value, label }: { value: number; label: string }) {
  return (
    <div className="progress-ring" style={{ "--progress": `${value * 3.6}deg` } as React.CSSProperties}>
      <div>
        <strong>{value}%</strong>
        <span>{label}</span>
      </div>
    </div>
  );
}


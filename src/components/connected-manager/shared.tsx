"use client";

import type { ReactNode } from "react";
import styles from "./connected-manager.module.css";

export function ActionMessage({ message, tone = "info" }: { message: string; tone?: "info" | "warning" | "error" }) {
  if (!message) return null;
  const toneClass = tone === "error" ? styles.error : tone === "warning" ? styles.warning : "";
  return <p className={`${styles.message} ${toneClass}`} role="status">{message}</p>;
}

export function EmptyState({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return <div className={styles.empty}><strong>{title}</strong><p>{children}</p>{action}</div>;
}

export function Panel({ title, description, action, children, className = "" }: { title: string; description?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`${styles.panel} ${className}`}><header className={styles.panelHead}><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</header>{children}</section>;
}

export function StatusChip({ active, label }: { active: boolean; label?: string }) {
  return <span className={`${styles.chip} ${active ? "" : styles.chipOff}`}>{label ?? (active ? "Ativo" : "Inativo")}</span>;
}

export function Field({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return <label className={`${styles.field} ${wide ? styles.formWide : ""}`}><span>{label}</span>{children}</label>;
}


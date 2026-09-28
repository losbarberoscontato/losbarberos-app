import type { CSSProperties } from "react";

export type ProductIdentityConfig = {
  brand: { name: string; tagline: string; mark: string; logoUrl: string };
  colors: Record<string, string>;
  fonts: { interface: string; display: string };
  vocabulary: Record<string, string>;
};

export const LE_GRAS_IDENTITY_FALLBACK: ProductIdentityConfig = {
  brand: {
    name: "Le Gras",
    tagline: "Fotografia e gestão para estúdios",
    mark: "LG",
    logoUrl: "/display-sh/le-gras.png",
  },
  colors: {
    primary: "#29143d",
    secondary: "#59366f",
    accent: "#c8a45d",
    background: "#f5f0f7",
    surface: "#fffaff",
    text: "#251b2b",
    muted: "#756b7c",
    border: "#e5dce9",
    success: "#31705d",
    danger: "#a84545",
  },
  fonts: { interface: "Inter", display: "Baskerville" },
  vocabulary: {
    organization: "estúdio",
    organizationPlural: "estúdios",
    professional: "fotógrafo",
    professionalPlural: "fotógrafos",
    teamApp: "App da Equipe",
    organizationPicker: "Meus estúdios",
  },
};

export function isProductIdentityConfig(value: unknown): value is ProductIdentityConfig {
  if (!value || typeof value !== "object") return false;
  const config = value as Partial<ProductIdentityConfig>;
  return Boolean(config.brand && config.colors && config.fonts && config.vocabulary);
}

const COLOR_TOKENS = ["primary", "secondary", "accent", "background", "surface", "text", "muted", "border", "success", "danger"] as const;

export function productIdentityStyle(identity?: ProductIdentityConfig | null): CSSProperties | undefined {
  if (!identity) return undefined;
  const colors = identity.colors;
  if (!COLOR_TOKENS.every((key) => /^#[\da-f]{6}$/i.test(colors[key] ?? ""))) return undefined;
  return {
    "--forest-950": colors.primary,
    "--forest-900": colors.primary,
    "--forest-800": colors.secondary,
    "--forest-700": colors.secondary,
    "--forest-600": colors.secondary,
    "--amber-500": colors.accent,
    "--amber-400": colors.accent,
    "--paper": colors.background,
    "--paper-2": colors.background,
    "--surface": colors.surface,
    "--white": colors.surface,
    "--ink": colors.text,
    "--ink-2": colors.text,
    "--muted": colors.muted,
    "--border": colors.border,
    "--border-soft": colors.border,
    "--success": colors.success,
    "--danger": colors.danger,
    "--font-sans": `${identity.fonts.interface}, sans-serif`,
    "--font-display": `${identity.fonts.display}, Georgia, serif`,
  } as CSSProperties;
}

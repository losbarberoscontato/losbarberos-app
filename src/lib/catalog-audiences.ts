export const CATALOG_AUDIENCES = [
  "INFANTIL",
  "FEMININO",
  "MASCULINO",
  "OUTROS_SERVICOS",
] as const;

export type CatalogAudience = string;

export type CatalogAudienceOption = {
  audience_key: CatalogAudience;
  name: string;
  active: boolean;
  sort_order: number;
  is_default: boolean;
};

const AUDIENCE_LABELS: Record<CatalogAudience, string> = {
  INFANTIL: "Infantil",
  FEMININO: "Feminino",
  MASCULINO: "Masculino",
  OUTROS_SERVICOS: "Outros Serviços",
};

export function audienceLabel(audience: CatalogAudience, options: readonly Pick<CatalogAudienceOption, "audience_key" | "name">[] = []): string {
  return options.find((option) => option.audience_key === audience)?.name
    ?? AUDIENCE_LABELS[audience as keyof typeof AUDIENCE_LABELS]
    ?? audience.replaceAll("_", " ").replace(/^custom\s+/iu, "");
}

export function hasAudience(audiences: readonly CatalogAudience[]): boolean {
  return audiences.length > 0;
}

export function filterByAudience<T extends { audiences: readonly CatalogAudience[] }>(
  items: readonly T[],
  audience: CatalogAudience,
): T[] {
  return items.filter((item) => item.audiences.includes(audience));
}

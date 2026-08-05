export const CATALOG_AUDIENCES = [
  "INFANTIL",
  "FEMININO",
  "MASCULINO",
  "OUTROS_SERVICOS",
] as const;

export type CatalogAudience = (typeof CATALOG_AUDIENCES)[number];

const AUDIENCE_LABELS: Record<CatalogAudience, string> = {
  INFANTIL: "Infantil",
  FEMININO: "Feminino",
  MASCULINO: "Masculino",
  OUTROS_SERVICOS: "Outros Serviços",
};

export function audienceLabel(audience: CatalogAudience): string {
  return AUDIENCE_LABELS[audience];
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

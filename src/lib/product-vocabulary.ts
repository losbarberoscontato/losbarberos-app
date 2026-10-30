import type { ProductKey } from "./product-routes";

export type ProductVocabulary = {
  organization: string;
  organizationWithPreposition: string;
  organizationPossessive: string;
  professional: string;
  professionals: string;
  teamApp: string;
  service: string;
  services: string;
  customer: string;
  customers: string;
};

const vocabulary: Record<ProductKey, ProductVocabulary> = {
  "los-barberos": {
    organization: "barbearia",
    organizationWithPreposition: "na barbearia",
    organizationPossessive: "da barbearia",
    professional: "barbeiro",
    professionals: "barbeiros",
    teamApp: "App do Barbeiro",
    service: "serviço",
    services: "serviços",
    customer: "cliente",
    customers: "clientes",
  },
  "le-gras": {
    organization: "estúdio",
    organizationWithPreposition: "no estúdio",
    organizationPossessive: "do estúdio",
    professional: "profissional de fotografia",
    professionals: "profissionais de fotografia",
    teamApp: "App da equipe",
    service: "sessão fotográfica",
    services: "sessões fotográficas",
    customer: "cliente",
    customers: "clientes",
  },
  "pro-stetic": {
    organization: "estúdio de estética e beleza",
    organizationWithPreposition: "no estúdio",
    organizationPossessive: "do estúdio",
    professional: "profissional",
    professionals: "profissionais",
    teamApp: "App da equipe",
    service: "serviço",
    services: "serviços",
    customer: "cliente",
    customers: "clientes",
  },
  "music-pro": {
    organization: "escola de música",
    organizationWithPreposition: "na escola",
    organizationPossessive: "da escola",
    professional: "professor(a) ou músico(a)",
    professionals: "professores(as) e músicos(as)",
    teamApp: "App da equipe musical",
    service: "aula",
    services: "aulas",
    customer: "estudante",
    customers: "estudantes",
  },
};

const previousDefaults: Partial<Record<ProductKey, Record<string, string>>> = {
  "le-gras": { professional: "fotógrafo", professionalPlural: "fotógrafos" },
  "pro-stetic": { organization: "clínica", professional: "especialista", professionalPlural: "especialistas" },
  "music-pro": { professional: "professor", professionalPlural: "professores", teamApp: "App do Professor", customer: "aluno", customerPlural: "alunos" },
};

export function getProductVocabulary(productKey: ProductKey | null | undefined, configured?: Record<string, string>): ProductVocabulary {
  const key = productKey ?? "los-barberos";
  const defaults = vocabulary[key];
  const previous = previousDefaults[key] ?? {};
  const configKeys: Partial<Record<keyof ProductVocabulary, string>> = { professionals: "professionalPlural", services: "servicePlural", customers: "customerPlural" };
  const term = (name: keyof ProductVocabulary): string => {
    const configuredKey = configKeys[name] ?? name;
    const value = configured?.[configuredKey];
    const normalizedValue = value?.toLocaleLowerCase("pt-BR");
    const normalizedPrevious = previous[configuredKey]?.toLocaleLowerCase("pt-BR");
    if (!value || normalizedValue === normalizedPrevious) return defaults[name];
    return name === "teamApp" ? value : value.toLocaleLowerCase("pt-BR");
  };
  return {
    organization: term("organization"),
    organizationWithPreposition: defaults.organizationWithPreposition,
    organizationPossessive: defaults.organizationPossessive,
    professional: term("professional"),
    professionals: term("professionals"),
    teamApp: term("teamApp"),
    service: term("service"),
    services: term("services"),
    customer: term("customer"),
    customers: term("customers"),
  };
}

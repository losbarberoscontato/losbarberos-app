import type { ProductKey } from "@/lib/product-routes";
import type { ProductIdentityConfig } from "@/lib/product-identity";

const defaults: Record<ProductKey, { organization: string; professional: string; service: string; services: string }> = {
  "los-barberos": { organization: "barbearia", professional: "barbeiro", service: "serviço", services: "serviços" },
  "le-gras": { organization: "estúdio", professional: "fotógrafo", service: "serviço", services: "serviços" },
  "pro-stetic": { organization: "estúdio", professional: "especialista", service: "serviço", services: "serviços" },
  "music-pro": { organization: "escola", professional: "professor", service: "aula", services: "aulas" },
};

export function clientVocabulary(identity: ProductIdentityConfig | null, productKey: ProductKey | null | undefined) {
  const fallback = defaults[productKey ?? "los-barberos"];
  const words = identity?.vocabulary ?? {};
  const organization = words.organization?.toLowerCase() || fallback.organization;
  const professional = words.professional?.toLowerCase() || fallback.professional;
  const service = words.service?.toLowerCase() || fallback.service;
  const services = words.servicePlural?.toLowerCase() || fallback.services;
  const article = productKey === "music-pro" || productKey === "los-barberos" ? "da" : "do";
  return {
    organization,
    professional,
    service,
    services,
    article,
    organizationPhrase: `${article} ${organization}`,
    byOrganization: `${article === "da" ? "pela" : "pelo"} ${organization}`,
    toOrganization: `${article === "da" ? "à" : "ao"} ${organization}`,
    inOrganization: `${article === "da" ? "nesta" : "neste"} ${organization}`,
    serviceArticle: service === "aula" ? "a" : "o",
    professionalLabel: professional.charAt(0).toUpperCase() + professional.slice(1),
    serviceLabel: service.charAt(0).toUpperCase() + service.slice(1),
    servicesLabel: services.charAt(0).toUpperCase() + services.slice(1),
  };
}

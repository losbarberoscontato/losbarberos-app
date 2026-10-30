import type { ProductKey } from "@/lib/product-routes";
import type { ProductIdentityConfig } from "@/lib/product-identity";
import { getProductVocabulary } from "@/lib/product-vocabulary";

export function clientVocabulary(identity: ProductIdentityConfig | null, productKey: ProductKey | null | undefined) {
  const fallback = getProductVocabulary(productKey, identity?.vocabulary);
  const { organization, professional, service, services } = fallback;
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
    serviceArticle: productKey === "music-pro" || productKey === "le-gras" ? "a" : "o",
    professionalLabel: professional.charAt(0).toUpperCase() + professional.slice(1),
    serviceLabel: service.charAt(0).toUpperCase() + service.slice(1),
    servicesLabel: services.charAt(0).toUpperCase() + services.slice(1),
  };
}

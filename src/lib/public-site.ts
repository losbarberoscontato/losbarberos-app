export const DEFAULT_PUBLIC_SITE_ORIGIN = "https://losbarberos-app.vercel.app";

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function resolvePublicSiteOrigin(value = process.env.NEXT_PUBLIC_SITE_URL): string {
  if (!value) return DEFAULT_PUBLIC_SITE_ORIGIN;

  try {
    const url = new URL(value);
    const isHttps = url.protocol === "https:";
    const isLocalHttp = url.protocol === "http:" && LOCAL_HOSTNAMES.has(url.hostname);

    return isHttps || isLocalHttp ? url.origin : DEFAULT_PUBLIC_SITE_ORIGIN;
  } catch {
    return DEFAULT_PUBLIC_SITE_ORIGIN;
  }
}

export const publicSite = Object.freeze({
  name: "Los Barberos",
  legalName: "JULIO CESAR HEIDEN JUNIOR 05128841960",
  privacyEmail: "contato@losbarberos.com.br",
  legalVersion: "1.0",
  legalUpdatedAt: "12 de agosto de 2026",
  origin: resolvePublicSiteOrigin(),
});

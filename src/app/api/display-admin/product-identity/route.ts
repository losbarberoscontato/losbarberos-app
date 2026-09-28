import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isPlatformAdminUser } from "@/lib/auth/context";

const PRODUCTS = ["los-barberos", "le-gras", "pro-stetic", "music-pro"] as const;
const HEX = /^#[0-9a-fA-F]{6}$/;
const FONT_ALLOWLIST = new Set(["Inter", "Arial", "Georgia", "Baskerville", "Roboto", "system-ui"]);

type Identity = {
  brand: { name: string; tagline: string; mark: string; logoUrl: string };
  colors: Record<string, string>;
  fonts: { interface: string; display: string };
  vocabulary: Record<string, string>;
};

function validIdentity(value: unknown): value is Identity {
  if (!value || typeof value !== "object") return false;
  const config = value as Record<string, unknown>;
  const brand = config.brand as Record<string, unknown> | undefined;
  const colors = config.colors as Record<string, unknown> | undefined;
  const fonts = config.fonts as Record<string, unknown> | undefined;
  const vocabulary = config.vocabulary as Record<string, unknown> | undefined;
  if (!brand || !colors || !fonts || !vocabulary) return false;
  if (!["name", "tagline", "mark", "logoUrl"].every((key) => typeof brand[key] === "string" && (brand[key] as string).length <= 300)) return false;
  const logoUrl = brand.logoUrl as string;
  if (/[\u0000-\u001f"'<>]/.test(logoUrl)) return false;
  if (logoUrl && !/^\/(?!\/)/.test(logoUrl)) {
    try {
      const parsed = new URL(logoUrl);
      if (parsed.protocol !== "https:") return false;
    } catch { return false; }
  }
  if (!Object.values(colors).every((color) => typeof color === "string" && HEX.test(color))) return false;
  if (!Object.values(fonts).every((font) => typeof font === "string" && FONT_ALLOWLIST.has(font))) return false;
  if (!Object.entries(vocabulary).every(([key, label]) => key.length <= 80 && typeof label === "string" && label.length <= 100)) return false;
  return Object.keys(colors).length <= 30 && Object.keys(vocabulary).length <= 40 && JSON.stringify(value).length <= 16000;
}

async function adminClient() {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return { error: "Supabase não configurado.", status: 503 as const };
  const { data } = await supabase.auth.getUser();
  if (!data.user || !(await isPlatformAdminUser(data.user.id))) return { error: "Acesso restrito ao administrador Display SH.", status: 403 as const };
  return { supabase, userId: data.user.id };
}

export async function GET(request: Request) {
  const productKey = new URL(request.url).searchParams.get("product");
  if (!PRODUCTS.includes(productKey as (typeof PRODUCTS)[number])) return NextResponse.json({ error: "Produto inválido." }, { status: 400 });
  const auth = await adminClient();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const [draft, published] = await Promise.all([
    auth.supabase.from("platform_product_identity_drafts").select("config, updated_at").eq("product_key", productKey).maybeSingle(),
    auth.supabase.from("platform_product_identities").select("config, revision, published_at").eq("product_key", productKey).maybeSingle(),
  ]);
  if (draft.error || published.error) return NextResponse.json({ error: "Não foi possível carregar a identidade do produto." }, { status: 500 });
  return NextResponse.json({ draft: draft.data, published: published.data });
}

export async function PUT(request: Request) {
  const auth = await adminClient();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  let body: { productKey?: string; config?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Corpo JSON inválido." }, { status: 400 }); }
  if (!PRODUCTS.includes(body.productKey as (typeof PRODUCTS)[number]) || !validIdentity(body.config)) return NextResponse.json({ error: "Revise os campos, cores, fontes e links da identidade." }, { status: 400 });
  const { error } = await auth.supabase.from("platform_product_identity_drafts").upsert({
    product_key: body.productKey,
    config: body.config,
    updated_by: auth.userId,
    updated_at: new Date().toISOString(),
  });
  if (error) return NextResponse.json({ error: "Falha ao salvar rascunho." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function POST(request: Request) {
  const auth = await adminClient();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  let body: { productKey?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Corpo JSON inválido." }, { status: 400 }); }
  if (!PRODUCTS.includes(body.productKey as (typeof PRODUCTS)[number])) return NextResponse.json({ error: "Produto inválido." }, { status: 400 });
  const { data, error } = await auth.supabase.rpc("publish_product_identity", { p_product_key: body.productKey });
  if (error) return NextResponse.json({ error: "Falha ao publicar. Salve o rascunho e tente novamente." }, { status: 500 });
  return NextResponse.json({ ok: true, revision: data });
}

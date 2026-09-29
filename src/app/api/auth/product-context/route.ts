import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { parseProductKey, setProductContextCookie } from "@/lib/product-context";

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Origem inválida." }, { status: 403 });
  }
  let body: { productKey?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Solicitação inválida." }, { status: 400 });
  }
  const productKey = parseProductKey(body.productKey);
  if (!productKey) return NextResponse.json({ error: "Sistema inválido." }, { status: 400 });
  const supabase = await getSupabaseServerClient();
  const { data } = await supabase?.auth.getUser() ?? { data: { user: null } };
  if (!data.user) return NextResponse.json({ error: "Entre novamente." }, { status: 401 });

  const response = NextResponse.json({ ok: true });
  setProductContextCookie(response, productKey);
  return response;
}

import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Brand } from "@/components/brand";
import { DemoLogin } from "@/components/demo-login";
import { resolveSystemAuthDestination, resolveSystemAuthMode } from "@/lib/system-auth";
import { getPublishedProductIdentity } from "@/lib/product-identity-server";
import { productIdentityStyle } from "@/lib/product-identity";

export const metadata: Metadata = { title: { absolute: "Entrar no Los Barberos" } };

export default async function LosBarberosLoginRoute({ searchParams }: PageProps<"/los-barberos/entrar">) {
  const params = await searchParams;
  const initialMode = resolveSystemAuthMode(params.modo);
  const nextPath = resolveSystemAuthDestination(params.next);
  const identity = await getPublishedProductIdentity("los-barberos");
  const identityStyle = productIdentityStyle(identity);

  return (
    <main className="system-login-page" style={identityStyle}>
      <header className="system-login-page__header">
        <Brand href="/los-barberos" light name={identity?.brand.name} tagline={identity?.brand.tagline} mark={identity?.brand.mark} logoUrl={identity?.brand.logoUrl} />
        <Link className="system-login-page__back" href="/los-barberos"><ArrowLeft size={17} /> Voltar ao {identity?.brand.name ?? "Los Barberos"}</Link>
      </header>
      <section className="system-login-page__main" aria-label="Acesso ao Los Barberos">
        <div className="system-login-panel">
          <DemoLogin
            initialNotice={params.erro === "supabase_not_configured" ? "Sistema indisponível: configuração do Supabase ausente." : ""}
            initialMode={initialMode}
            nextPath={nextPath}
            productKey="los-barberos"
          />
        </div>
      </section>
      <footer className="system-login-page__footer">
        <span>© Los Barberos</span>
        <span>Ao continuar, você concorda com os <Link href="/termos">Termos de Uso</Link> e a <Link href="/privacidade">Política de Privacidade</Link>.</span>
      </footer>
    </main>
  );
}

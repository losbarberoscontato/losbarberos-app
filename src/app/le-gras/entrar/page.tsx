import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { DemoLogin } from "@/components/demo-login";
import { resolveSystemAuthDestination, resolveSystemAuthMode } from "@/lib/system-auth";
import { getPublishedProductIdentity } from "@/lib/product-identity-server";
import { productIdentityStyle } from "@/lib/product-identity";

export const metadata: Metadata = { title: { absolute: "Entrar no Le Gras | Display SH" } };

export default async function LeGrasLoginRoute({ searchParams }: PageProps<"/le-gras/entrar">) {
  const params = await searchParams;
  const initialMode = resolveSystemAuthMode(params.modo);
  const nextPath = resolveSystemAuthDestination(params.next);
  const identity = await getPublishedProductIdentity("le-gras");

  return (
    <main className="system-login-page" style={productIdentityStyle(identity)}>
      <header className="system-login-page__header">
        <Link href="/le-gras" aria-label="Le Gras — início">
          <Image src={identity?.brand.logoUrl ?? "/display-sh/le-gras.png"} alt="Le Gras Fotografia" width={399} height={114} priority style={{ width: "205px", height: "auto" }} />
        </Link>
        <Link className="system-login-page__back" href="/le-gras"><ArrowLeft size={17} /> Voltar ao Le Gras</Link>
      </header>
      <section className="system-login-page__main" aria-label="Acesso ao Le Gras">
        <div className="system-login-panel">
          <DemoLogin initialMode={initialMode} nextPath={nextPath} productKey="le-gras" productName="estúdio" />
        </div>
      </section>
      <footer className="system-login-page__footer">
        <span>© Le Gras · Display SH</span>
        <span>Ao continuar, você concorda com os <Link href="/termos">Termos de Uso</Link> e a <Link href="/privacidade">Política de Privacidade</Link>.</span>
      </footer>
    </main>
  );
}

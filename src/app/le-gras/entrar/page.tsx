import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { DemoLogin } from "@/components/demo-login";
import { resolveSystemAuthDestination, resolveSystemAuthMode } from "@/lib/system-auth";
import { getPublishedProductIdentity } from "@/lib/product-identity-server";
import { productIdentityStyle } from "@/lib/product-identity";
import styles from "./page.module.css";

export const metadata: Metadata = { title: { absolute: "Entrar no Le Gras | Display SH" } };

export default async function LeGrasLoginRoute({ searchParams }: PageProps<"/le-gras/entrar">) {
  const params = await searchParams;
  const initialMode = resolveSystemAuthMode(params.modo);
  const nextPath = resolveSystemAuthDestination(params.next);
  const identity = await getPublishedProductIdentity("le-gras");
  const configuredLogoUrl = identity?.brand.logoUrl;
  const logoUrl = configuredLogoUrl && configuredLogoUrl !== "/display-sh/le-gras.png"
    ? configuredLogoUrl
    : "/display-sh/le-gras-transparent.png";
  const usesDefaultLogo = logoUrl === "/display-sh/le-gras-transparent.png";

  return (
    <main className="system-login-page" style={productIdentityStyle(identity)}>
      <header className={`system-login-page__header ${styles.header}`}>
        <Link className={styles.logoLink} href="/le-gras" aria-label="Le Gras — início">
          <Image className={`${styles.logo}${usesDefaultLogo ? ` ${styles.logoThemed}` : ""}`} src={logoUrl} alt="Le Gras Fotografia" width={2170} height={725} priority />
        </Link>
        <Link className={`system-login-page__back ${styles.backLink}`} href="/le-gras"><ArrowLeft size={17} /> Voltar ao Le Gras</Link>
      </header>
      <section className="system-login-page__main" aria-label="Acesso ao Le Gras">
        <div className="system-login-panel">
          <DemoLogin initialMode={initialMode} nextPath={nextPath} productKey="le-gras" />
        </div>
      </section>
      <footer className="system-login-page__footer">
        <span>© Le Gras · Display SH</span>
        <span>Ao continuar, você concorda com os <Link href="/termos">Termos de Uso</Link> e a <Link href="/privacidade">Política de Privacidade</Link>.</span>
      </footer>
    </main>
  );
}

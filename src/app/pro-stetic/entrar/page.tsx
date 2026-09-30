import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { DemoLogin } from "@/components/demo-login";
import { resolveSystemAuthDestination, resolveSystemAuthMode } from "@/lib/system-auth";
import { getPublishedProductIdentity } from "@/lib/product-identity-server";
import { productIdentityStyle } from "@/lib/product-identity";
import styles from "../../music-pro/login.module.css";

export const metadata: Metadata = {
  title: { absolute: "Entrar no ProStetic" },
  icons: { icon: [{ url: "/pro-stetic/icon.svg", type: "image/svg+xml" }] },
};

export default async function ProSteticLoginPage({ searchParams }: PageProps<"/pro-stetic/entrar">) {
  const params = await searchParams;
  const identity = await getPublishedProductIdentity("pro-stetic");
  const initialMode = resolveSystemAuthMode(params.modo);
  const nextPath = resolveSystemAuthDestination(params.next);
  const logo = identity?.brand.logoUrl || "/display-sh/pro-stetic.png";

  return (
    <main className="system-login-page" style={productIdentityStyle(identity)}>
      <header className={`system-login-page__header ${styles.header}`}>
        <Link className={styles.logoLink} href="/pro-stetic" aria-label="ProStetic — início">
          <Image className={styles.logo} src={logo} alt="ProStetic — Estética e Beleza" width={266} height={66} priority />
        </Link>
        <Link className={`system-login-page__back ${styles.backLink}`} href="/pro-stetic"><ArrowLeft size={17} /> Voltar ao ProStetic</Link>
      </header>
      <section className="system-login-page__main" aria-label="Acesso ao ProStetic">
        <div className="system-login-panel">
          <DemoLogin initialMode={initialMode} nextPath={nextPath} productKey="pro-stetic" />
        </div>
      </section>
      <footer className="system-login-page__footer">
        <span>© ProStetic · Display SH</span>
        <span>Ao continuar, você concorda com os <Link href="/termos">Termos de Uso</Link> e a <Link href="/privacidade">Política de Privacidade</Link>.</span>
      </footer>
    </main>
  );
}

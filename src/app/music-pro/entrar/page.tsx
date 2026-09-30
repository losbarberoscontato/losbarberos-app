import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { DemoLogin } from "@/components/demo-login";
import { resolveSystemAuthDestination, resolveSystemAuthMode } from "@/lib/system-auth";
import { getPublishedProductIdentity } from "@/lib/product-identity-server";
import { productIdentityStyle } from "@/lib/product-identity";
import styles from "../login.module.css";

export const metadata: Metadata = {
  title: { absolute: "Entrar no MusicPro" },
  icons: { icon: [{ url: "/music-pro/icon.svg", type: "image/svg+xml" }] },
};

export default async function MusicProLoginPage({ searchParams }: PageProps<"/music-pro/entrar">) {
  const params = await searchParams;
  const identity = await getPublishedProductIdentity("music-pro");
  const initialMode = resolveSystemAuthMode(params.modo);
  const nextPath = resolveSystemAuthDestination(params.next);
  const logo = identity?.brand.logoUrl || "/music-pro/logo-neon.png";

  return (
    <main className="system-login-page" style={productIdentityStyle(identity)}>
      <header className={`system-login-page__header ${styles.header}`}>
        <Link className={styles.logoLink} href="/music-pro" aria-label="MusicPro — início">
          <Image className={styles.logo} src={logo} alt="MusicPro — Escolas de Música" width={277} height={83} priority />
        </Link>
        <Link className={`system-login-page__back ${styles.backLink}`} href="/music-pro"><ArrowLeft size={17} /> Voltar ao MusicPro</Link>
      </header>
      <section className="system-login-page__main" aria-label="Acesso ao MusicPro">
        <div className="system-login-panel"><DemoLogin initialMode={initialMode} nextPath={nextPath} productKey="music-pro" /></div>
      </section>
      <footer className="system-login-page__footer">
        <span>© 2026 MusicPro</span>
        <span>Ao continuar, você concorda com os <Link href="/termos">Termos de Uso</Link> e a <Link href="/privacidade">Política de Privacidade</Link>.</span>
      </footer>
    </main>
  );
}

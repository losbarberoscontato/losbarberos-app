import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import styles from "./page.module.css";
import { getPublishedProductIdentity } from "@/lib/product-identity-server";
import { productIdentityStyle } from "@/lib/product-identity";

export const metadata: Metadata = {
  title: { absolute: "Le Gras — gestão para estúdios fotográficos" },
  description: "Organize clientes, agenda e projetos do seu estúdio fotográfico com o Le Gras.",
};

export default async function LeGrasPage() {
  const identity = await getPublishedProductIdentity("le-gras");
  const identityStyle = productIdentityStyle(identity);

  return (
    <main className="le-gras-page" style={identityStyle}>
      <header className={styles.header}>
        <Link href="/le-gras" className={styles.brand} aria-label="Le Gras — página inicial">
          <Image
            src="/display-sh/le-gras-transparent.png"
            alt="Le Gras Fotografia"
            width={2170}
            height={725}
            priority
          />
        </Link>
        <Link href="/le-gras/entrar?modo=login" className={styles.loginLink}>Entrar</Link>
      </header>

      <section className={styles.hero}>
        <div className={styles.copy}>
          <h1><span className={styles.purpleTitle}>Histórias que ficam.</span><br /><em>Uma rotina mais leve.</em></h1>
          <p>Le Gras reúne clientes, agenda, projetos e gestão para organizar a rotina de estúdios fotográficos em um só espaço.</p>
          <Link href="/le-gras/entrar?modo=cadastro" className={`button button--accent button--lg ${styles.primaryAction}`}>
            Criar meu estúdio
          </Link>
        </div>

        <div className={styles.visual}>
          <Image
            src="/display-sh/le-gras-agenda-hero.png"
            alt="Equipamentos fotográficos ao redor de um notebook com a agenda do Le Gras aberta"
            width={1536}
            height={1024}
            priority
            sizes="(max-width: 760px) 100vw, (max-width: 1200px) 52vw, 680px"
          />
        </div>
      </section>

      <footer className="le-gras-footer">
        <span>© 2026 Le Gras</span>
        <a href="mailto:contato@displaysh.com">Fale com a gente</a>
      </footer>
    </main>
  );
}

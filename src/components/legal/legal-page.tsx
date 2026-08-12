import Link from "next/link";
import type { ReactNode } from "react";
import { Brand } from "@/components/brand";
import { publicSite } from "@/lib/public-site";
import styles from "./legal-page.module.css";

type LegalPageProps = {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
};

export function LegalPage({ eyebrow, title, description, children }: LegalPageProps) {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Brand />
        <nav aria-label="Documentos legais" className={styles.nav}>
          <Link href="/privacidade">Privacidade</Link>
          <Link href="/termos">Termos</Link>
          <Link href="/exclusao-de-dados">Exclusão de dados</Link>
        </nav>
      </header>

      <main className={styles.main}>
        <header className={styles.hero}>
          <span>{eyebrow}</span>
          <h1>{title}</h1>
          <p>{description}</p>
          <div className={styles.meta}>
            <span>Versão {publicSite.legalVersion}</span>
            <span>Atualizada em {publicSite.legalUpdatedAt}</span>
          </div>
        </header>

        <article className={styles.content}>{children}</article>
      </main>

      <footer className={styles.footer}>
        <div>
          <strong>{publicSite.name}</strong>
          <span>Gestão para barbearias</span>
        </div>
        <div>
          <span>Dúvidas sobre privacidade e proteção de dados:</span>
          <a href={`mailto:${publicSite.privacyEmail}`}>{publicSite.privacyEmail}</a>
        </div>
      </footer>
    </div>
  );
}

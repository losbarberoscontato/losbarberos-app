import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, CalendarDays, Music2, Users } from "lucide-react";
import { getPublishedProductIdentity } from "@/lib/product-identity-server";
import { productIdentityStyle } from "@/lib/product-identity";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: { absolute: "MusicPro — gestão para escolas de música" },
  description: "Organize alunos, professores e aulas da sua escola de música com o MusicPro.",
  icons: { icon: [{ url: "/music-pro/icon.svg", type: "image/svg+xml" }] },
};

export default async function MusicProPage() {
  const identity = await getPublishedProductIdentity("music-pro");

  return (
    <main className={styles.page} style={productIdentityStyle(identity)}>
      <header className={styles.header}>
        <Link href="/music-pro" className={styles.logo} aria-label="MusicPro — página inicial">
          <Image src={identity?.brand.logoUrl || "/display-sh/music-pro.png"} alt="MusicPro — Escolas de Música" width={277} height={83} priority />
        </Link>
        <Link href="/music-pro/entrar?modo=login" className={styles.login}>Entrar</Link>
      </header>

      <section className={styles.hero}>
        <div className={styles.copy}>
          <span className={styles.eyebrow}>GESTÃO PARA ESCOLAS DE MÚSICA</span>
          <h1>Mais música.<br /><em>Menos tarefas.</em></h1>
          <p>Alunos, professores, aulas e pagamentos organizados em um só lugar. Deixe a rotina da escola fluir no ritmo certo.</p>
          <Link href="/music-pro/entrar?modo=cadastro" className={styles.cta}>Criar minha escola <ArrowRight size={18} /></Link>
          <small className={styles.trial}>14 dias grátis · depois R$ 57,00 por mês</small>
        </div>

        <div className={styles.preview} aria-label="Prévia ilustrativa do painel MusicPro">
          <div className={styles.previewTop}><span className={styles.previewMark}><Music2 size={17} /></span><div><strong>Escola Harmonia</strong><small>Agenda de aulas</small></div><span className={styles.today}>HOJE</span></div>
          <div className={styles.previewControls}><strong>Terça-feira, 30 de setembro</strong><span>Dia&nbsp;&nbsp; Semana&nbsp;&nbsp; Mês</span></div>
          <div className={styles.previewGrid}>
            <div className={styles.hours}><span>09:00</span><span>10:00</span><span>11:00</span><span>12:00</span></div>
            <div className={styles.lessonColumn}>
              <div className={`${styles.lesson} ${styles.lessonOne}`}><strong>Piano · Ana Lima</strong><small>Marina · Sala 1</small></div>
              <div className={`${styles.lesson} ${styles.lessonTwo}`}><strong>Violão · Pedro Alves</strong><small>Lucas · Sala 2</small></div>
              <div className={`${styles.lesson} ${styles.lessonThree}`}><strong>Canto · Júlia Reis</strong><small>Beatriz · Sala 1</small></div>
            </div>
          </div>
          <div className={styles.previewFooter}><span><CalendarDays size={15} /> Agenda em ordem</span><span><Users size={15} /> Equipe conectada</span></div>
        </div>
      </section>

      <footer className={styles.footer}><span>© 2026 MusicPro</span><a href="mailto:contato@displaysh.com">Fale com a gente</a></footer>
    </main>
  );
}

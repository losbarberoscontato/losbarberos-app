import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, CalendarDays, Sparkles, Users } from "lucide-react";
import { getPublishedProductIdentity } from "@/lib/product-identity-server";
import { productIdentityStyle } from "@/lib/product-identity";
import styles from "../music-pro/page.module.css";

export const metadata: Metadata = {
  title: { absolute: "ProStetic — gestão para estética e beleza" },
  description: "Organize clientes, equipe, serviços e agenda do seu estúdio com o ProStetic.",
  icons: { icon: [{ url: "/pro-stetic/icon.svg", type: "image/svg+xml" }] },
};

export default async function ProSteticPage() {
  const identity = await getPublishedProductIdentity("pro-stetic");

  return (
    <main className={styles.page} style={productIdentityStyle(identity)}>
      <header className={styles.header}>
        <Link href="/pro-stetic" className={styles.logo} aria-label="ProStetic — página inicial">
          <Image src={identity?.brand.logoUrl || "/display-sh/pro-stetic.png"} alt="ProStetic — Estética e Beleza" width={266} height={66} priority />
        </Link>
        <Link href="/pro-stetic/entrar?modo=login" className={styles.login}>Entrar</Link>
      </header>

      <section className={styles.hero}>
        <div className={styles.copy}>
          <span className={styles.eyebrow}>GESTÃO PARA ESTÉTICA E BELEZA</span>
          <h1>Seu estúdio.<br /><em>Em perfeita harmonia.</em></h1>
          <p>Clientes, equipe, serviços, agenda e pagamentos organizados em um só lugar. Mais cuidado com cada cliente, menos tarefas na rotina.</p>
          <Link href="/pro-stetic/entrar?modo=cadastro" className={styles.cta}>Criar meu estúdio <ArrowRight size={18} /></Link>
          <small className={styles.trial}>14 dias grátis · depois R$ 77,00 por mês</small>
        </div>

        <div className={styles.preview} aria-label="Prévia ilustrativa da agenda ProStetic">
          <div className={styles.previewTop}><span className={styles.previewMark}><Sparkles size={17} /></span><div><strong>Studio Aura</strong><small>Agenda de serviços</small></div><span className={styles.today}>HOJE</span></div>
          <div className={styles.previewControls}><strong>Terça-feira, 30 de setembro</strong><span>Dia&nbsp;&nbsp; Semana&nbsp;&nbsp; Mês</span></div>
          <div className={styles.previewGrid}>
            <div className={styles.hours}><span>09:00</span><span>10:00</span><span>11:00</span><span>12:00</span></div>
            <div className={styles.lessonColumn}>
              <div className={`${styles.lesson} ${styles.lessonOne}`}><strong>Limpeza de pele · Ana Costa</strong><small>Marina · Sala 1</small></div>
              <div className={`${styles.lesson} ${styles.lessonTwo}`}><strong>Design de sobrancelhas · Bia Lima</strong><small>Clara · Sala 2</small></div>
              <div className={`${styles.lesson} ${styles.lessonThree}`}><strong>Massagem facial · Luiza Reis</strong><small>Marina · Sala 1</small></div>
            </div>
          </div>
          <div className={styles.previewFooter}><span><CalendarDays size={15} /> Agenda organizada</span><span><Users size={15} /> Equipe conectada</span></div>
        </div>
      </section>

      <footer className={styles.footer}><span>© 2026 ProStetic</span><a href="mailto:contato@displaysh.com">Fale com a gente</a></footer>
    </main>
  );
}

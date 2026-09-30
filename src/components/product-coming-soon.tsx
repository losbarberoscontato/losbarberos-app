import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight } from "lucide-react";

type ProductComingSoonProps = {
  brand: "ProStetic" | "MusicPro";
  audience: string;
  context?: "home" | "login" | "manager";
};

const brandAssets = {
  ProStetic: "/display-sh/pro-stetic.png",
  MusicPro: "/music-pro/logo-neon.png",
} as const;

export function ProductComingSoon({ brand, audience, context = "home" }: ProductComingSoonProps) {
  const title = context === "login" ? "Acesso em preparação." : context === "manager" ? "Seu espaço está sendo preparado." : "Uma nova forma de cuidar da sua rotina.";

  return (
    <main className="product-coming-soon">
      <header className="product-coming-soon__header">
        <Link href="/" aria-label="Voltar ao ecossistema Display SH"><Image src="/display-sh/wordmark.png" alt="Display SH" width={205} height={64} priority /></Link>
        <span>{audience}</span>
      </header>
      <section className="product-coming-soon__content">
        <div className="product-coming-soon__mark"><Image src={brandAssets[brand]} alt={`Logomarca ${brand}`} width={400} height={114} style={{ width: "100%", height: "auto" }} /></div>
        <p className="ecosystem-overline">UMA SOLUÇÃO DISPLAY SH</p>
        <h1>{title}</h1>
        <p className="product-coming-soon__copy">Estamos preparando o {brand} para as necessidades de {audience.toLowerCase()}, com a estrutura compartilhada do ecossistema Display SH.</p>
        <span className="product-coming-soon__status"><i /> EM BREVE</span>
        <Link href="/" className="product-coming-soon__back"><ArrowLeft size={17} aria-hidden="true" /> Voltar ao ecossistema</Link>
      </section>
      <footer className="product-coming-soon__footer"><span>© 2026 Display SH</span><a href="mailto:contato@displaysh.com">Fale com a gente <ArrowUpRight size={14} /></a></footer>
    </main>
  );
}

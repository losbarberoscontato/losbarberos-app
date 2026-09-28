import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Camera, FolderKanban, UsersRound, WalletCards } from "lucide-react";

export const metadata: Metadata = {
  title: { absolute: "Le Gras — gestão para estúdios fotográficos | Display SH" },
  description: "Le Gras é a próxima solução Display SH para estúdios fotográficos.",
};

export default function LeGrasPage() {
  return (
    <main className="le-gras-page">
      <header className="le-gras-header">
        <Link href="/" aria-label="Voltar ao ecossistema Display SH"><Image src="/display-sh/wordmark.png" alt="Display SH" width={205} height={64} priority /></Link>
        <Link href="/" className="le-gras-back"><ArrowLeft size={16} /> Ecossistema</Link>
      </header>
      <section className="le-gras-hero">
        <div className="le-gras-copy">
          <Image src="/display-sh/le-gras.png" alt="Le Gras — fotografia" width={399} height={114} priority style={{ width: "100%", maxWidth: "399px", height: "auto" }} />
          <p className="ecosystem-overline">UMA NOVA SOLUÇÃO DISPLAY SH</p>
          <h1>Histórias que ficam.<br /><em>Uma rotina mais leve.</em></h1>
          <p>Le Gras está sendo preparado para estúdios fotográficos: uma forma de reunir relacionamento com clientes, agenda, projetos e gestão em um só espaço.</p>
          <span className="le-gras-status"><Camera size={16} /> Produto em preparação</span>
        </div>
        <div className="le-gras-orbit" aria-label="Áreas planejadas para o Le Gras">
          <div className="le-gras-orbit__center"><Camera size={34} strokeWidth={1.35} /><span>LE GRAS</span></div>
          <div className="le-gras-orbit__node le-gras-orbit__node--clients"><UsersRound size={19} /><span>Clientes</span></div>
          <div className="le-gras-orbit__node le-gras-orbit__node--projects"><FolderKanban size={19} /><span>Projetos</span></div>
          <div className="le-gras-orbit__node le-gras-orbit__node--finance"><WalletCards size={19} /><span>Gestão</span></div>
        </div>
      </section>
      <footer className="le-gras-footer"><span>© 2026 Display SH</span><a href="mailto:contato@displaysh.com">Fale com a gente <ArrowUpRight size={14} /></a></footer>
    </main>
  );
}

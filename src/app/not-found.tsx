import Link from "next/link";
import { ArrowLeft, Scissors } from "lucide-react";
import { Brand } from "@/components/brand";

export default function NotFound() {
  return (
    <main className="not-found-page">
      <Brand />
      <div className="not-found-page__icon"><Scissors size={36} /></div>
      <span>Erro 404</span>
      <h1>Esse corte saiu da agenda.</h1>
      <p>A página que você procura não existe ou mudou de endereço.</p>
      <Link href="/" className="button button--dark"><ArrowLeft size={17} /> Voltar ao início</Link>
    </main>
  );
}


import Link from "next/link";
import { RefreshCcw, WifiOff } from "lucide-react";
import { Brand } from "@/components/brand";

export default function OfflinePage() {
  return (
    <main className="offline-page">
      <Brand />
      <span className="offline-page__icon"><WifiOff size={34} /></span>
      <span className="eyebrow">Sem conexão</span>
      <h1>A internet deu uma pausa.</h1>
      <p>Por segurança, agenda, clientes e pagamentos não ficam salvos neste aparelho. Reconecte para continuar.</p>
      <Link href="/cliente/agendar" className="button button--dark"><RefreshCcw size={17} /> Tentar novamente</Link>
      <small>Nenhuma alteração foi enviada enquanto você estava offline.</small>
    </main>
  );
}


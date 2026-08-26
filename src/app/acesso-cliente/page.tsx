import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CalendarCheck2, ShieldCheck } from "lucide-react";

export const metadata: Metadata = {
  title: "Acesso do cliente",
  description: "Acesse sua conta Los Barberos para cuidar dos seus horários.",
};

export default function ClientAccessPage() {
  return (
    <main className="client-access-page">
      <header className="client-access-nav">
        <Link className="client-access-brand" href="/" aria-label="Los Barberos · Início">
          <span className="brand__mark" aria-hidden="true"><span>LB</span></span>
          <strong>Los Barberos</strong>
        </Link>
        <Link className="client-access-nav__manager" href="/entrar?modo=login">
          Sou gestor
        </Link>
      </header>

      <section className="client-access-card" aria-labelledby="client-access-title">
        <span className="client-access-card__mark" aria-hidden="true"><CalendarCheck2 size={26} /></span>
        <h1 id="client-access-title">Seus horários, no seu ritmo.</h1>
        <p className="client-access-card__description">
          Entre para acompanhar reservas, cuidar dos seus dados e agendar quando sua barbearia estiver disponível.
        </p>

        <div className="client-access-actions">
          <Link className="client-access-button client-access-button--primary" href="/cliente/entrar?modo=login">
            Entrar <ArrowRight size={18} aria-hidden="true" />
          </Link>
          <Link className="client-access-button client-access-button--secondary" href="/cliente/entrar?modo=cadastro">
            Fazer cadastro
          </Link>
        </div>

        <p className="client-access-card__note">
          <ShieldCheck size={16} aria-hidden="true" />
          Sua conta é pessoal. A barbearia só é vinculada quando você acessa um convite ou faz uma reserva.
        </p>
      </section>
    </main>
  );
}

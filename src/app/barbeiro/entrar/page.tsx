import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Brand } from "@/components/brand";
import { BarberAuthForm } from "@/components/connected-barber/auth-form";

export const metadata: Metadata = { title: "Entrar como Barbeiro" };

export default async function BarberLoginPage({ searchParams }: { searchParams: Promise<{ next?: string; barbearia?: string; erro?: string }> }) {
  const params = await searchParams;
  return (
    <main className="system-login-page">
      <header className="system-login-page__header">
        <Brand light />
        <Link className="system-login-page__back" href="/">
          <ArrowLeft size={17} /> Voltar ao início
        </Link>
      </header>

      <section className="system-login-page__main" aria-label="Acesso ao App do Barbeiro">
        <div className="system-login-panel">
          <BarberAuthForm next={params.next} slug={params.barbearia} error={params.erro} />
        </div>
      </section>

      <footer className="system-login-page__footer">
        <span>© Los Barberos</span>
        <span>
          Ao continuar, você concorda com os <Link href="/termos">Termos de Uso</Link> e a <Link href="/privacidade">Política de Privacidade</Link>.
        </span>
      </footer>
    </main>
  );
}

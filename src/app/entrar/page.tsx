import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Brand } from "@/components/brand";
import { DemoLogin } from "@/components/demo-login";
import { hasSupabaseConfig } from "@/lib/env";
import {
  resolveSystemAuthDestination,
  resolveSystemAuthMode,
} from "@/lib/system-auth";

export const metadata: Metadata = { title: "Entrar" };

type LoginSearchParams = Promise<{
  modo?: string | string[];
  next?: string | string[];
}>;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: LoginSearchParams;
}) {
  const params = await searchParams;
  const initialMode = resolveSystemAuthMode(params.modo);
  const nextPath = resolveSystemAuthDestination(params.next);

  return (
    <main className="system-login-page">
      <header className="system-login-page__header">
        <Brand light />
        <Link className="system-login-page__back" href="/">
          <ArrowLeft size={17} /> Voltar ao início
        </Link>
      </header>

      <section className="system-login-page__main" aria-label="Acesso ao sistema">
        <div className="system-login-panel">
          <DemoLogin
            demoMode={!hasSupabaseConfig}
            initialMode={initialMode}
            nextPath={nextPath}
          />
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

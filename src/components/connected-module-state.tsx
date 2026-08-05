import Link from "next/link";
import { ArrowRight, Database, RefreshCcw, ShieldCheck } from "lucide-react";

export function ConnectedModuleState({
  title,
  description,
  actionHref,
  actionLabel,
}: {
  title: string;
  description: string;
  actionHref?: string;
  actionLabel?: string;
}) {
  return (
    <section className="connected-module-state">
      <span className="connected-module-state__icon"><Database size={25} /></span>
      <span className="connected-module-state__status"><i /> Supabase conectado</span>
      <h2>{title}</h2>
      <p>{description}</p>
      <div><ShieldCheck size={15} /><span>Nenhum dado demonstrativo é exibido em ambiente conectado.</span></div>
      {actionHref && actionLabel ? <Link href={actionHref} className="button button--dark">{actionLabel} <ArrowRight size={16} /></Link> : <button type="button" className="button button--soft"><RefreshCcw size={16} /> Atualizar</button>}
    </section>
  );
}


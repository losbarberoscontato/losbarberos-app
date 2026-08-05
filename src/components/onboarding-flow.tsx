"use client";

import { FormEvent, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Building2, Check, ChevronDown, CreditCard, ExternalLink, Globe2, LoaderCircle, MapPin, Scissors, ShieldCheck, Sparkles } from "lucide-react";
import { Brand } from "@/components/brand";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

type OnboardingResult = {
  organization_id?: unknown;
  location_id?: unknown;
  subscription_status?: unknown;
};

function toSlug(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function OnboardingFlow({ demoMode, existingOrganizationId = null }: { demoMode: boolean; existingOrganizationId?: string | null }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [locationName, setLocationName] = useState("Unidade principal");
  const [timezone, setTimezone] = useState("America/Sao_Paulo");
  const [organizationId, setOrganizationId] = useState<string | null>(existingOrganizationId);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const idempotencyKey = useRef("");

  function changeName(value: string) {
    setName(value);
    if (!slugEdited) setSlug(toSlug(value));
  }

  async function openCheckout(orgId: string) {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return false;
    if (!idempotencyKey.current) idempotencyKey.current = crypto.randomUUID();

    const { data, error: checkoutError } = await supabase.functions.invoke("stripe-create-checkout", {
      body: { organizationId: orgId, returnPath: "/onboarding" },
      headers: { "Idempotency-Key": idempotencyKey.current },
    });
    const checkoutUrl = data && typeof data === "object" && "checkoutUrl" in data ? data.checkoutUrl : null;
    if (checkoutError || typeof checkoutUrl !== "string") {
      setError("Barbearia criada, mas o checkout não abriu. Tente novamente; seus dados já estão seguros.");
      return false;
    }

    window.location.assign(checkoutUrl);
    return true;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (demoMode) {
      setStep(2);
      return;
    }

    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setError("Supabase não configurado. Recarregue e tente novamente.");
      return;
    }

    setLoading(true);
    const { data, error: onboardingError } = await supabase.rpc("onboard_organization", {
      p_name: name.trim(),
      p_slug: slug.trim(),
      p_location_name: locationName.trim(),
      p_timezone: timezone,
    });
    const result = data as OnboardingResult | null;
    const orgId = typeof result?.organization_id === "string" ? result.organization_id : null;

    if (onboardingError || !orgId) {
      setLoading(false);
      setError(onboardingError?.message.includes("slug") ? "Este endereço já está em uso. Escolha outro." : "Não foi possível criar a barbearia. Revise os dados e tente novamente.");
      return;
    }

    setOrganizationId(orgId);
    await openCheckout(orgId);
    setLoading(false);
  }

  async function retryCheckout() {
    if (!organizationId) return;
    setLoading(true);
    setError("");
    await openCheckout(organizationId);
    setLoading(false);
  }

  if (existingOrganizationId) {
    return (
      <main className="onboarding-demo-success onboarding-recovery">
        <Brand />
        <span className="onboarding-demo-success__icon"><CreditCard size={28} /></span>
        <span className="eyebrow">Configuração pendente</span>
        <h1>Sua barbearia já foi criada.</h1>
        <p>Falta concluir o checkout seguro. Não criaremos outra organização; este botão apenas retoma o Stripe.</p>
        <div className="onboarding-recovery__note"><ShieldCheck size={17} /><span>Acesso permanece em PROVISIONING até o webhook confirmar a assinatura.</span></div>
        {error && <div className="onboarding-error" role="alert"><CreditCard size={17} /><span>{error}</span></div>}
        <button type="button" className="button button--dark" onClick={retryCheckout} disabled={loading}>{loading ? <><LoaderCircle size={17} className="is-spinning" /> Abrindo Stripe...</> : <>Retomar checkout seguro <ExternalLink size={16} /></>}</button>
      </main>
    );
  }

  if (step === 2) {
    return (
      <main className="onboarding-demo-success">
        <Brand />
        <span className="onboarding-demo-success__icon"><Check size={30} /></span>
        <span className="eyebrow">Checkpoint local concluído</span>
        <h1>Sua barbearia demo está pronta.</h1>
        <p>No ambiente real, agora abriríamos o Stripe Checkout. Acesso só fica ativo quando o webhook confirmar a assinatura.</p>
        <article><div><span>LB</span><div><strong>{name || "Minha Barbearia"}</strong><small>{locationName} · São Paulo</small></div></div><span><small>Endereço</small><strong>losbarberos.com.br/{slug || "minha-barbearia"}</strong></span><span><small>Fuso horário</small><strong>{timezone}</strong></span><span><small>Assinatura</small><strong>Demonstração · sem cobrança</strong></span></article>
        <Link href="/gestor" className="button button--dark">Explorar painel demo <ArrowRight size={17} /></Link>
      </main>
    );
  }

  return (
    <main className="onboarding-page">
      <section className="onboarding-aside">
        <Brand light />
        <div><span className="hero-pill"><Sparkles size={14} /> Comece em poucos minutos</span><h1>Vamos preparar sua barbearia.</h1><p>Conte o essencial. Depois, você personaliza equipe, catálogo e agenda.</p><ol><li className="is-current"><span>1</span><div><strong>Dados da barbearia</strong><small>Nome, unidade e endereço online</small></div></li><li><span>2</span><div><strong>Plano e pagamento</strong><small>Checkout seguro hospedado pelo Stripe</small></div></li><li><span>3</span><div><strong>Configuração operacional</strong><small>Equipe, serviços e disponibilidade</small></div></li></ol></div>
        <small><ShieldCheck size={14} /> Trial e acesso ativados somente por webhook Stripe.</small>
      </section>
      <section className="onboarding-form-side">
        <div className="onboarding-form-head"><div><span>Etapa 1 de 3</span><i><b /></i></div>{demoMode && <small><Sparkles size={13} /> Modo demonstração</small>}</div>
        <form className="onboarding-form" onSubmit={submit}>
          <div><span className="eyebrow">Sua identidade</span><h2>Como sua barbearia se chama?</h2><p>Esses dados aparecem para seus clientes no agendamento.</p></div>
          <label>Nome da barbearia<span className="input-shell"><Scissors size={18} /><input value={name} onChange={(event) => changeName(event.target.value)} placeholder="Ex.: Barbearia Central" required minLength={2} maxLength={80} /></span></label>
          <label>Endereço online<span className="slug-input"><i>losbarberos.com.br/</i><input value={slug} onChange={(event) => { setSlugEdited(true); setSlug(toSlug(event.target.value)); }} placeholder="barbearia-central" required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" /><Check size={16} /></span><small>Use letras minúsculas, números e hífens.</small></label>
          <div className="onboarding-form__divider"><span>Unidade inicial</span></div>
          <div className="onboarding-form__grid"><label>Nome da unidade<span className="input-shell"><Building2 size={18} /><input value={locationName} onChange={(event) => setLocationName(event.target.value)} required minLength={2} maxLength={80} /></span></label><label>Fuso horário<span className="select-input"><Globe2 size={17} /><select value={timezone} onChange={(event) => setTimezone(event.target.value)}><option value="America/Sao_Paulo">São Paulo · GMT-3</option><option value="America/Manaus">Manaus · GMT-4</option><option value="America/Belem">Belém · GMT-3</option><option value="America/Recife">Recife · GMT-3</option></select><ChevronDown size={15} /></span></label></div>
          <div className="onboarding-location-note"><MapPin size={17} /><span><strong>Endereço físico vem depois.</strong><small>Na configuração, você informa rua, número e como chegar.</small></span></div>
          {error && <div className="onboarding-error" role="alert"><CreditCard size={17} /><span>{error}</span>{organizationId && <button type="button" onClick={retryCheckout}>Tentar checkout novamente</button>}</div>}
          <button type="submit" className="button button--dark button--block onboarding-submit" disabled={loading}>{loading ? <><LoaderCircle size={17} className="is-spinning" /> Preparando checkout...</> : <>{demoMode ? "Criar barbearia demo" : "Continuar para o Stripe"} <ExternalLink size={16} /></>}</button>
          <p className="onboarding-stripe-note"><ShieldCheck size={14} /> Los Barberos nunca coleta dados de cartão. O próximo passo acontece no Stripe.</p>
        </form>
      </section>
    </main>
  );
}

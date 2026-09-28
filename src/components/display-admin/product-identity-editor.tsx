"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Eye, ImagePlus, LoaderCircle, Palette, Save, Type, BookText } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import styles from "./product-identity-editor.module.css";

type ProductKey = "los-barberos" | "le-gras" | "pro-stetic" | "music-pro";
type Identity = { brand: { name: string; tagline: string; mark: string; logoUrl: string }; colors: Record<string, string>; fonts: { interface: string; display: string }; vocabulary: Record<string, string> };
const PRODUCTS: { key: ProductKey; name: string; segment: string; mark: string }[] = [
  { key: "los-barberos", name: "Los Barberos", segment: "Barbearias", mark: "LB" },
  { key: "le-gras", name: "Le Gras", segment: "Fotografia", mark: "LG" },
  { key: "pro-stetic", name: "ProStetic", segment: "Estética e beleza", mark: "PS" },
  { key: "music-pro", name: "MusicPro", segment: "Escolas de música", mark: "MP" },
];
const COLOR_LABELS: Record<string, string> = { primary: "Cor principal", secondary: "Cor secundária", accent: "Destaque", background: "Fundo", surface: "Superfície", text: "Texto", muted: "Texto auxiliar", border: "Bordas", success: "Sucesso", danger: "Erro" };
const VOCAB_LABELS: Record<string, string> = { organization: "Organização (singular)", organizationPlural: "Organização (plural)", professional: "Profissional (singular)", professionalPlural: "Profissional (plural)", teamApp: "Nome do app da equipe", organizationPicker: "Seletor do cliente" };
const TABS = [{ key: "vocabulary", label: "Vocabulário", icon: BookText }, { key: "colors", label: "Cores", icon: Palette }, { key: "logos", label: "Logomarcas", icon: ImagePlus }, { key: "copy", label: "Frases e fontes", icon: Type }] as const;

function asIdentity(value: unknown): Identity | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Identity;
  return candidate.brand && candidate.colors && candidate.fonts && candidate.vocabulary ? candidate : null;
}

export function ProductIdentityEditor() {
  const [product, setProduct] = useState<ProductKey>("los-barberos");
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("vocabulary");
  const [config, setConfig] = useState<Identity | null>(null);
  const [revision, setRevision] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const selected = useMemo(() => PRODUCTS.find((item) => item.key === product)!, [product]);

  const load = useCallback(async (key: ProductKey) => {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/display-admin/product-identity?product=${key}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Falha ao carregar configuração.");
      const next = asIdentity(body.draft?.config ?? body.published?.config);
      if (!next) throw new Error("Não foi possível interpretar a identidade salva.");
      setConfig(next); setRevision(body.published?.revision ?? null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao carregar."); setConfig(null); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(product), 0);
    return () => window.clearTimeout(timer);
  }, [product, load]);

  function update(group: "brand" | "colors" | "fonts" | "vocabulary", key: string, value: string) {
    setConfig((current) => current ? ({ ...current, [group]: { ...current[group], [key]: value } }) : current);
  }

  async function save(publish: boolean) {
    if (!config) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const saved = await fetch("/api/display-admin/product-identity", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productKey: product, config }) });
      const saveBody = await saved.json();
      if (!saved.ok) throw new Error(saveBody.error ?? "Não foi possível salvar.");
      if (publish) {
        const response = await fetch("/api/display-admin/product-identity", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productKey: product }) });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Não foi possível publicar.");
        setRevision(body.revision); setMessage(`Publicado como revisão ${body.revision}.`);
      } else setMessage("Rascunho salvo. Ainda não aparece para os usuários.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao salvar."); }
    finally { setBusy(false); }
  }

  async function uploadLogo(file?: File) {
    if (!file || !config) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 2 * 1024 * 1024) { setError("Use PNG, JPEG ou WebP de até 2 MB."); return; }
    const supabase = getSupabaseBrowserClient();
    if (!supabase) { setError("Supabase não está configurado."); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      const path = `${product}/${Date.now()}-${crypto.randomUUID()}.${file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg"}`;
      const { error: uploadError } = await supabase.storage.from("product-brand-assets").upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from("product-brand-assets").getPublicUrl(path);
      update("brand", "logoUrl", data.publicUrl); setMessage("Logo enviada. Salve o rascunho para guardar essa versão.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao enviar logo."); }
    finally { setBusy(false); }
  }

  return <div className={styles.editor}>
    <section className={styles.workarea}>
      <div className={styles.productPicker} aria-label="Selecionar produto">{PRODUCTS.map((item) => <button key={item.key} type="button" onClick={() => setProduct(item.key)} className={item.key === product ? styles.selectedProduct : ""}><span>{item.mark}</span><strong>{item.name}</strong><small>{item.segment}</small></button>)}</div>
      <div className={styles.editorHead}><div><span className={styles.eyebrow}>PRODUTO SELECIONADO</span><h2>{selected.name}</h2><p>{revision ? `Publicada · revisão ${revision}` : "Configuração inicial"} · rascunho isolado até publicar</p></div><div className={styles.actions}><button type="button" disabled={busy || !config} onClick={() => void save(false)}><Save size={15}/>Salvar rascunho</button><button type="button" disabled={busy || !config} onClick={() => void save(true)} className={styles.publish}><Check size={15}/>Publicar</button></div></div>
      <div className={styles.tabs} role="tablist">{TABS.map(({ key, label, icon: Icon }) => <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? styles.activeTab : ""} onClick={() => setTab(key)}><Icon size={16}/>{label}</button>)}</div>
      {busy && !config ? <p className={styles.loading}><LoaderCircle size={18}/>Carregando identidade…</p> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}{message ? <p className={styles.success} role="status">{message}</p> : null}
      {config && tab === "vocabulary" ? <div className={styles.fields}>{Object.entries(VOCAB_LABELS).map(([key, label]) => <label key={key}>{label}<input value={config.vocabulary[key] ?? ""} maxLength={100} onChange={(event) => update("vocabulary", key, event.target.value)}/><small>Rótulo de interface. Nomes técnicos, rotas e regras continuam iguais.</small></label>)}</div> : null}
      {config && tab === "colors" ? <div className={styles.colorGrid}>{Object.entries(config.colors).map(([key, value]) => <label key={key}><span className={styles.swatch} style={{ background: /^#[\da-f]{6}$/i.test(value) ? value : "transparent" }}/><span>{COLOR_LABELS[key] ?? key}</span><input type="color" value={/^#[\da-f]{6}$/i.test(value) ? value : "#12352e"} onChange={(event) => update("colors", key, event.target.value)}/><code>{value}</code></label>)}</div> : null}
      {config && tab === "logos" ? <div className={styles.fields}><div className={styles.logoPreview}>{config.brand.logoUrl ? <img src={config.brand.logoUrl} alt={`Logo ${config.brand.name}`}/> : <span>{config.brand.mark}</span>}</div><label>Enviar nova logomarca<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void uploadLogo(event.target.files?.[0])}/><small>PNG, JPEG ou WebP até 2 MB. A imagem enviada só é usada após publicar a identidade.</small></label><label>Caminho ou URL atual<input value={config.brand.logoUrl} maxLength={300} onChange={(event) => update("brand", "logoUrl", event.target.value)}/></label><label>Sigla do símbolo<input value={config.brand.mark} maxLength={8} onChange={(event) => update("brand", "mark", event.target.value)}/></label></div> : null}
      {config && tab === "copy" ? <div className={styles.fields}><label>Nome do produto<input value={config.brand.name} maxLength={100} onChange={(event) => update("brand", "name", event.target.value)}/></label><label>Frase junto à marca<input value={config.brand.tagline} maxLength={150} onChange={(event) => update("brand", "tagline", event.target.value)}/></label><label>Fonte de interface<select value={config.fonts.interface} onChange={(event) => update("fonts", "interface", event.target.value)}>{["Inter", "Arial", "Roboto", "system-ui"].map((font) => <option key={font}>{font}</option>)}</select></label><label>Fonte de títulos<select value={config.fonts.display} onChange={(event) => update("fonts", "display", event.target.value)}>{["Baskerville", "Georgia", "Arial"].map((font) => <option key={font}>{font}</option>)}</select></label><small>Fontes ficam limitadas às opções disponíveis sem carregar fontes externas.</small></div> : null}
    </section>
    <aside className={styles.preview}><header><span><Eye size={16}/>PRÉVIA</span><span>Identidade do produto</span></header><div className={styles.previewCard} style={{ background: config?.colors.background, color: config?.colors.text, fontFamily: config?.fonts.interface }}><div className={styles.previewBrand} style={{ background: config?.colors.primary }}><div className={styles.previewLogo}>{config?.brand.logoUrl ? <img src={config.brand.logoUrl} alt=""/> : config?.brand.mark}</div><div><strong>{config?.brand.name}</strong><small>{config?.brand.tagline}</small></div></div><div className={styles.previewBody}><span style={{ color: config?.colors.secondary }}>GESTÃO PARA NEGÓCIOS</span><h3>Um espaço para cuidar da sua equipe e dos seus clientes.</h3><p style={{ color: config?.colors.muted }}>A aparência muda por produto. Os dados e recursos seguem no mesmo sistema.</p><button type="button" style={{ background: config?.colors.accent, color: config?.colors.primary }}>Conheça o sistema</button><div className={styles.previewModule}><span style={{ background: config?.colors.secondary }}>A</span><div><strong>Agenda</strong><small>{config?.vocabulary.professional} · {config?.vocabulary.organization}</small></div></div></div></div><p className={styles.previewNote}>Prévia ilustrativa. Não contém dados reais.</p></aside>
  </div>;
}

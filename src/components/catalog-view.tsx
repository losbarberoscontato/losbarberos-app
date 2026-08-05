"use client";

import { useState } from "react";
import { Check, Clock3, MoreHorizontal, PackageOpen, Plus, Scissors, Sparkles, Tag } from "lucide-react";
import { formatMoney, packages, services } from "@/data/demo";

export function CatalogView() {
  const [tab, setTab] = useState<"services" | "packages">("services");
  const [toast, setToast] = useState("");

  function demoAction(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2800);
  }

  return (
    <>
      <div className="catalog-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "services"} onClick={() => setTab("services")}><Scissors size={17} /> Serviços <span>{services.length}</span></button>
        <button type="button" role="tab" aria-selected={tab === "packages"} onClick={() => setTab("packages")}><PackageOpen size={17} /> Pacotes <span>{packages.length}</span></button>
      </div>

      {tab === "services" ? (
        <section className="catalog-grid">
          {services.map((service, index) => (
            <article className="catalog-card panel" key={service.id}>
              <div className="catalog-card__head"><span className={`catalog-card__icon tone-${index % 3}`}><Scissors size={20} /></span><span className="catalog-card__status"><i /> Ativo</span><button type="button" className="icon-button icon-button--sm"><MoreHorizontal size={17} /></button></div>
              <div><span className="catalog-card__category">{service.category}</span>{service.popular && <span className="catalog-card__popular"><Sparkles size={12} /> Mais reservado</span>}</div>
              <h2>{service.name}</h2>
              <p>{service.description}</p>
              <div className="catalog-card__meta"><span><Clock3 size={15} />{service.durationMinutes} min</span><strong>{formatMoney(service.priceCents)}</strong></div>
              <div className="catalog-card__footer"><span>3 profissionais habilitados</span><button type="button" onClick={() => demoAction(`${service.name} aberto para edição.`)}>Editar</button></div>
            </article>
          ))}
          <button type="button" className="catalog-add-card" onClick={() => demoAction("Formulário de novo serviço iniciado.")}><span><Plus size={22} /></span><strong>Novo serviço</strong><small>Adicione duração, preço e equipe.</small></button>
        </section>
      ) : (
        <section className="packages-grid">
          {packages.map((item) => (
            <article className={`package-card ${item.featured ? "is-featured" : ""}`} key={item.id}>
              <div className="package-card__visual"><span><PackageOpen size={26} /></span>{item.featured && <small><Sparkles size={13} /> Destaque na PWA</small>}</div>
              <div className="package-card__body"><span className="catalog-card__category">{item.items} procedimentos</span><h2>{item.name}</h2><p>{item.description}</p><div className="package-card__items"><span><Check size={14} /> Uma única visita</span><span><Clock3 size={14} /> {item.durationMinutes} min</span></div><div className="package-card__price"><span><small>De {formatMoney(item.listPriceCents)}</small><strong>{formatMoney(item.priceCents)}</strong></span><i>{Math.round((1 - item.priceCents / item.listPriceCents) * 100)}% off</i></div><button type="button" onClick={() => demoAction(`${item.name} aberto para edição.`)}>Editar pacote</button></div>
            </article>
          ))}
          <button type="button" className="package-add-card" onClick={() => demoAction("Construtor de pacote iniciado.")}><span><Tag size={24} /></span><strong>Criar novo pacote</strong><small>Combine serviços e defina um preço especial.</small><i><Plus size={15} /> Começar</i></button>
        </section>
      )}
      {toast && <div className="toast-message"><Check size={17} /><span>{toast}</span></div>}
    </>
  );
}

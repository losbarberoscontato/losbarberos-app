"use client";

import { FormEvent, useMemo, useState } from "react";
import { Cake, Check, ChevronDown, Download, Mail, MoreHorizontal, Phone, Search, Tag, UserPlus, X } from "lucide-react";
import { customers, formatMoney } from "@/data/demo";
import { Avatar } from "@/components/ui";

export function CustomersView() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("Todos os clientes");
  const [createOpen, setCreateOpen] = useState(false);
  const [toast, setToast] = useState("");

  const results = useMemo(() => customers.filter((customer) => {
    const matchesQuery = `${customer.name} ${customer.email} ${customer.phone}`.toLowerCase().includes(query.toLowerCase());
    const matchesFilter = filter === "Todos os clientes" || (filter === "Fieis" && customer.tags.includes("Fiel")) || (filter === "Novos" && customer.tags.includes("Novo")) || (filter === "Com retorno" && customer.nextVisit);
    return matchesQuery && matchesFilter;
  }), [filter, query]);

  function createCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateOpen(false);
    setToast("Cliente cadastrado na demonstração.");
    window.setTimeout(() => setToast(""), 3000);
  }

  return (
    <>
      <section className="customer-summary">
        <div><span>Base ativa</span><strong>486</strong><small>clientes com cadastro</small></div>
        <div><span>Retorno em 30 dias</span><strong>68%</strong><small><i>+7%</i> neste trimestre</small></div>
        <div><span>Ticket médio</span><strong>R$ 84</strong><small>últimos 90 dias</small></div>
        <div><span>Aniversariantes</span><strong>12</strong><small>neste mês</small></div>
      </section>

      <section className="panel customers-panel">
        <div className="customers-toolbar">
          <label className="search-input"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar nome, telefone ou e-mail" aria-label="Buscar clientes" />{query && <button type="button" onClick={() => setQuery("")} aria-label="Limpar busca"><X size={15} /></button>}</label>
          <label className="select-shell"><select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Filtrar clientes"><option>Todos os clientes</option><option>Fieis</option><option>Novos</option><option>Com retorno</option></select><ChevronDown size={14} /></label>
          <button type="button" className="button button--soft"><Download size={16} /> Exportar</button>
          <button type="button" className="button button--dark" onClick={() => setCreateOpen(true)}><UserPlus size={17} /> Novo cliente</button>
        </div>
        <div className="customers-table-wrap">
          <table className="data-table customers-table">
            <thead><tr><th>Cliente</th><th>Contato</th><th>Visitas</th><th>Total gasto</th><th>Última visita</th><th>Próxima</th><th><span className="sr-only">Ações</span></th></tr></thead>
            <tbody>
              {results.map((customer, index) => (
                <tr key={customer.id}>
                  <td><div className="table-person"><Avatar initials={customer.initials} tone={index % 3 === 0 ? "sage" : index % 3 === 1 ? "amber" : "blue"} /><span><strong>{customer.name}</strong><small>{customer.tags.map((tag) => <i key={tag}>{tag}</i>)}</small></span></div></td>
                  <td><span className="customer-contact"><strong>{customer.phone}</strong><small>{customer.email}</small></span></td>
                  <td><strong>{customer.visits}</strong></td>
                  <td><strong>{formatMoney(customer.totalCents)}</strong></td>
                  <td><span className="table-date">{customer.lastVisit}</span></td>
                  <td>{customer.nextVisit ? <span className="next-visit">{customer.nextVisit}</span> : <span className="muted-dash">—</span>}</td>
                  <td><button type="button" className="icon-button icon-button--sm" aria-label={`Ações de ${customer.name}`}><MoreHorizontal size={17} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {results.length === 0 && <div className="empty-search"><Search size={24} /><strong>Nenhum cliente encontrado</strong><span>Tente outro termo ou remova o filtro.</span></div>}
        </div>
        <footer className="table-footer"><span>Mostrando {results.length} de 486 clientes</span><div><button type="button" disabled>Anterior</button><button type="button" className="is-active">1</button><button type="button">2</button><button type="button">3</button><span>...</span><button type="button">49</button><button type="button">Próxima</button></div></footer>
      </section>

      {createOpen && (
        <div className="modal-layer">
          <button className="modal-layer__backdrop" type="button" aria-label="Fechar" onClick={() => setCreateOpen(false)} />
          <form className="form-modal" onSubmit={createCustomer}>
            <div className="form-modal__head"><span><small>Cadastro manual</small><strong>Novo cliente</strong></span><button type="button" className="icon-button" onClick={() => setCreateOpen(false)} aria-label="Fechar"><X size={19} /></button></div>
            <div className="form-modal__body">
              <label>Nome completo<span className="input-shell"><UserPlus size={17} /><input required placeholder="Ex.: Gabriel Oliveira" /></span></label>
              <div className="form-grid"><label>Telefone<span className="input-shell"><Phone size={17} /><input required type="tel" placeholder="+55 11 99999-9999" /></span></label><label>E-mail <small>opcional</small><span className="input-shell"><Mail size={17} /><input type="email" placeholder="cliente@email.com" /></span></label></div>
              <div className="form-grid"><label>Data de nascimento <small>opcional</small><span className="input-shell"><Cake size={17} /><input type="date" /></span></label><label>Etiqueta <small>opcional</small><span className="input-shell"><Tag size={17} /><input placeholder="Ex.: Indicação" /></span></label></div>
              <label>Observações <small>opcional</small><textarea rows={3} placeholder="Preferências e detalhes relevantes para o atendimento..." /></label>
              <label className="check-row"><input type="checkbox" defaultChecked /><span><strong>Consentimento transacional registrado</strong><small>Permite confirmações e lembretes da reserva pelo WhatsApp.</small></span></label>
            </div>
            <div className="form-modal__footer"><button type="button" className="button button--ghost" onClick={() => setCreateOpen(false)}>Cancelar</button><button type="submit" className="button button--dark"><Check size={17} /> Salvar cliente</button></div>
          </form>
        </div>
      )}
      {toast && <div className="toast-message"><Check size={17} /><span>{toast}</span></div>}
    </>
  );
}


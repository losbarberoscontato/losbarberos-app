"use client";

import { useState } from "react";

export type AuxiliaryServiceDraft = {
  service_id: string;
  name: string;
  quantity: number;
};

export type AuxiliaryCommissionDraft = {
  commission_mode: "FIXED" | "PERCENT";
  fixed_cents: number | null;
  percentage_bps: number | null;
  fixed_input?: string;
  percentage_input?: string;
};

export type AuxiliaryDraft = {
  barber_id: string;
  commissions: Record<string, AuxiliaryCommissionDraft>;
};

type Props = {
  barbers: Array<{ id: string; display_name: string }>;
  excludedBarberId: string;
  services: AuxiliaryServiceDraft[];
  value: AuxiliaryDraft[];
  onChange: (value: AuxiliaryDraft[]) => void;
};

function emptyAuxiliary(services: AuxiliaryServiceDraft[]): AuxiliaryDraft {
  return {
    barber_id: "",
    commissions: Object.fromEntries(services.map((service) => [service.service_id, {
      commission_mode: "FIXED",
      fixed_cents: null,
      percentage_bps: null,
      fixed_input: "",
      percentage_input: "",
    }])),
  };
}

function decimalToMinorUnits(raw: string): number | null {
  const normalized = raw.trim().replace(",", ".");
  if (!normalized) return null;
  if (!/^\d+(?:\.\d{0,2})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

function displayMoney(cents: number | null) {
  return cents === null ? "" : (cents / 100).toFixed(2).replace(".", ",");
}

export function AppointmentAuxiliaryFields({ barbers, excludedBarberId, services, value, onChange }: Props) {
  const [editorState, setEditorState] = useState<{ draft: AuxiliaryDraft; index: number | null; serviceKey: string; excludedBarberId: string } | null>(null);
  const [error, setError] = useState("");
  const serviceKey = services.map((service) => `${service.service_id}:${service.quantity}`).join("|");
  const editor = editorState?.serviceKey === serviceKey && editorState.excludedBarberId === excludedBarberId ? editorState : null;

  const available = barbers.filter((barber) => barber.id !== excludedBarberId);
  const selectedIndex = editor?.index ?? -1;
  const eligibleBarbers = available.filter((barber) => !value.some((item, index) => index !== selectedIndex && item.barber_id === barber.id));

  function updateDraft(update: Partial<AuxiliaryDraft>) {
    if (!editor) return;
    setEditorState({ ...editor, draft: { ...editor.draft, ...update } });
  }

  function updateCommission(serviceId: string, update: Partial<AuxiliaryCommissionDraft>) {
    if (!editor) return;
    const commission = editor.draft.commissions[serviceId] ?? {
      commission_mode: "FIXED" as const,
      fixed_cents: null,
      percentage_bps: null,
      fixed_input: "",
      percentage_input: "",
    };
    updateDraft({ commissions: {
      ...editor.draft.commissions,
      [serviceId]: { ...commission, ...update },
    } });
  }

  function saveDraft() {
    if (!editor) return;
    if (!editor.draft.barber_id) {
      setError("Selecione o profissional auxiliar.");
      return;
    }
    if (value.some((item, index) => index !== editor.index && item.barber_id === editor.draft.barber_id)) {
      setError("Cada profissional pode ser selecionado uma única vez como auxiliar.");
      return;
    }
    try {
      auxiliaryDraftToServicePayload([editor.draft]);
      onChange(editor.index === null
        ? [...value, editor.draft]
        : value.map((item, index) => index === editor.index ? editor.draft : item));
      setEditorState(null);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Confira os dados da comissão.");
    }
  }

  function startAdding() {
    setError("");
    setEditorState({ draft: emptyAuxiliary(services), index: null, serviceKey, excludedBarberId });
  }

  function startEditing(auxiliary: AuxiliaryDraft, index: number) {
    const fresh = emptyAuxiliary(services);
    const commissions = Object.fromEntries(services.map((service) => {
      const saved = auxiliary.commissions[service.service_id];
      if (!saved) return [service.service_id, fresh.commissions[service.service_id]];
      return [service.service_id, {
        ...saved,
        fixed_input: saved.fixed_input ?? displayMoney(saved.fixed_cents),
        percentage_input: saved.percentage_input ?? (saved.percentage_bps === null ? "" : (saved.percentage_bps / 100).toFixed(2).replace(".", ",")),
      }];
    }));
    setError("");
    setEditorState({ draft: { ...auxiliary, commissions }, index, serviceKey, excludedBarberId });
  }

  return <section className="appointment-auxiliary-fields" aria-label="Profissionais auxiliares">
    <div className="appointment-auxiliary-fields__heading">
      <strong>Auxiliares</strong>
      <small>Até 3 · comissão separada do valor cobrado do cliente</small>
    </div>
    {value.map((auxiliary, index) => {
      const barber = barbers.find((item) => item.id === auxiliary.barber_id);
      const commissions = Object.values(auxiliary.commissions).map((commission) => commission.commission_mode === "FIXED"
        ? `R$ ${displayMoney(commission.fixed_cents)}`
        : `${((commission.percentage_bps ?? 0) / 100).toFixed(2).replace(".", ",")}%`);
      return <div className="appointment-auxiliary-summary" key={`${index}-${auxiliary.barber_id}`}>
        <div><strong>Auxiliar {index + 1}: {barber?.display_name ?? "Profissional"}</strong><small>{commissions.join(" · ")}</small></div>
        <div className="appointment-auxiliary-fields__actions">
          <button className="button button--ghost" type="button" onClick={() => startEditing(auxiliary, index)}>Editar</button>
          <button className="button button--ghost" type="button" onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))}>Remover auxiliar</button>
        </div>
      </div>;
    })}

    {editor && <fieldset className="appointment-auxiliary-fields__card">
      <legend>{editor.index === null ? `Auxiliar ${value.length + 1}` : `Editar auxiliar ${editor.index + 1}`}</legend>
      <div className="form-grid">
        <label>Profissional auxiliar<span className="select-input"><select value={editor.draft.barber_id} onChange={(event) => updateDraft({ barber_id: event.target.value })}>
          <option value="">Selecione da Equipe</option>
          {eligibleBarbers.map((barber) => <option value={barber.id} key={barber.id}>{barber.display_name}</option>)}
        </select></span></label>
      </div>
      {services.map((service) => {
        const commission = editor.draft.commissions[service.service_id] ?? { commission_mode: "FIXED" as const, fixed_cents: null, percentage_bps: null, fixed_input: "", percentage_input: "" };
        return <div className="appointment-auxiliary-fields__service" key={service.service_id}>
          <strong>{service.name}{service.quantity > 1 ? ` · ${service.quantity}x` : ""}</strong>
          <div className="form-grid">
            <label>Tipo de comissão<span className="select-input"><select value={commission.commission_mode} onChange={(event) => updateCommission(service.service_id, {
              commission_mode: event.target.value as "FIXED" | "PERCENT",
              fixed_cents: null,
              percentage_bps: null,
              fixed_input: "",
              percentage_input: "",
            })}><option value="FIXED">Valor fixo por serviço</option><option value="PERCENT">Percentual do preço de tabela</option></select></span></label>
            {commission.commission_mode === "FIXED" ? <label>Valor por unidade (R$)<input type="text" inputMode="decimal" value={commission.fixed_input ?? displayMoney(commission.fixed_cents)} onChange={(event) => {
              const raw = event.target.value;
              updateCommission(service.service_id, { fixed_input: raw, fixed_cents: decimalToMinorUnits(raw) });
            }} /></label> : <label>Percentual (%)<input type="text" inputMode="decimal" value={commission.percentage_input ?? (commission.percentage_bps === null ? "" : (commission.percentage_bps / 100).toFixed(2))} onChange={(event) => {
              const raw = event.target.value;
              updateCommission(service.service_id, { percentage_input: raw, percentage_bps: decimalToMinorUnits(raw) });
            }} /></label>}
          </div>
          {commission.commission_mode === "PERCENT" && <small>Base: preço de tabela do serviço, sem alterar cobrança do cliente.</small>}
        </div>;
      })}
      {error && <small className="appointment-auxiliary-fields__error" role="alert">{error}</small>}
      <div className="appointment-auxiliary-fields__actions">
        <button className="button button--ghost" type="button" onClick={() => { setEditorState(null); setError(""); }}>Cancelar</button>
        <button className="button button--soft" type="button" disabled={!services.length} onClick={saveDraft}>Salvar auxiliar</button>
      </div>
    </fieldset>}

    {!editor && value.length < 3 && <button className="button button--soft" type="button" disabled={!services.length || eligibleBarbers.length === 0} onClick={startAdding}>Adicionar Auxiliar</button>}
    {services.length === 0 && <small>Selecione serviço ou pacote antes de configurar auxiliares.</small>}
  </section>;
}

export function auxiliaryDraftToServicePayload(value: AuxiliaryDraft[]) {
  return value.map((auxiliary) => ({
    barber_id: auxiliary.barber_id,
    commissions: Object.entries(auxiliary.commissions).map(([service_id, commission]) => {
      if (commission.commission_mode === "FIXED") {
        if (commission.fixed_cents === null || !Number.isSafeInteger(commission.fixed_cents) || commission.fixed_cents < 0) {
          throw new Error("Informe valor fixo válido para cada serviço auxiliar.");
        }
        return { service_id, commission_mode: "FIXED", fixed_cents: commission.fixed_cents };
      }
      if (commission.percentage_bps === null || !Number.isInteger(commission.percentage_bps) || commission.percentage_bps < 0 || commission.percentage_bps > 10000) {
        throw new Error("Informe percentual válido para cada serviço auxiliar.");
      }
      return { service_id, commission_mode: "PERCENT", percentage_bps: commission.percentage_bps };
    }),
  }));
}

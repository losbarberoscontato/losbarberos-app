"use client";

export type AuxiliaryServiceDraft = {
  service_id: string;
  name: string;
  quantity: number;
};

export type AuxiliaryCommissionDraft = {
  commission_mode: "FIXED" | "PERCENT";
  fixed_cents: number | null;
  percentage_bps: number | null;
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
    }])),
  };
}

export function AppointmentAuxiliaryFields({ barbers, excludedBarberId, services, value, onChange }: Props) {
  const available = barbers.filter((barber) => barber.id !== excludedBarberId);

  function updateAuxiliary(index: number, update: Partial<AuxiliaryDraft>) {
    onChange(value.map((auxiliary, current) => current === index ? { ...auxiliary, ...update } : auxiliary));
  }

  function updateCommission(index: number, serviceId: string, update: Partial<AuxiliaryCommissionDraft>) {
    const auxiliary = value[index];
    if (!auxiliary) return;
    updateAuxiliary(index, { commissions: {
      ...auxiliary.commissions,
      [serviceId]: { ...auxiliary.commissions[serviceId], ...update },
    } });
  }

  return <section className="appointment-auxiliary-fields" aria-label="Profissionais auxiliares">
    <div className="appointment-auxiliary-fields__heading">
      <strong>Auxiliares</strong>
      <small>Até 3 · comissão separada do valor cobrado do cliente</small>
    </div>
    {value.map((auxiliary, index) => <fieldset className="appointment-auxiliary-fields__card" key={`${index}-${auxiliary.barber_id}`}>
      <legend>Auxiliar {index + 1}</legend>
      <div className="form-grid">
        <label>Profissional auxiliar<span className="select-input"><select required value={auxiliary.barber_id} onChange={(event) => updateAuxiliary(index, { barber_id: event.target.value })}>
          <option value="">Selecione da Equipe</option>
          {available.filter((barber) => !value.some((item, itemIndex) => itemIndex !== index && item.barber_id === barber.id)).map((barber) => <option value={barber.id} key={barber.id}>{barber.display_name}</option>)}
        </select></span></label>
        <button className="button button--ghost" type="button" onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))}>Remover auxiliar</button>
      </div>
      {services.map((service) => {
        const commission = auxiliary.commissions[service.service_id] ?? { commission_mode: "FIXED" as const, fixed_cents: null, percentage_bps: null };
        return <div className="appointment-auxiliary-fields__service" key={service.service_id}>
          <strong>{service.name}{service.quantity > 1 ? ` · ${service.quantity}x` : ""}</strong>
          <div className="form-grid">
            <label>Tipo de comissão<span className="select-input"><select value={commission.commission_mode} onChange={(event) => updateCommission(index, service.service_id, {
              commission_mode: event.target.value as "FIXED" | "PERCENT",
              fixed_cents: null,
              percentage_bps: null,
            })}><option value="FIXED">Valor fixo por serviço</option><option value="PERCENT">Percentual do preço de tabela</option></select></span></label>
            {commission.commission_mode === "FIXED" ? <label>Valor por unidade (R$)<input type="number" min="0" step="0.01" required value={commission.fixed_cents === null ? "" : (commission.fixed_cents / 100).toFixed(2)} onChange={(event) => updateCommission(index, service.service_id, { fixed_cents: event.target.value === "" ? null : Math.round(Number(event.target.value) * 100) })} /></label> : <label>Percentual (%)<input type="number" min="0" max="100" step="0.01" required value={commission.percentage_bps === null ? "" : (commission.percentage_bps / 100).toFixed(2)} onChange={(event) => updateCommission(index, service.service_id, { percentage_bps: event.target.value === "" ? null : Math.round(Number(event.target.value) * 100) })} /></label>}
          </div>
          {commission.commission_mode === "PERCENT" && <small>Base: preço de tabela do serviço, sem alterar cobrança do cliente.</small>}
        </div>;
      })}
    </fieldset>)}
    {value.length < 3 && <button className="button button--soft" type="button" disabled={!services.length || available.length === 0} onClick={() => onChange([...value, emptyAuxiliary(services)])}>Adicionar auxiliar</button>}
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

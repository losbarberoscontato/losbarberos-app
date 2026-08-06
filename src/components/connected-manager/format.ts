const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export const BUSINESS_SLOT_INTERVAL_MINUTES = 15;

export function formatCents(value: number | string | null | undefined) {
  const numeric = typeof value === "string" ? Number(value) : (value ?? 0);
  return currencyFormatter.format(Number.isFinite(numeric) ? numeric / 100 : 0);
}

export function centsFromInput(value: FormDataEntryValue | null) {
  const normalized = String(value ?? "").trim().replace(/\./g, "").replace(",", ".");
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric) || numeric < 0) throw new Error("Informe um valor válido.");
  return Math.round(numeric * 100);
}

export function parsePostgresRange(range: string): { start: Date; end: Date } | null {
  if (range.length < 5 || !"[(".includes(range[0]) || !")]".includes(range.at(-1) ?? "")) return null;
  const values = range.slice(1, -1).split(",").map((value) => value.trim().replace(/^"|"$/g, ""));
  if (values.length !== 2) return null;
  const start = new Date(values[0]);
  const end = new Date(values[1]);
  if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf())) return null;
  return { start, end };
}

export function formatRange(range: string, timezone = "America/Sao_Paulo") {
  const parsed = parsePostgresRange(range);
  if (!parsed) return "Horário indisponível";
  const day = new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    day: "2-digit",
    month: "short",
  }).format(parsed.start);
  const time = new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${day} · ${time.format(parsed.start)}–${time.format(parsed.end)}`;
}

function zonedParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

export function localDateTimeToIso(value: string, timezone: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/u.exec(value);
  if (!match) throw new Error("Data e hora inválidas.");
  const [, year, month, day, hour, minute] = match;
  const desiredUtc = Date.UTC(+year, +month - 1, +day, +hour, +minute);
  let candidate = desiredUtc;

  for (let pass = 0; pass < 2; pass += 1) {
    const parts = zonedParts(new Date(candidate), timezone);
    const representedUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
    candidate += desiredUtc - representedUtc;
  }

  const resolved = new Date(candidate);
  const check = zonedParts(resolved, timezone);
  if (`${check.year}-${check.month}-${check.day}T${check.hour}:${check.minute}` !== value) {
    throw new Error("Horário inexistente ou ambíguo no fuso da organização.");
  }
  return resolved.toISOString();
}

export function isAlignedToSlot(value: string, intervalMinutes: number) {
  const match = /T(\d{2}):(\d{2})$/u.exec(value);
  if (!match || !Number.isInteger(intervalMinutes) || intervalMinutes <= 0) return false;
  return (Number(match[1]) * 60 + Number(match[2])) % intervalMinutes === 0;
}

export function toPostgresRange(start: string, end: string, timezone = "America/Sao_Paulo") {
  const startDate = new Date(localDateTimeToIso(start, timezone));
  const endDate = new Date(localDateTimeToIso(end, timezone));
  if (Number.isNaN(startDate.valueOf()) || Number.isNaN(endDate.valueOf()) || startDate >= endDate) {
    throw new Error("Período inválido.");
  }
  return `[${startDate.toISOString()},${endDate.toISOString()})`;
}

export function humanizeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "Erro inesperado.");
  const dictionary: Array<[RegExp, string]> = [
    [/start time is not aligned to slot interval/i, "Escolha um horário alinhado ao intervalo de slots da agenda."],
    [/requested slot is no longer available|exclusion constraint/i, "Esse horário acabou de ser ocupado."],
    [/duplicate key|unique constraint/i, "Já existe um cadastro igual ativo."],
    [/organization is not accepting/i, "A assinatura está bloqueada para novas reservas."],
    [/override reason required/i, "Informe o motivo para agendar fora da escala."],
    [/row-level security|permission denied|organization owner required/i, "Acesso negado para esta organização."],
    [/phone_e164|customers_phone/i, "Use telefone no formato +5511999999999 e sem duplicidade."],
    [/no positive unpaid commission/i, "Não há comissão positiva em aberto nesse período."],
  ];
  return dictionary.find(([pattern]) => pattern.test(message))?.[1] ?? message;
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export const weekDays = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export const reminderRuleKeys = [
  "reminder_t24_enabled",
  "reminder_morning_enabled",
  "reminder_t180_enabled",
  "reminder_t45_enabled",
] as const;

export type ReminderRuleKey = typeof reminderRuleKeys[number];
export type ReminderSelection = Record<ReminderRuleKey, boolean>;

export const fixedConfirmationReplyPrompt =
  "Responda somente com um número:\n1 — Confirmar\n2 — Cancelar\n3 — Falar com atendente";

export const confirmationReplyMessageKeys = [
  "REMINDER_T24_CLIENT",
  "REMINDER_MORNING_CLIENT",
  "REMINDER_T180_CLIENT",
  "REMINDER_T45_CLIENT",
  "INVALID_REPLY_PROMPT",
] as const;

export type ConfirmationReplyMessageKey = typeof confirmationReplyMessageKeys[number];

export function isConfirmationReplyMessageKey(key: string): key is ConfirmationReplyMessageKey {
  return (confirmationReplyMessageKeys as readonly string[]).includes(key);
}

export function editableTemplateHeader(value: string): string {
  const normalized = value.replaceAll("\\n", "\n");
  const fixedSectionStart = /(?:^|\r?\n)\s*(?:Responda somente com um número\s*:|1\s*(?:[—–-]|[.)]))/i;
  const marker = fixedSectionStart.exec(normalized);
  return (marker ? normalized.slice(0, marker.index) : normalized).replace(/[\s\r\n]+$/, "");
}

export function withFixedConfirmationReply(value: string): string {
  const header = editableTemplateHeader(value);
  return header ? `${header}\n\n${fixedConfirmationReplyPrompt}` : fixedConfirmationReplyPrompt;
}

const reminderPriority: ReminderRuleKey[] = [
  "reminder_t45_enabled",
  "reminder_t180_enabled",
  "reminder_morning_enabled",
  "reminder_t24_enabled",
];

export function normalizeReminderSelection<T extends ReminderSelection>(selection: T): T {
  const selected = reminderPriority.find((key) => selection[key]);
  return { ...selection, ...Object.fromEntries(reminderRuleKeys.map((key) => [key, key === selected])) } as T;
}

export function selectExclusiveReminder<T extends ReminderSelection>(
  selection: T,
  selected: ReminderRuleKey,
  enabled: boolean,
): T {
  if (enabled) {
    return { ...selection, ...Object.fromEntries(reminderRuleKeys.map((key) => [key, key === selected])) } as T;
  }
  return normalizeReminderSelection({ ...selection, [selected]: false });
}

export function insertTemplateVariable(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  variable: string,
): { value: string; cursor: number } {
  const start = Math.max(0, Math.min(selectionStart, value.length));
  const end = Math.max(start, Math.min(selectionEnd, value.length));
  const nextValue = `${value.slice(0, start)}${variable}${value.slice(end)}`;
  const cursor = start + variable.length;
  return { value: nextValue, cursor };
}

export const reminderRuleKeys = [
  "reminder_t24_enabled",
  "reminder_morning_enabled",
  "reminder_t180_enabled",
  "reminder_t45_enabled",
] as const;

export type ReminderRuleKey = typeof reminderRuleKeys[number];
export type ReminderSelection = Record<ReminderRuleKey, boolean>;

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

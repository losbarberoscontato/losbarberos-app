export function normalizePhoneE164(value: string): string | null {
  const input = value.trim();
  if (!input) return null;

  const hasPlus = input.startsWith("+");
  const digits = input.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;

  if (hasPlus) return `+${digits}`;
  if (digits.startsWith("55") && digits.length >= 12) return `+${digits}`;
  return `+55${digits}`;
}

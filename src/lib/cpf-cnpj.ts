export function formatCpfCnpj(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 14);
  if (digits.length <= 11) return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{0,2}).*$/, (_m, a, b, c, d) => [a, b, c].filter(Boolean).join(".") + (d ? `-${d}` : ""));
  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{0,2}).*$/, (_m, a, b, c, d, e) => `${a}.${b}.${c}/${d}${e ? `-${e}` : ""}`);
}

export function cpfCnpjDigits(value: string): string {
  return value.replace(/\D/g, "").slice(0, 14);
}

export function isCpfCnpjValid(value: string): boolean {
  const digits = cpfCnpjDigits(value);
  return digits.length === 0 || digits.length === 11 || digits.length === 14;
}

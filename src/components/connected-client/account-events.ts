export const clientAccountSavedEvent = "los-barberos:client-account-saved";

export function notifyClientAccountSaved() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(clientAccountSavedEvent));
}

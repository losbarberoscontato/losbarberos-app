// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { normalizeEvolutionMessages, eventIdentity } from "../../supabase/functions/_shared/whatsapp-normalize";
import { sendEvolutionText, validateImage } from "../../supabase/functions/_shared/whatsapp-delivery";
import { dispatchRuntimeJob, type RuntimeDependencies } from "../../supabase/functions/_shared/whatsapp-runtime";
import { textFor } from "../../supabase/functions/_shared/whatsapp-templates";
import type { RuntimeJob } from "../../supabase/functions/_shared/whatsapp-contracts";

const sender = { gateway_base_url: "https://evolution.example.test", gateway_api_key: "test-only", gateway_instance_id: "barbearia" };
const job: RuntimeJob = { id: "job", organization_id: "org", connection_id: "connection", appointment_id: null, job_type: "MANUAL_OUTBOUND_TEXT", payload: { custom_key: "BIRTHDAY", body: "Olá {cliente}!", customer_name: "Ana" }, recipient_e164: "+5511999999999", lease_token: "lease", scheduled_for: new Date().toISOString() };
describe("Evolution transport contract", () => {
  it("não descarta recibo fromMe e diferencia entregue de lido", () => {
    const received = normalizeEvolutionMessages("MESSAGES_UPDATE", "tenant", [{ key: { id: "a", fromMe: true }, update: { status: 3 } }, { keyId: "a", status: "READ" }]);
    expect(received.map((e) => e.receipt)).toEqual(["DELIVERED", "READ"]);
    expect(eventIdentity(received[0])).not.toEqual(eventIdentity(received[1]));
  });
  it("captura mensagem citada e chave de imagem sem persistir URL", () => {
    const events = normalizeEvolutionMessages("MESSAGES_UPSERT", "tenant", { key: { id: "a", remoteJid: "5511999999999@s.whatsapp.net" }, message: { imageMessage: { url: "http://127.0.0.1/private", contextInfo: { stanzaId: "quoted" } } } });
    expect(events[0].quoted_id).toBe("quoted");
    expect(JSON.stringify(events)).not.toContain("127.0.0.1");
    expect(events[0].media?.key.id).toBe("a");
  });
  it("ignora mensagens próprias e de grupos", () => {
    expect(normalizeEvolutionMessages("MESSAGES_UPSERT", "t", { key: { id: "a", fromMe: true } })).toEqual([]);
    expect(normalizeEvolutionMessages("MESSAGES_UPSERT", "t", { key: { id: "a", remoteJid: "123@g.us" } })).toEqual([]);
  });
  it.each([500, 502, 408])("HTTP %i não causa retry cego", async (status) => {
    const request = vi.fn().mockResolvedValue(new Response("{}", { status }));
    expect((await sendEvolutionText(sender, job.recipient_e164, "Olá", request)).status).toBe("SEND_UNKNOWN");
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("timeout é incerto; 429 explícito permite retry", async () => {
    expect((await sendEvolutionText(sender, job.recipient_e164, "Oi", vi.fn().mockRejectedValue(new Error("timeout")))).status).toBe("SEND_UNKNOWN");
    expect((await sendEvolutionText(sender, job.recipient_e164, "Oi", vi.fn().mockResolvedValue(new Response("", { status: 429 })))).status).toBe("RETRY");
  });
  it("sucesso sem ID não é tratado como envio confirmado", async () => {
    expect((await sendEvolutionText(sender, job.recipient_e164, "Oi", vi.fn().mockResolvedValue(new Response("{}")))).status).toBe("SEND_UNKNOWN");
  });
  it("não repete transporte se falhar persistência da conclusão", async () => {
    const transport = vi.fn().mockResolvedValue(new Response('{"key":{"id":"provider-id"}}'));
    const rpc = vi.fn().mockResolvedValueOnce({ ready: true }).mockResolvedValueOnce(sender).mockResolvedValueOnce(true).mockRejectedValueOnce(new Error("database offline"));
    const deps: RuntimeDependencies = { rpc, fetch: transport, storeImage: vi.fn(), report: vi.fn() };
    await expect(dispatchRuntimeJob(job, deps)).rejects.toThrow("database offline");
    expect(transport).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenLastCalledWith("whatsapp_runtime_finish", expect.objectContaining({ p_outcome: "SUBMITTED", p_provider_id: "provider-id" }));
  });
  it("desativação na validação final impede envio", async () => {
    const transport = vi.fn(); const rpc = vi.fn().mockResolvedValueOnce({ ready: true }).mockResolvedValueOnce(sender).mockResolvedValueOnce(false);
    await dispatchRuntimeJob(job, { rpc, fetch: transport, storeImage: vi.fn(), report: vi.fn() });
    expect(transport).not.toHaveBeenCalled();
  });
  it("renderiza texto e remove contagem temporal desatualizada", () => {
    expect(textFor(job)).toBe("Olá Ana!");
    expect(textFor({ job_type: "REMINDER_T45_CLIENT", payload: {} })).not.toContain("começa em 45 minutos");
  });
  it("rejeita HTML, SVG e imagens acima do limite", () => {
    expect(() => validateImage(new TextEncoder().encode("<html>invalid file</html>"))).toThrow("INVALID_IMAGE_CONTENT");
    expect(() => validateImage(new TextEncoder().encode('<svg width="1"/>'))).toThrow("INVALID_IMAGE_CONTENT");
    expect(() => validateImage(new Uint8Array(10 * 1024 * 1024 + 1))).toThrow("INVALID_IMAGE_SIZE");
  });
  it("aceita PNG estruturado e rejeita cabeçalho ou chunks truncados", () => {
    const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jf7sAAAAASUVORK5CYII="), (c) => c.charCodeAt(0));
    expect(validateImage(png)).toBe("image/png");
    expect(() => validateImage(png.slice(0, 33))).toThrow("INVALID_IMAGE_CONTENT");
    expect(() => validateImage(png.slice(0, -1))).toThrow("INVALID_IMAGE_CONTENT");
  });
});

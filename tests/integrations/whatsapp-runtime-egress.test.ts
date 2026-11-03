// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { deleteExpiredImages, runtimeHttp } from "../../supabase/functions/_shared/whatsapp-runtime-http";
import { measureRuntimeFixture } from "../fixtures/whatsapp-egress";

describe("runtime: respostas menores com contratos preservados", () => {
  it.each([[0, 0], [1, 1], [25, 2]])("%i jobs / %i eventos: mesmos claims, mensagens, resultados e heartbeat", async (jobs, events) => {
    const before = await measureRuntimeFixture(false, jobs, events);
    const after = await measureRuntimeFixture(true, jobs, events);
    expect(after.result).toEqual(before.result);
    expect(after.calls).toEqual(before.calls);
    expect(after.sends).toEqual(before.sends);
    expect(after.sends).toHaveLength(jobs);
    expect(after.calls.at(-1)?.rpc).toBe("whatsapp_runtime_heartbeat");
    expect(after.jsonBytes).toBeLessThanOrEqual(before.jsonBytes);
    if (jobs || events) expect(after.jsonBytes).toBeLessThan(before.jsonBytes);
    expect(after.calls.filter((call) => call.rpc === "whatsapp_runtime_claim")[0].args).toEqual({ p_worker: "fixture-worker", p_limit: 25 });
  });

  it("erro do provedor permanece SEND_UNKNOWN e não dispara outro envio", async () => {
    const result = await measureRuntimeFixture(true, 1, 0, 500);
    expect(result.sends).toHaveLength(1);
    expect(result.calls.find((call) => call.rpc === "whatsapp_runtime_finish")?.args.p_outcome).toBe("SEND_UNKNOWN");
  });

  it("projeta somente a leitura de imagens; preserva confirmação da exclusão", async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: "image", object_path: "org/event" }])))
      .mockResolvedValueOnce(new Response("{}"))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const deps = runtimeHttp("https://supabase.example.test/", "fixture", request);
    await deleteExpiredImages(deps, "https://supabase.example.test", "fixture");
    expect(new URL(String(request.mock.calls[0][0])).searchParams.get("select")).toBe("id,object_path");
    expect(JSON.parse(String(request.mock.calls[1][1]?.body))).toEqual({ prefixes: ["org/event"] });
    expect(JSON.parse(String(request.mock.calls[2][1]?.body))).toEqual({ p_id: "image" });
  });

  it("mantém erros e timeouts, sem retry de RPC mutante", async () => {
    const observer = vi.fn();
    const request = vi.fn<typeof fetch>().mockRejectedValue(new Error("timeout"));
    await expect(runtimeHttp("https://supabase.example.test", "fixture", request, observer).rpc("whatsapp_runtime_claim", { p_worker: "secret-worker" })).rejects.toThrow("timeout");
    expect(request).toHaveBeenCalledTimes(1);
    expect(observer).toHaveBeenCalledWith(expect.objectContaining({ status: 0, ok: false }));
    expect(JSON.stringify(observer.mock.calls)).not.toContain("secret-worker");
  });

  it("observador mede bytes UTF-8 sem valores sensíveis e não interfere no retorno", async () => {
    const observe = vi.fn().mockImplementation(() => { throw new Error("metrics offline"); });
    const raw = '{"result":"olá"}';
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(raw));
    const data = await runtimeHttp("https://supabase.example.test", "never-log-this", request, observe).rpc("fixture_rpc", { private: "no-output" });
    expect(data).toEqual({ result: "olá" });
    expect(observe).toHaveBeenCalledWith(expect.objectContaining({ jsonBytes: new TextEncoder().encode(raw).byteLength, ok: true }));
    expect(JSON.stringify(observe.mock.calls)).not.toMatch(/olá|never-log-this|no-output/);
    expect(String(request.mock.calls[0][0])).not.toContain("select=");
  });
});

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useNavigationAccess } from "@/components/connected-client/use-navigation-access";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture() {
  const pending: ReturnType<typeof deferred<{ count: number }>>[] = [];
  const queries: { table: string; filters: Record<string, unknown>; head?: boolean }[] = [];
  const client = {
    rpc: vi.fn().mockResolvedValue({ data: false }),
    from: vi.fn((table: string) => {
      const call = { table, filters: {} as Record<string, unknown>, head: false };
      queries.push(call);
      const response = table === "customer_in_app_notifications" ? deferred<{ count: number }>() : null;
      if (response) pending.push(response);
      const query = {
        select: (_columns: string, options: { head: boolean }) => { call.head = options.head; return query; },
        eq: (key: string, value: unknown) => { call.filters[key] = value; return query; },
        is: (key: string, value: unknown) => { call.filters[key] = value; return query; },
        then: (done: (value: { count: number }) => unknown) => (response?.promise ?? Promise.resolve({ count: 0 })).then(done),
      };
      return query;
    }),
  };
  const props = { context: { organization: { id: "tenant-a" } }, customer: { id: "customer-a" }, user: { id: "user-a" } as { id: string } | null };
  const useAccess = (input: typeof props) => useNavigationAccess(client as unknown as SupabaseClient, input.context, input.customer, input.user);
  return { pending, queries, client, props, useAccess };
}

describe("tráfego e isolamento da navegação do cliente", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it.each(["los-barberos", "pro-stetic", "le-gras", "music-pro"])("%s: uma consulta inicial, HEAD e mesmos 30 segundos", async (product) => {
    const f = fixture();
    f.props.context.organization.id = product;
    const { result, unmount } = renderHook(f.useAccess, { initialProps: f.props });
    expect(f.pending).toHaveLength(1);
    expect(f.queries).toContainEqual({ table: "customer_in_app_notifications", head: true, filters: { organization_id: product, customer_id: "customer-a", read_at: null } });
    await act(async () => { f.pending[0].resolve({ count: 1 }); });
    expect(result.current).toEqual({ subscriptionAccess: true, commercialOfferUnread: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(29_999); });
    expect(f.pending).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(f.pending).toHaveLength(2);
    await act(async () => { f.pending[1].resolve({ count: 0 }); });
    expect(result.current.commercialOfferUnread).toBe(false);
    unmount();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.pending).toHaveLength(2);
  });

  it("compartilha somente a chamada pendente, sem TTL e sem sobreposição", async () => {
    const f = fixture();
    renderHook(f.useAccess, { initialProps: f.props });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(f.pending).toHaveLength(1);
    await act(async () => { f.pending[0].resolve({ count: 0 }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(f.pending).toHaveLength(2);
  });

  it("descarta resposta atrasada após trocar organização e oculta dados no logout", async () => {
    const f = fixture();
    const { result, rerender } = renderHook(f.useAccess, { initialProps: f.props });
    rerender({ context: { organization: { id: "tenant-b" } }, customer: { id: "customer-b" }, user: f.props.user });
    await act(async () => { f.pending[1].resolve({ count: 0 }); });
    await act(async () => { f.pending[0].resolve({ count: 4 }); });
    expect(result.current).toEqual({ subscriptionAccess: false, commercialOfferUnread: false });
    expect(f.queries[3].filters).toMatchObject({ organization_id: "tenant-b", customer_id: "customer-b" });
    rerender({ ...f.props, user: null });
    expect(result.current).toEqual({ subscriptionAccess: false, commercialOfferUnread: false });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(f.pending).toHaveLength(2);
  });

  it("revalida módulos quando o provider atualiza contexto do mesmo tenant", async () => {
    const f = fixture();
    const { result, rerender } = renderHook(f.useAccess, { initialProps: f.props });
    await act(async () => { f.pending[0].resolve({ count: 0 }); });
    expect(result.current.subscriptionAccess).toBe(false);
    f.client.rpc.mockResolvedValue({ data: true });
    rerender({ ...f.props, context: { organization: { id: "tenant-a" } } });
    await act(async () => { f.pending[1].resolve({ count: 0 }); });
    expect(result.current.subscriptionAccess).toBe(true);
    expect(f.client.rpc).toHaveBeenCalledTimes(4);
  });
});

// Run with: node --conditions=react-server scripts/verify-egress-request-cache.mjs
// Real React Server Components renderer; synthetic Supabase SDK, no HTTP calls.
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import React from "react";
import { renderToReadableStream } from "next/dist/compiled/react-server-dom-webpack/server.node.js";
import ts from "typescript";

const require = createRequire(import.meta.url);
const requests = new AsyncLocalStorage();
const stubUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const host = {
  getSelectedProductKey: async () => requests.getStore().product,
  getSupabaseServerClient: async () => {
    const request = requests.getStore();
    return {
      auth: { getUser: async () => {
        request.reads++;
        return { data: { user: request.user ? { id: request.user } : null }, error: null };
      } },
      from: (table) => {
        const filters = {};
        const query = {
          select: () => query,
          eq: (key, value) => { filters[key] = value; return query; },
          in: (key, value) => { filters[key] = value; return query; },
          maybeSingle: () => query,
          then: (resolve) => {
            request.reads++;
            let data = null;
            if (table === "organization_product_assignments") data = [{ organization_id: `${filters.product_key}:${request.user}` }];
            if (table === "organization_memberships" && request.owner) data = { organization_id: filters.organization_id[0] };
            if (table === "saas_subscriptions") data = { status: request.billing };
            return Promise.resolve({ data, error: null }).then(resolve);
          },
        };
        return query;
      },
    };
  },
};
globalThis.__displayEgressFixture = host;
const hostUrl = stubUrl("export const { getSupabaseServerClient, getSelectedProductKey } = globalThis.__displayEgressFixture;");
const source = ts.transpileModule(readFileSync(new URL("../src/lib/auth/context.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText
  .replaceAll('"@/lib/supabase/server"', JSON.stringify(hostUrl))
  .replaceAll('"@/lib/product-context"', JSON.stringify(hostUrl));
const cached = await import(stubUrl(source.replaceAll('"react"', JSON.stringify(pathToFileURL(require.resolve("react")).href))));
const uncached = await import(stubUrl(source.replaceAll('"react"', JSON.stringify(stubUrl("export const cache = (fn) => fn;")))));

async function checkRender(module, settings) {
  const state = { product: "los-barberos", user: "fixture-user", owner: true, billing: "ACTIVE", reads: 0, ...settings };
  return requests.run(state, async () => {
    let contexts;
    async function Probe() {
      contexts = await Promise.all([
        module.getAccessContext(state.product), module.getAccessContext(), module.getAccessContext(state.product),
      ]);
      return React.createElement("span", null, "fixture");
    }
    const stream = await renderToReadableStream(React.createElement(Probe));
    const reader = stream.getReader();
    while (!(await reader.read()).done) { /* Consume render; do not emit RSC payload. */ }
    const expected = state.user ? {
      userId: state.user,
      organizationId: state.owner ? `${state.product}:${state.user}` : null,
      role: state.owner ? "OWNER" : "UNREGISTERED",
      billingStatus: state.owner ? state.billing : null,
    } : null;
    assert.deepEqual(contexts, [expected, expected, expected]);
    return state.reads;
  });
}
const before = await checkRender(uncached, {});
const after = await checkRender(cached, {});
assert.equal(before, 18);
assert.equal(after, 6);
for (const product of ["los-barberos", "pro-stetic", "le-gras", "music-pro"]) {
  await checkRender(cached, { product });
}
await Promise.all([
  checkRender(cached, { user: "fixture-a" }),
  checkRender(cached, { user: "fixture-b", billing: "BLOCKED" }),
]);
await checkRender(cached, { user: null });
await checkRender(cached, { owner: false });
await checkRender(cached, { billing: "GRACE" });
console.log(JSON.stringify({
  sdkReadsWithoutMemo: before, sdkReadsWithMemo: after,
  crossRequestIsolation: "passed", products: 4, logoutAndPermissions: "passed",
  measured: "SDK reads in real RSC render; Next fetch memoization/wire Egress not measured",
}));
delete globalThis.__displayEgressFixture;

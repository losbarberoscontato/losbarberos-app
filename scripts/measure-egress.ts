// Offline, deterministic comparison. Does not load .env or call external hosts.
import { measureRuntimeFixture } from "../tests/fixtures/whatsapp-egress.ts";

const scenarios = [
  { name: "empty", jobs: 0, events: 0 },
  { name: "one_job_one_event", jobs: 1, events: 1 },
  { name: "busy_tick", jobs: 25, events: 2 },
];
for (const scenario of scenarios) {
  const before = await measureRuntimeFixture(false, scenario.jobs, scenario.events);
  const after = await measureRuntimeFixture(true, scenario.jobs, scenario.events);
  if (JSON.stringify(before.result) !== JSON.stringify(after.result) || JSON.stringify(before.calls) !== JSON.stringify(after.calls) || JSON.stringify(before.sends) !== JSON.stringify(after.sends)) {
    throw new Error("RUNTIME_BEHAVIOR_CHANGED");
  }
  console.log(JSON.stringify({
    scenario: scenario.name,
    work: after.result,
    rpcCallsBefore: before.calls.length,
    rpcCallsAfter: after.calls.length,
    simulatedProviderCalls: after.sends.length,
    jsonBytesBefore: before.jsonBytes,
    jsonBytesAfter: after.jsonBytes,
    savedJsonBytes: before.jsonBytes - after.jsonBytes,
    measured: "UTF-8 response JSON, synthetic data; excludes headers/compression/TLS; not billed Egress",
  }));
}

// Node >= 22.18: shares the exact runtime exercised by Vitest and Edge Functions.
import { runWhatsAppRuntime } from '../supabase/functions/_shared/whatsapp-runtime.ts';
import { runtimeHttp, deleteExpiredImages } from '../supabase/functions/_shared/whatsapp-runtime-http.ts';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_RUNTIME_CONFIGURATION_REQUIRED');
const deps = runtimeHttp(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
let stopping = false;
let nextRetention = 0;
let failedSince = 0;
let lastAlert = 0;
async function alert(code) {
  if (!process.env.WHATSAPP_ALERT_URL || Date.now() - lastAlert < 300_000) return;
  const url = new URL(process.env.WHATSAPP_ALERT_URL);
  if (url.protocol !== 'https:') throw new Error('ALERT_HTTPS_REQUIRED');
  const response = await fetch(url, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5_000),
    headers: { 'Content-Type': 'application/json', ...(process.env.WHATSAPP_ALERT_TOKEN ? { Authorization: `Bearer ${process.env.WHATSAPP_ALERT_TOKEN}` } : {}) },
    body: JSON.stringify({ code, at: new Date().toISOString() }),
  });
  if (response.ok) lastAlert = Date.now();
}
process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });
const eventLoop = (async () => {
  while (!stopping) {
    try {
      await runWhatsAppRuntime(deps, crypto.randomUUID(), "events");
      if (Date.now() >= nextRetention) {
        await deleteExpiredImages(deps, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        nextRetention = Date.now() + 60_000;
      }
    }
    catch { console.error("WHATSAPP_EVENT_LOOP_FAILED"); }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
})();
while (!stopping) {
  try {
    await runWhatsAppRuntime(deps, crypto.randomUUID(), "jobs");
    failedSince = 0;
  } catch {
    console.error('WHATSAPP_RUNTIME_TICK_FAILED');
    failedSince ||= Date.now();
    if (Date.now() - failedSince >= 120_000) await alert('WHATSAPP_RUNTIME_UNAVAILABLE').catch(() => console.error('WHATSAPP_ALERT_FAILED'));
  }
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}

await eventLoop;

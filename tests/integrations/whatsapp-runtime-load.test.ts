// @vitest-environment node
import { expect, it } from "vitest";
import { whatsappDatabase } from "../helpers/whatsapp-database";

// Opt-in volume test: real SQL claims, simulated completion/time, no provider calls.
// This checks queue invariants; it does not benchmark hosted Supabase or Baileys.
it.skipIf(process.env.WHATSAPP_LOAD_TESTS !== "1")("120 organizações, 60 mil clientes e campanhas concorrentes preservam prioridade", async () => {
  const db = await whatsappDatabase();
  try {
    await db.exec(`
      insert into organizations(id) select md5('org-'||i)::uuid from generate_series(1,120) i;
      insert into whatsapp_automation_settings_v2(organization_id,mode,runtime_engine)
        select id,'ACTIVE','ACTIVE' from organizations;
      insert into whatsapp_business_connections(id,organization_id,provider,status,is_active,gateway_instance_id)
        select md5('connection-'||id)::uuid,id,'QR_WEB','CONNECTED',true,'lb-'||id from organizations;
      insert into customers(id,organization_id,phone_e164)
        select md5('customer-'||i)::uuid,md5('org-'||(1+(i-1)%120))::uuid,'+5511999990001' from generate_series(1,60000) i;
      insert into whatsapp_automation_jobs(organization_id,connection_id,job_type,recipient_e164,dedupe_key,priority)
        select c.organization_id,w.id,'MANUAL_OUTBOUND_TEXT',c.phone_e164,'campaign:'||c.id,30
        from customers c join whatsapp_business_connections w on w.organization_id=c.organization_id;
      insert into whatsapp_automation_jobs(organization_id,connection_id,job_type,recipient_e164,dedupe_key,priority)
        select w.organization_id,w.id,'MANUAL_OUTBOUND_TEXT','+5511999990001','operational:'||i,0
        from whatsapp_business_connections w cross join generate_series(1,10) i;
    `);
    const seen = new Set<string>();
    while (seen.size < 1200) {
      const { rows } = await db.query<{ id: string; connection_id: string; priority: number }>("select * from whatsapp_runtime_claim('load',25)");
      expect(rows.length).toBeGreaterThan(0);
      expect(new Set(rows.map((j) => j.connection_id)).size).toBe(rows.length);
      for (const row of rows) {
        expect(row.priority).toBe(0);
        expect(seen.has(row.id)).toBe(false);
        seen.add(row.id);
      }
      // Advance simulated connections after successful fake transport completion.
      await db.query("update whatsapp_automation_jobs set status='SUBMITTED',lease_token=null,lock_expires_at=null where id=any($1::uuid[])", [rows.map((j) => j.id)]);
      await db.exec("update whatsapp_business_connections set dispatch_after=now()");
    }
    expect((await db.query<{ n: number }>("select count(*)::integer n from whatsapp_automation_jobs where status='PENDING' and priority=30")).rows[0].n).toBe(60000);
  } finally { await db.close(); }
}, 120_000);

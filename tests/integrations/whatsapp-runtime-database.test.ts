// @vitest-environment node
import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { whatsappDatabase } from "../helpers/whatsapp-database";

let db: PGlite;
const org = "20000000-0000-4000-8000-000000000001";
const org2 = "20000000-0000-4000-8000-000000000002";
const conn = "30000000-0000-4000-8000-000000000001";
const customer = "40000000-0000-4000-8000-000000000001";
beforeAll(async () => { db = await whatsappDatabase(); }, 60_000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec(`begin; insert into organizations(id) values('${org}'),('${org2}');
    insert into customers(id,organization_id,phone_e164) values('${customer}','${org}','+5511999990001');
    insert into whatsapp_business_connections(id,organization_id,provider,status,is_active,gateway_instance_id) values('${conn}','${org}','QR_WEB','CONNECTED',true,'lb-test');
    insert into whatsapp_automation_settings_v2(organization_id,mode,runtime_engine) values('${org}','ACTIVE','ACTIVE');
    set test.owner_org='${org}';`);
});
afterEach(async () => { if (db) await db.exec("rollback"); });
async function enqueue(key = "test", extra = "") {
  return (await db.query<{ id: string }>(`insert into whatsapp_automation_jobs(organization_id,connection_id,job_type,recipient_e164,dedupe_key${extra ? "," + extra.split("=")[0] : ""}) values($1,$2,'MANUAL_OUTBOUND_TEXT','+5511999990001',$3${extra ? "," + extra.split("=")[1] : ""}) returning id`, [org, conn, key])).rows[0].id;
}
async function claim(worker = "worker") { return (await db.query<{ id: string; lease_token: string }>("select * from whatsapp_runtime_claim($1,10)", [worker])).rows; }

describe("runtime PostgreSQL", () => {
  it("resposta ambígua pede identificação sem alterar nenhuma reserva", async () => {
    await db.query("insert into consent_events(organization_id,customer_id,kind,action) values($1,$2,'WHATSAPP_TRANSACTIONAL','GRANTED')", [org,customer]);
    await db.query(`insert into appointments(id,organization_id,customer_id,status,service_period)
      select md5('appointment-'||i)::uuid,$1,$2,'CONFIRMED',tstzrange(now()+i*interval '1 day',now()+i*interval '1 day'+interval '30 minutes') from generate_series(1,2) i`,[org,customer]);
    await db.query(`insert into whatsapp_confirmation_requests_v2(organization_id,connection_id,appointment_id,appointment_version,phase,opaque_token_hash,short_code_hash,expires_at)
      select organization_id,$1,id,version,'T45',id::text,id::text,now()+interval '3 days' from appointments`,[conn]);
    const event=(await db.query<{id:string;lease_token:string}>(`insert into whatsapp_webhook_events_v2(organization_id,connection_id,event_name_raw,event_name_normalized,provider_event_id,fingerprint,payload,processing_status,lease_token,lock_expires_at)
      values($1,$2,'MESSAGES_UPSERT','MESSAGES_UPSERT','reply-1','reply-1',jsonb_build_object('gateway_instance_id','lb-test','text','2','sender_e164','+5511999990001'),'PROCESSING',gen_random_uuid(),now()+interval '90 seconds') returning id,lease_token`,[org,conn])).rows[0];
    const result=(await db.query<{v:{action:string}}>("select whatsapp_runtime_process_event($1,$2) v",[event.id,event.lease_token])).rows[0].v;
    expect(result.action).toBe("CHOICE_REQUIRED");
    expect((await db.query("select id from appointments where status='CONFIRMED'")).rows).toHaveLength(2);
    expect((await db.query<{payload:{body:string}}>("select payload from whatsapp_automation_jobs where dedupe_key=$1",['choice:'+event.id])).rows[0].payload.body).toContain("RESERVA");
    await expect(db.query("select whatsapp_runtime_process_event($1,$2)",[event.id,event.lease_token])).rejects.toThrow("STALE_LEASE");
  });
  it("compila migration e separa motor antigo do novo", async () => {
    await enqueue();
    expect((await db.query("select * from claim_whatsapp_v2_jobs(25,'legacy',90)")).rows).toHaveLength(0);
    expect(await claim()).toHaveLength(1);
    expect(await claim("other")).toHaveLength(0);
  });
  it("reassume somente trabalho sem envio e rejeita token antigo", async () => {
    const id = await enqueue(); const first = (await claim())[0];
    await db.query("update whatsapp_automation_jobs set lock_expires_at=now()-interval '1 second' where id=$1", [id]);
    await db.exec("update whatsapp_business_connections set dispatch_after=now()");
    const second = (await claim("new"))[0]; expect(second.lease_token).not.toBe(first.lease_token);
    expect((await db.query<{ ok: boolean }>("select whatsapp_runtime_finish($1,$2,'FAILED','',null,'error') ok", [id, first.lease_token])).rows[0].ok).toBe(false);
  });
  it("crash após iniciar envio vira SEND_UNKNOWN sem replay", async () => {
    const id = await enqueue(); const j = (await claim())[0];
    await db.query("select whatsapp_runtime_start_send($1,$2)", [id, j.lease_token]);
    await db.query("update whatsapp_automation_jobs set lock_expires_at=now()-interval '1 second' where id=$1", [id]);
    expect(await claim()).toHaveLength(0);
    expect((await db.query<{ status: string }>("select status from whatsapp_automation_jobs where id=$1", [id])).rows[0].status).toBe("SEND_UNKNOWN");
  });
  it("recibo antecipado e fora de ordem preserva READ", async () => {
    const id = await enqueue(); const j = (await claim())[0];
    await db.query("select whatsapp_runtime_receipt($1,'message','READ')", [conn]);
    await db.query("select whatsapp_runtime_finish($1,$2,'SUBMITTED','Olá','message',null)", [id, j.lease_token]);
    await db.query("select whatsapp_runtime_receipt($1,'message','DELIVERED')", [conn]);
    expect((await db.query<{ status: string }>("select status from whatsapp_automation_jobs where id=$1", [id])).rows[0].status).toBe("READ");
    expect((await db.query<{ status: string }>("select status from whatsapp_messages_v2 where job_id=$1", [id])).rows[0].status).toBe("READ");
  });
  it("não permite cliente cross-tenant nem RPC administrativa para outro owner", async () => {
    await expect(db.query("select get_whatsapp_runtime_status($1)", [org2])).rejects.toThrow("OWNER_REQUIRED");
  });
  it("não ativa marketing de conta antiga; nova conta recebe preferência separada", async () => {
    expect((await db.query<{ allowed: boolean }>("select whatsapp_marketing_allowed($1,$2) allowed", [org, customer])).rows[0].allowed).toBe(false);
    await db.query("update customers set auth_user_id=gen_random_uuid() where id=$1", [customer]);
    expect((await db.query<{ allowed: boolean }>("select whatsapp_marketing_allowed($1,$2) allowed", [org, customer])).rows[0].allowed).toBe(true);
  });
  it("reconectar não remove pausa deliberada nem jobs futuros", async () => {
    const id = await enqueue();
    await db.exec(`update whatsapp_automation_settings_v2 set dispatch_paused=true; update whatsapp_business_connections set status='DISCONNECTED'`);
    await db.query("select update_whatsapp_qr_status('lb-test','open',null)");
    expect((await db.query<{ dispatch_paused: boolean }>("select dispatch_paused from whatsapp_automation_settings_v2")).rows[0].dispatch_paused).toBe(true);
    expect((await db.query("select id from whatsapp_automation_jobs where id=$1 and status in ('PENDING','RETRY')", [id])).rows).toHaveLength(1);
  });
  it("rejeita FK de cliente de outra barbearia", async () => {
    const other = "40000000-0000-4000-8000-000000000002";
    await db.query("insert into customers(id,organization_id) values($1,$2)", [other, org2]);
    const id = await enqueue();
    await expect(db.query("update whatsapp_automation_jobs set customer_id=$1 where id=$2", [other,id])).rejects.toThrow(/foreign key/);
  });
  it("revogação cancela pendências personalizadas sem tocar nas operacionais", async () => {
    const personal = await enqueue("custom"); const operational = await enqueue("operational");
    await db.query("update whatsapp_automation_jobs set customer_id=$1,custom_key='BIRTHDAY' where id=$2",[customer,personal]);
    await db.query("insert into consent_events(organization_id,customer_id,kind,action) values($1,$2,'MARKETING','REVOKED')",[org,customer]);
    expect((await db.query<{status:string}>("select status from whatsapp_automation_jobs where id=$1",[personal])).rows[0].status).toBe("CANCELED");
    expect((await db.query<{status:string}>("select status from whatsapp_automation_jobs where id=$1",[operational])).rows[0].status).toBe("PENDING");
  });
  it("suprime personalizada quando tentativa incerta já consumiu limite diário", async () => {
    await db.query("update customers set auth_user_id=gen_random_uuid() where id=$1",[customer]);
    await db.query("insert into whatsapp_custom_message_settings_v2(organization_id,message_key,enabled,body) values($1,'BIRTHDAY',true,'Olá') on conflict(organization_id,message_key) do update set enabled=true",[org]);
    const old = await enqueue("previous"); const next = await enqueue("next");
    await db.query("update whatsapp_automation_jobs set customer_id=$1,custom_key='BIRTHDAY'",[customer]);
    await db.query("update whatsapp_automation_jobs set status='SEND_UNKNOWN',send_started_at=now() where id=$1",[old]);
    const job = (await claim())[0]; expect(job.id).toBe(next);
    const result=await db.query<{v:{ready:boolean;reason:string}}>("select whatsapp_runtime_prepare($1,$2) v",[next,job.lease_token]);
    expect(result.rows[0].v).toEqual({ready:false,reason:"FREQUENCY_LIMIT"});
  });
  it("prioriza operacional antes de campanha na mesma conexão", async () => {
    const campaign=await enqueue("campaign"); const operational=await enqueue("operational");
    await db.query("update whatsapp_automation_jobs set priority=30 where id=$1",[campaign]);
    expect((await claim())[0].id).toBe(operational);
  });
  it("scheduler limita frequência de varredura sem bloquear claims", async () => {
    await db.query("select whatsapp_runtime_schedule(500)");
    expect((await db.query<{n:number}>("select whatsapp_runtime_schedule(500) n")).rows[0].n).toBe(0);
    await enqueue(); expect(await claim()).toHaveLength(1);
  });
  it("recibo FAILED após submissão não regride leitura posterior", async () => {
    const id=await enqueue(); const job=(await claim())[0];
    await db.query("select whatsapp_runtime_finish($1,$2,'SUBMITTED','Olá','error-message',null)",[id,job.lease_token]);
    await db.query("select whatsapp_runtime_receipt($1,'error-message','FAILED')",[conn]);
    expect((await db.query<{status:string}>("select status from whatsapp_automation_jobs where id=$1",[id])).rows[0].status).toBe("FAILED");
    await db.query("select whatsapp_runtime_receipt($1,'error-message','READ')",[conn]);
    await db.query("select whatsapp_runtime_receipt($1,'error-message','FAILED')",[conn]);
    expect((await db.query<{status:string}>("select status from whatsapp_automation_jobs where id=$1",[id])).rows[0].status).toBe("READ");
  });

});

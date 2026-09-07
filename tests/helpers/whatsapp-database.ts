import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const sql = (file: string) => readFileSync(`supabase/migrations/${file}.sql`, "utf8");
const fn = (file: string, name: string) => {
  const found = sql(file).match(new RegExp(`create (?:or replace )?function public\\.${name}\\([\\s\\S]*?\\$\\$;`, "i"));
  if (!found) throw new Error(`Missing baseline function ${name}`);
  return found[0];
};

/** Real PostgreSQL engine and unmodified runtime migration; minimal host-domain fixtures.
 * Does not simulate network failover, hosted Storage, or the complete agenda/finance schema.
 */
export async function whatsappDatabase() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema extensions; create schema storage;
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.user',true),'')::uuid$$;
    create function public.require_service_role() returns void language plpgsql as $$begin if current_setting('request.jwt.claim.role',true) is distinct from 'service_role' then raise exception 'SERVICE_REQUIRED'; end if; end$$;
    create function public.is_organization_owner(id uuid) returns boolean language sql stable as $$select id::text=current_setting('test.owner_org',true)$$;
    create table public.organizations(id uuid primary key default gen_random_uuid(),name text default 'Teste',timezone text default 'America/Sao_Paulo');
    create table public.customers(id uuid primary key default gen_random_uuid(),organization_id uuid references organizations(id),auth_user_id uuid,full_name text default 'Cliente',phone_e164 text,birth_date date,active boolean default true,unique(id,organization_id));
    create table public.barbers(id uuid primary key default gen_random_uuid(),organization_id uuid references organizations(id),display_name text,whatsapp_e164 text,unique(id,organization_id));
    create table public.appointments(id uuid primary key default gen_random_uuid(),organization_id uuid references organizations(id),customer_id uuid,barber_id uuid,status text,version integer default 1,service_period tstzrange,whatsapp_response_status text,updated_at timestamptz default now(),unique(id,organization_id));
    create table public.appointment_items(organization_id uuid,appointment_id uuid,service_name_snapshot text,position integer);
    create table public.appointment_status_events(organization_id uuid,appointment_id uuid,from_status text,to_status text,created_at timestamptz default now(),reason text,metadata jsonb,actor_user_id uuid);
    create type public.consent_kind as enum('MARKETING','WHATSAPP_TRANSACTIONAL','PRIVACY_POLICY');
    create table public.consent_events(id uuid primary key default gen_random_uuid(),organization_id uuid,customer_id uuid,kind consent_kind,action text,source text,proof jsonb,policy_version text,occurred_at timestamptz default clock_timestamp());
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    set request.jwt.claim.role='service_role';
  `);
  await db.exec(sql("202608110006_whatsapp_hybrid_connections").split("create table public.whatsapp_reminder_rules")[0]);
  await db.exec(sql("20260818023139_whatsapp_automation_v2_rebuild").split("-- Current preference")[0]);
  await db.exec(`
    alter table whatsapp_automation_settings_v2 add column manager_notification_phone_e164 text;
    alter table whatsapp_business_connections add column connection_epoch_at timestamptz, add column connected_phone_e164 text,add column qr_code text,add column qr_expires_at timestamptz,add column health_status text,add column health_checked_at timestamptz,add column health_error_code text,add column health_consecutive_failures integer default 0;
    alter table whatsapp_confirmation_requests_v2 add column invalid_reply_count smallint default 0;
    alter table whatsapp_webhook_events_v2 add column locked_at timestamptz,add column locked_by text,add column lock_expires_at timestamptz;
    alter type whatsapp_v2_job_type add value 'REMINDER_T180_CLIENT';
    alter type whatsapp_confirmation_phase add value 'T180';
  `);
  await db.exec(sql("20260818133928_fix_whatsapp_v2_e164_constraints"));
  await db.exec(sql("20260901144842_whatsapp_v2_automation_controls_implementation").split("create or replace function public.get_whatsapp_connection_status")[0]);
  for (const name of ["record_whatsapp_v2_outbound_message", "record_whatsapp_v2_inbound_message", "whatsapp_v2_consented"])
    await db.exec(fn("20260818023139_whatsapp_automation_v2_rebuild", name));
  await db.exec(fn("20260818171344_match_whatsapp_brazilian_mobile_ninth_digit", "whatsapp_v2_phone_matches"));
  // Random bytes/digest stand-ins are only for request tokens; runtime SQL is unchanged.
  await db.exec(`create function public.gen_random_bytes(n integer) returns bytea language sql as $$ select decode(repeat(replace(gen_random_uuid()::text,'-',''),3),'hex') $$;
    create function public.digest(v text,a text) returns bytea language sql as $$select decode(md5(v),'hex')$$;`);
  await db.exec(fn("20260901144842_whatsapp_v2_automation_controls_implementation", "create_whatsapp_v2_confirmation_request"));
  await db.exec(sql("20260906230249_whatsapp_reliable_runtime"));
  return db;
}

import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const bookingGras = "4039018f-5f6c-4359-ac66-ab17a04ba161";
const gras = "0c860681-6957-4aea-8bf5-53ea8e7d09cd";
const nany = "00000000-0000-4000-8000-000000000002";
const carlos = "00000000-0000-4000-8000-000000000003";
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable
      as $$select nullif(current_setting('test.actor_id', true), '')::uuid$$;
    create table organizations(id uuid primary key, slug text, name text,
      booking_public_id uuid, logo_path text, public_contact_phone_e164 text);
    create table organization_slug_aliases(slug text primary key, organization_id uuid);
    create table organization_product_assignments(organization_id uuid primary key, product_key text);
    create table client_accounts(auth_user_id uuid primary key, last_organization_id uuid);
    create table customers(id uuid primary key, organization_id uuid, auth_user_id uuid,
      active boolean, merged_into_customer_id uuid);
    create table locations(id uuid primary key, organization_id uuid, name text,
      address jsonb, active boolean, created_at timestamptz);
    insert into organizations values
      ('${gras}', 'estudiogras', 'Estúdio Gras', '${bookingGras}', null, null),
      ('${nany}', 'barbearia-nany', 'Barbearia Nany', '00000000-0000-4000-8000-000000000004', null, null);
    insert into organization_slug_aliases values ('studio-gras', '${gras}');
    insert into organization_product_assignments values ('${gras}', 'le-gras'), ('${nany}', 'los-barberos');
    insert into client_accounts values ('${carlos}', '${gras}');
    insert into customers values
      ('00000000-0000-4000-8000-000000000011', '${gras}', '${carlos}', true, null),
      ('00000000-0000-4000-8000-000000000012', '${nany}', '${carlos}', true, null);
    insert into locations values
      ('00000000-0000-4000-8000-000000000013', '${gras}', 'Unidade principal', '{}', true, now());
  `);
  await db.exec(readFileSync("supabase/migrations/20261007131357_client_product_entry_context.sql", "utf8"));
});

afterAll(async () => { await db?.close(); });

describe("contexto público do cliente e vínculos globais", () => {
  it("resolve UUID e alias para o produto associado no banco", async () => {
    await db.exec("set role anon");
    const byBooking = await db.query<{ entry: { organization_name: string; product_key: string } }>(
      `select public.get_public_client_entry_context('${bookingGras}', null) as entry`,
    );
    const byAlias = await db.query<{ entry: { organization_slug: string; product_key: string } }>(
      "select public.get_public_client_entry_context(null, 'studio-gras') as entry",
    );
    expect(byBooking.rows[0].entry).toMatchObject({ organization_name: "Estúdio Gras", product_key: "le-gras" });
    expect(byAlias.rows[0].entry).toMatchObject({ organization_slug: "estudiogras", product_key: "le-gras" });
    await expect(db.query("select * from organization_product_assignments")).rejects.toThrow(/permission denied/u);
    await db.exec("reset role");
  });

  it("recusa identificadores de estabelecimentos diferentes", async () => {
    await db.exec("set role anon");
    await expect(db.query(
      `select public.get_public_client_entry_context('${bookingGras}', 'barbearia-nany')`,
    )).rejects.toThrow(/client entry identifiers conflict/u);
    await db.exec("reset role");
  });

  it("lista empresas de produtos diferentes apenas para o próprio cliente", async () => {
    await db.exec(`set role authenticated; set test.actor_id = '${carlos}'`);
    const result = await db.query<{ organizations: Array<{ organization_name: string; product_key: string }> }>(
      "select public.list_my_client_organizations() as organizations",
    );
    expect(result.rows[0].organizations).toEqual(expect.arrayContaining([
      expect.objectContaining({ organization_name: "Estúdio Gras", product_key: "le-gras" }),
      expect.objectContaining({ organization_name: "Barbearia Nany", product_key: "los-barberos" }),
    ]));
    await db.exec("set test.actor_id = '00000000-0000-4000-8000-000000000099'");
    await expect(db.query("select public.list_my_client_organizations()")).rejects.toThrow(/client account not found/u);
    await db.exec("reset role");
  });
});

// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { whatsappDatabase } from "../helpers/whatsapp-database";

const existingOrganizations = [
  ["50000000-0000-4000-8000-000000000001", "los-barberos"],
  ["50000000-0000-4000-8000-000000000002", "le-gras"],
  ["50000000-0000-4000-8000-000000000003", "pro-stetic"],
  ["50000000-0000-4000-8000-000000000004", "music-pro"],
] as const;

let db: PGlite;

beforeAll(async () => {
  db = await whatsappDatabase({
    beforeProductMessageMigration: async (database) => {
      const values = existingOrganizations.map(([id, product]) => `('${id}', '${product}')`).join(",");
      await database.exec(`
        insert into public.organizations(id) values ${existingOrganizations.map(([id]) => `('${id}')`).join(",")};
        insert into public.organization_product_assignments(organization_id, product_key) values ${values};
        insert into public.whatsapp_automation_settings_v2(organization_id, templates)
        select id, public.whatsapp_v2_default_message_templates() || jsonb_build_object('BOOKING_CREATED_STAFF', 'Texto personalizado preservado.')
        from public.organizations where id in (${existingOrganizations.map(([id]) => `'${id}'`).join(",")});
      `);
    },
  });
}, 60_000);

afterAll(async () => { await db?.close(); });

describe("defaults de mensagem WhatsApp por produto", () => {
  it("localiza defaults legados, preserva personalizações e aplica a cópia nas novas configurações", async () => {
    const backfilled = await db.query<{
      organization_id: string;
      product_key: string;
      client_message: string;
      staff_message: string;
      manager_message: string;
    }>(`
      select a.organization_id, a.product_key,
        s.templates ->> 'BOOKING_CREATED_CLIENT' as client_message,
        s.templates ->> 'BOOKING_CREATED_STAFF' as staff_message,
        s.templates ->> 'ATTENDANT_REQUEST_MANAGER' as manager_message
      from public.organization_product_assignments a
      join public.whatsapp_automation_settings_v2 s using (organization_id)
      order by a.product_key
    `);

    const messageByProduct = new Map(backfilled.rows.map((row) => [row.product_key, row]));
    expect(messageByProduct.get("los-barberos")?.client_message).toContain("na barbearia");
    expect(messageByProduct.get("le-gras")?.client_message).toContain("sessão fotográfica");
    expect(messageByProduct.get("pro-stetic")?.client_message).toContain("procedimento na clínica");
    expect(messageByProduct.get("music-pro")?.client_message).toContain("aula na escola");
    for (const row of backfilled.rows) {
      expect(row.staff_message).toBe("Texto personalizado preservado.");
      expect(row.manager_message).toContain("{profissional}");
      expect(row.manager_message).not.toContain("{barbeiro}");
    }

    const newOrg = "50000000-0000-4000-8000-000000000005";
    await db.exec(`
      insert into public.organizations(id) values ('${newOrg}');
      insert into public.organization_product_assignments(organization_id, product_key) values ('${newOrg}', 'music-pro');
      insert into public.whatsapp_automation_settings_v2(organization_id, templates)
      values ('${newOrg}', jsonb_build_object('BOOKING_CREATED_STAFF', 'Texto feito pelo gestor.'));
    `);
    const created = await db.query<{ templates: Record<string, string> }>(
      `select templates from public.whatsapp_automation_settings_v2 where organization_id = '${newOrg}'`,
    );
    expect(created.rows[0].templates.BOOKING_CREATED_CLIENT).toContain("aula na escola");
    expect(created.rows[0].templates.BOOKING_CREATED_STAFF).toBe("Texto feito pelo gestor.");

    const assignedAfterSettingsOrg = "50000000-0000-4000-8000-000000000006";
    await db.exec(`
      insert into public.organizations(id) values ('${assignedAfterSettingsOrg}');
      insert into public.whatsapp_automation_settings_v2(organization_id, templates)
      values ('${assignedAfterSettingsOrg}', public.whatsapp_v2_default_message_templates() || jsonb_build_object('BOOKING_CREATED_STAFF', 'Outro texto personalizado.'));
      insert into public.organization_product_assignments(organization_id, product_key) values ('${assignedAfterSettingsOrg}', 'le-gras');
    `);
    const assignedLater = await db.query<{ templates: Record<string, string> }>(
      `select templates from public.whatsapp_automation_settings_v2 where organization_id = '${assignedAfterSettingsOrg}'`,
    );
    expect(assignedLater.rows[0].templates.BOOKING_CREATED_CLIENT).toContain("sessão fotográfica");
    expect(assignedLater.rows[0].templates.BOOKING_CREATED_STAFF).toBe("Outro texto personalizado.");
  });
});

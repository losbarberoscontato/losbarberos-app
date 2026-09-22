import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20260922195504_project_kanban_standalone_internal_cards.sql", "utf8");
const serviceRulesMigration = readFileSync("supabase/migrations/20260922202742_project_internal_service_delete_and_move_notice.sql", "utf8");
const completionFixMigration = readFileSync("supabase/migrations/20260922205319_fix_internal_service_commission_completion_order.sql", "utf8");

describe("standalone project Kanban cards migration", () => {
  it("stores internal cards independently from customers and engagements", () => {
    expect(migration).toMatch(/create table public\.project_kanban_internal_cards/i);
    expect(migration).toMatch(/unique \(id, organization_id\)/i);
    expect(migration).toMatch(/create_project_kanban_internal_card/i);
    expect(migration).not.toMatch(/customer_id/i);
  });

  it("allows internal services for either a contract or a standalone card, never both", () => {
    expect(migration).toMatch(/alter table public\.project_engagement_internal_services\s+alter column engagement_id drop not null/i);
    expect(migration).toMatch(/internal_card_id/i);
    expect(migration).toMatch(/num_nonnulls\(engagement_id, internal_card_id\) = 1/i);
  });

  it("keeps standalone cards in the first board and blocks moving with open services", () => {
    expect(migration).toMatch(/order by position, created_at, id\s+limit 1/i);
    expect(migration).toMatch(/move_project_kanban_internal_card/i);
    expect(migration).toMatch(/complete the internal service before moving this card/i);
  });
});

describe("project internal service move and delete rules migration", () => {
  it("blocks moving cards with an open service and provides a guarded delete RPC", () => {
    expect(serviceRulesMigration).toMatch(/status = 'OPEN'[\s\S]{0,180}open internal service pending completion/i);
    expect(serviceRulesMigration).toMatch(/create or replace function public\.delete_project_engagement_internal_service/i);
    expect(serviceRulesMigration).toContain("v_service.status <> 'OPEN'");
    expect(serviceRulesMigration).toContain("only open internal services can be deleted");
    expect(serviceRulesMigration).toMatch(/commission_ledger_entry_id is not null/i);
    expect(serviceRulesMigration).toMatch(/grant execute on function public\.delete_project_engagement_internal_service\(uuid, uuid\) to authenticated/i);
  });
});

describe("project internal service completion commission validation migration", () => {
  it("validates the final persisted service row after the deferred commission link is written", () => {
    expect(completionFixMigration).toMatch(/select \* into v_service[\s\S]*from public\.project_engagement_internal_services[\s\S]*where organization_id = new\.organization_id and id = new\.id/i);
    expect(completionFixMigration).toMatch(/v_service\.status = 'COMPLETED'[\s\S]*ledger\.id = v_service\.commission_ledger_entry_id/i);
    expect(completionFixMigration).toContain("completed internal service requires its matching earned commission");
  });
});

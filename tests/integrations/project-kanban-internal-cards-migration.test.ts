import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20260922195504_project_kanban_standalone_internal_cards.sql", "utf8");

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

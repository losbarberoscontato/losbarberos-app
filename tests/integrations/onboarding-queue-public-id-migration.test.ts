import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("onboarding queue public ID migration", () => {
  it("gives newly onboarded organizations a database-generated queue ID", () => {
    const migration = readFileSync(
      resolve(process.cwd(), "supabase/migrations/20260827222756_onboarding_queue_public_id_default.sql"),
      "utf8",
    );

    expect(migration).toContain("alter column queue_public_id set default gen_random_uuid()");
  });
});

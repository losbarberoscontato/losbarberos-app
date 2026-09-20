import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("projects kanban boards migration", () => {
  it("creates tenant-scoped boards and supports safe card reassignment on deletion", async () => {
    const sql = await readFile(resolve(process.cwd(), "supabase/migrations/20260915192517_projects_kanban_boards.sql"), "utf8");
    const responsibleSql = await readFile(resolve(process.cwd(), "supabase/migrations/20260915210009_projects_kanban_board_responsibles.sql"), "utf8");
    const moveSql = await readFile(resolve(process.cwd(), "supabase/migrations/20260915215537_projects_kanban_move_engagement.sql"), "utf8");
    expect(sql).toContain("create table public.project_kanban_boards");
    expect(sql).toContain("alter table public.project_engagements add column kanban_board_id uuid");
    expect(sql).toContain("create or replace function public.upsert_project_kanban_board");
    expect(sql).toContain("create or replace function public.delete_project_kanban_board");
    expect(responsibleSql).toContain("responsible_barber_id uuid");
    expect(responsibleSql).toContain("kanban board requires an active responsible barber");
    expect(moveSql).toContain("create function public.move_project_engagement_to_kanban_board");
    expect(moveSql).toContain("set kanban_board_id = p_destination_board_id");
    expect(sql).toContain("choose a destination board before deleting a board with cards");
    expect(sql).toContain("update public.project_engagements");
    expect(sql).toContain("public.is_organization_owner(p_organization_id)");
  });
});

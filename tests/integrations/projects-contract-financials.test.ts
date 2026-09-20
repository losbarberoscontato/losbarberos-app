import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20260916195556_project_contract_financials.sql", "utf8");
const enumMigration = readFileSync("supabase/migrations/20260916195555_project_financial_source_enum.sql", "utf8");
const competenceMigration = readFileSync("supabase/migrations/20260916210955_project_contract_competence_date.sql", "utf8");
const scheduleMigration = readFileSync("supabase/migrations/20260916213354_project_contract_generate_open_installments.sql", "utf8");
const entryDueDateMigration = readFileSync("supabase/migrations/20260917172236_project_contract_entry_due_date.sql", "utf8");
const signatureStatusMigration = readFileSync("supabase/migrations/20260917193729_project_engagement_signature_status.sql", "utf8");
const receiptMigration = readFileSync("supabase/migrations/20260916215232_project_installment_receipt_metadata.sql", "utf8");
const eventMigration = readFileSync("supabase/migrations/20260918144125_project_engagement_event_details.sql", "utf8");
const generalKanbanMigration = readFileSync("supabase/migrations/20260918145932_project_general_kanban_sectors.sql", "utf8");
const kanbanDeadlinesMigration = readFileSync("supabase/migrations/20260918151918_project_kanban_event_deadlines.sql", "utf8");
const kanbanSectorOptionalMigration = readFileSync("supabase/migrations/20260918160253_project_kanban_sector_optional_and_published_filter.sql", "utf8");
const kanbanLegacyCleanupMigration = readFileSync("supabase/migrations/20260918161746_project_kanban_cleanup_legacy_auto_sectors.sql", "utf8");
const kanbanReceivedCommentsMigration = readFileSync("supabase/migrations/20260918171520_project_kanban_received_comments.sql", "utf8");
const signatureDueDateFixMigration = readFileSync("supabase/migrations/20260918193248_project_contract_signature_due_date_fix.sql", "utf8");

describe("projects contract financial migration", () => {
  it("links project installments to financial receivables", () => {
    expect(enumMigration).toContain("add value if not exists 'PROJECT'");
    expect(migration).toContain("project_installment_id uuid");
    expect(migration).toContain("project_installment_finance");
    expect(migration).toContain("financial_entries_project_installment_unique");
  });

  it("creates monthly contract schedule through an owner-only RPC", () => {
    expect(migration).toContain("public.save_project_contract");
    expect(migration).toContain("installment_number, due_on, amount_cents");
    expect(migration).toContain("interval '1 month'");
    expect(migration).toContain("project contract write denied");
    expect(migration).toContain("public.update_project_installment");
  });

  it("fills the mandatory competence date for project financial entries", () => {
    expect(competenceMigration).toContain("new.competence_date is null");
    expect(competenceMigration).toContain("coalesce(new.issue_date, current_date)");
    expect(competenceMigration).toContain("financial_entries_project_competence_date");
  });

  it("recalculates only open installments after received installments", () => {
    expect(scheduleMigration).toContain("status = 'PAID'");
    expect(scheduleMigration).toContain("v_paid_total");
    expect(scheduleMigration).toContain("v_open_count := greatest(p_installments_count - v_paid_count, 0)");
    expect(scheduleMigration).toContain("v_last_paid_number + 1");
  });

  it("separates entry due date from first installment due date", () => {
    expect(entryDueDateMigration).toContain("p_entry_due_on date");
    expect(entryDueDateMigration).toContain("installment_number = 0");
    expect(entryDueDateMigration).toContain("set due_on = p_entry_due_on");
    expect(entryDueDateMigration).toContain("set due_date = p_entry_due_on");
    expect(entryDueDateMigration).toContain("public.save_project_contract(");
  });

  it("supports signing contracts and selecting Kanban statuses", () => {
    expect(signatureStatusMigration).toContain("public.set_project_engagement_status");
    expect(signatureStatusMigration).toContain("p_accepted_on date");
    expect(signatureStatusMigration).toContain("kanban_board_id = v_board.id");
    expect(signatureStatusMigration).toContain("project engagement status write denied");
  });

  it("records project receipts with the complete financial classification", () => {
    expect(receiptMigration).toContain("public.settle_project_installment_receipt");
    expect(receiptMigration).toContain("p_chart_account_id uuid");
    expect(receiptMigration).toContain("p_cost_center_id uuid");
    expect(receiptMigration).toContain("p_document_number text");
    expect(receiptMigration).toContain("p_tag_ids uuid[]");
    expect(receiptMigration).toContain("public.settle_financial_entry");
    expect(receiptMigration).toContain("financial_entry_tags");
  });

  it("stores Kanban event details and owner-only comments", () => {
    expect(eventMigration).toContain("event_description text");
    expect(eventMigration).toContain("event_link_1 text");
    expect(eventMigration).toContain("create table public.project_engagement_comments");
    expect(eventMigration).toContain("public.save_project_engagement_event");
    expect(eventMigration).toContain("public.save_project_engagement_comment");
    expect(eventMigration).toContain("project_engagement_comments_owner_all");
    expect(eventMigration).toContain("public.is_organization_owner(p_organization_id)");
  });

  it("connects project boards to responsible sectors in the general Kanban", () => {
    expect(generalKanbanMigration).toContain("create table public.project_kanban_sectors");
    expect(generalKanbanMigration).toContain("alter table public.project_kanban_boards add column if not exists sector_id uuid");
    expect(generalKanbanMigration).toContain("public.upsert_project_kanban_sector");
    expect(generalKanbanMigration).toContain("public.upsert_project_kanban_board_with_sector");
    expect(generalKanbanMigration).toContain("public.move_project_engagement_to_kanban_sector");
    expect(generalKanbanMigration).toContain("project_kanban_sectors_owner_all");
  });

  it("records Kanban receipt metadata, deadlines, and deadline history", () => {
    expect(kanbanDeadlinesMigration).toContain("kanban_received_at timestamptz");
    expect(kanbanDeadlinesMigration).toContain("kanban_received_by_name text");
    expect(kanbanDeadlinesMigration).toContain("event_due_on date");
    expect(kanbanDeadlinesMigration).toContain("event_due_on = null");
    expect(kanbanDeadlinesMigration).toContain("Data prazo alterada");
    expect(kanbanDeadlinesMigration).toContain("public.move_project_engagement_to_kanban_board");
    expect(kanbanDeadlinesMigration).toContain("public.move_project_engagement_to_kanban_sector");
  });

  it("records each Kanban received date in the event comments", () => {
    expect(kanbanReceivedCommentsMigration).toContain("record_project_engagement_kanban_received_comment");
    expect(kanbanReceivedCommentsMigration).toContain("Data recebido alterada para");
    expect(kanbanReceivedCommentsMigration).toContain("old.kanban_received_at is distinct from new.kanban_received_at");
    expect(kanbanReceivedCommentsMigration).toContain("project_engagement_kanban_received_comment");
    expect(kanbanReceivedCommentsMigration).toContain("created_at = e.kanban_received_at");
  });

  it("allows saving a signature when the entry is already overdue", () => {
    expect(signatureDueDateFixMigration).toContain("issue_date = least(e.issue_date, p_entry_due_on)");
    expect(signatureDueDateFixMigration).toContain("due_date = p_entry_due_on");
    expect(signatureDueDateFixMigration).toContain("financial_settlements");
  });

  it("allows unassigned project boards to stay out of the general Kanban", () => {
    expect(kanbanSectorOptionalMigration).toContain("drop trigger if exists project_kanban_boards_assign_sector");
    expect(kanbanSectorOptionalMigration).toContain("drop function if exists public.ensure_project_kanban_board_sector");
    expect(kanbanSectorOptionalMigration).toContain("p_sector_id is not null and not exists");
    expect(kanbanSectorOptionalMigration).toContain("set sector_id = p_sector_id");
  });

  it("archives sectors that were auto-created from project board names", () => {
    expect(kanbanLegacyCleanupMigration).toContain("set active = false");
    expect(kanbanLegacyCleanupMigration).toContain("set sector_id = null");
    expect(kanbanLegacyCleanupMigration).toContain("lower(btrim(linked.name)) = lower(btrim(s.name))");
  });
});

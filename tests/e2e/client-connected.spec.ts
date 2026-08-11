import { expect, test } from "@playwright/test";

test("rota pública por slug preserva contexto na home do cliente", async ({ page }) => {
  await page.goto("/b/barbearia-do-bairro");
  const connected = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
  await expect(page).toHaveURL(
    connected
      ? /\/cliente\?barbearia=barbearia-do-bairro$/u
      : /\/cliente\/agendar$/u,
  );
});

test("cliente conectado nunca mostra dados demo", async ({ page }) => {
  test.skip(!process.env.E2E_CONNECTED_TENANT_SLUG, "Exige Supabase local semeado para cliente conectado.");
  const slug = process.env.E2E_CONNECTED_TENANT_SLUG!;
  await page.goto(`/cliente/agendar?barbearia=${encodeURIComponent(slug)}`);
  await expect(page.getByText("Rafael Martins")).toHaveCount(0);
  await expect(page.getByText("Vila Madalena · Rua Harmonia, 214")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Escolha seu cuidado" })).toBeVisible();
});

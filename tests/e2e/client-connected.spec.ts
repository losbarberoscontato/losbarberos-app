import { expect, test } from "@playwright/test";

test("rota pública por slug preserva contexto na home do cliente", async ({ page }) => {
  await page.goto("/b/barbearia-do-bairro");
  const connected = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
  await expect(page).toHaveURL(
    connected
      ? /\/cliente\?barbearia=barbearia-do-bairro$/u
      : /\/cliente\/agendar$/u,
  );
});

test("cliente conectado nunca mostra dados demo e mantém tipografia legível", async ({ page }, testInfo) => {
  test.skip(!process.env.E2E_CONNECTED_TENANT_SLUG, "Exige Supabase local semeado para cliente conectado.");
  const slug = process.env.E2E_CONNECTED_TENANT_SLUG!;
  await page.goto(`/cliente/agendar?barbearia=${encodeURIComponent(slug)}`);
  await expect(page.getByText("Rafael Martins")).toHaveCount(0);
  await expect(page.getByText("Vila Madalena · Rua Harmonia, 214")).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Qual serviço você quer?" })).toBeVisible();
  await expect(page.getByText("Escolha um serviço ou pacote do catálogo da barbearia.")).toHaveCSS(
    "font-size",
    testInfo.project.name === "mobile" ? "13px" : "15px",
  );
  await expect(page.getByRole("list", { name: "Etapa 1 de 4" }).getByText("Serviço")).toHaveCSS(
    "font-size",
    testInfo.project.name === "mobile" ? "10px" : "11px",
  );

  if (testInfo.project.name === "mobile") {
    const bottomNavigation = page.getByRole("navigation", { name: "Navegação do cliente" }).last();
    await expect(bottomNavigation.getByRole("link", { name: "Agendar" })).toHaveCSS("font-size", "10px");
  }
});

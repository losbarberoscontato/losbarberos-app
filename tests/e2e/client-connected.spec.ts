import { expect, test } from "@playwright/test";

test("rota pública por slug abre login do cliente preservando contexto", async ({ page }) => {
  await page.goto("/b/barbearia-do-bairro");
  const url = new URL(page.url());

  if (url.pathname === "/cliente/entrar") {
    expect(url.searchParams.get("barbearia")).toBe("barbearia-do-bairro");
  } else {
    expect(url.pathname).toBe("/entrar");
    expect(url.searchParams.get("erro")).toBe("supabase_not_configured");
    expect(url.searchParams.get("next")).toBe("/b/barbearia-do-bairro");
    await expect(page.getByRole("status")).toContainText("configuração do Supabase ausente");
  }

  await expect(page.getByText("Vila Madalena · Rua Harmonia, 214")).toHaveCount(0);
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

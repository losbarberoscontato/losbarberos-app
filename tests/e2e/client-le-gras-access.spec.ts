import { existsSync } from "node:fs";
import { expect, test } from "@playwright/test";

test("link do Estúdio Gras mostra acesso Le Gras em desktop e mobile", async ({ page }) => {
  test.skip(!existsSync(".env.local") && !(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
    "Acesso conectado exige configuração Supabase no servidor E2E.");
  test.setTimeout(120_000);
  await page.route("**/rest/v1/rpc/get_public_client_entry_context", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      organization_id: "0c860681-6957-4aea-8bf5-53ea8e7d09cd",
      organization_slug: "estudiogras",
      organization_name: "Estúdio Gras",
      logo_path: null,
      product_key: "le-gras",
    }),
  }));
  await page.route("**/rest/v1/platform_product_identities?*", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([{ config: {
      brand: { name: "Le Gras", tagline: "Fotografia que conta histórias", mark: "LG", logoUrl: "/display-sh/le-gras.png" },
      colors: { primary: "#29143d", secondary: "#59366f", accent: "#c8a45d", background: "#f5f0f7", surface: "#fffaff", text: "#251b2b", muted: "#756b7c", border: "#e5dce9", success: "#31705d", danger: "#a84545" },
      fonts: { interface: "Inter", display: "Baskerville" },
      vocabulary: { organization: "Estúdio", organizationPlural: "Estúdios" },
    } }]),
  }));
  await page.route("**/rest/v1/rpc/get_public_booking_context", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      organization: { id: "0c860681-6957-4aea-8bf5-53ea8e7d09cd", slug: "estudiogras", name: "Estúdio Gras", accepting_bookings: true },
      location: { name: "Unidade principal", address: {} }, services: [], packages: [], barbers: [],
    }),
  }));

  await page.goto("/b/4039018f-5f6c-4359-ac66-ab17a04ba161", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Acesse seu estúdio" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Logo de Le Gras" })).toBeVisible();
  await expect(page.getByText("Estúdio Gras").first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Le Gras/u })).toBeVisible();
  await expect(page.getByRole("button", { name: "Entrar", exact: true })).toHaveCSS("background-color", "rgb(41, 20, 61)");
  await expect(page.getByText("Acesse sua barbearia")).toHaveCount(0);

  await page.getByRole("tab", { name: "Criar conta" }).click();
  await expect(page.getByRole("heading", { name: "Acesse seu estúdio" })).toBeVisible();
  await expect(page.getByLabel("Telefone/Whatsapp")).toBeVisible();
  await expect(page.getByText("Avisos no WhatsApp e marketing começam ativos, separadamente.")).toHaveCount(0);
  await expect(page.getByText("Acesso do cliente")).toHaveCount(0);
  await page.getByRole("tab", { name: "Entrar" }).click();
  await page.getByRole("button", { name: "Esqueci minha senha" }).click();
  await expect(page.getByRole("button", { name: "Recuperar senha" })).toBeVisible();
});

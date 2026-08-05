import { expect, test } from "@playwright/test";

test.describe("Los Barberos · experiências principais", () => {
  test("landing apresenta o produto e abre o login demo", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: /Sua barbearia cheia/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /Testar agora/i })).toBeVisible();
    await page.getByRole("link", { name: /Testar agora/i }).click();

    await expect(page).toHaveURL(/\/entrar$/);
    await expect(page.getByRole("heading", { name: /Entre na sua barbearia/i })).toBeVisible();
    await page.getByRole("tab", { name: "Cliente" }).click();
    await expect(page.getByRole("heading", { name: /Cuide do seu horário/i })).toBeVisible();
  });

  test("gestor navega do dashboard para as visões da agenda", async ({ page }) => {
    await page.goto("/gestor");

    await expect(page.getByRole("heading", { name: /Boa tarde, Guilherme/i })).toBeVisible();
    await page.getByRole("link", { name: /^Agenda/ }).first().click();
    await expect(page).toHaveURL(/\/gestor\/agenda/);
    await expect(page.getByRole("heading", { name: "Agenda" })).toBeVisible();

    await page.getByRole("button", { name: "Semana" }).click();
    await expect(page.getByText("Seg 03")).toBeVisible();
    await page.getByRole("button", { name: "Mês" }).click();
    await expect(page.getByText("Dom", { exact: true })).toBeVisible();
  });

  test("cliente conclui o funil visual de agendamento", async ({ page }) => {
    await page.goto("/cliente/agendar");

    await expect(page.getByRole("heading", { name: /Como quer cuidar do visual/i })).toBeVisible();
    await page.getByRole("button", { name: /Corte clássico/ }).first().click();
    await page.getByRole("button", { name: "Continuar" }).click();

    await expect(page.getByRole("heading", { name: /Quando fica melhor/i })).toBeVisible();
    await page.getByRole("button", { name: "10:30" }).click();
    await page.getByRole("button", { name: "Continuar" }).click();

    await expect(page.getByRole("heading", { name: /Revise e confirme/i })).toBeVisible();
    await page.getByRole("button", { name: /Pagar valor completo/ }).click();
    await page.getByRole("button", { name: /Pagar R\$/ }).click();

    await expect(page.getByRole("heading", { name: "Horário confirmado." })).toBeVisible();
    await expect(page.getByText("LB-1054")).toBeVisible();
  });

  test("aliases legados levam para as rotas canônicas", async ({ page }) => {
    await page.goto("/login");
    await expect(page).toHaveURL(/\/entrar$/);

    await page.goto("/agendar");
    await expect(page).toHaveURL(/\/cliente\/agendar$/);
  });
});

test.describe("Los Barberos · responsividade", () => {
  for (const route of ["/", "/entrar", "/gestor", "/gestor/agenda", "/gestor/clientes", "/cliente/agendar", "/cliente/reservas", "/admin", "/regularizacao", "/onboarding"]) {
    test(`${route} não cria overflow horizontal no viewport`, async ({ page }) => {
      await page.goto(route);
      await page.waitForLoadState("domcontentloaded");
      const sizes = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        page: document.documentElement.scrollWidth,
        offenders: Array.from(document.querySelectorAll<HTMLElement>("body *"))
          .map((element) => ({ selector: `${element.tagName.toLowerCase()}.${element.className}`, width: Math.round(element.getBoundingClientRect().width), right: Math.round(element.getBoundingClientRect().right) }))
          .filter((item) => item.width > document.documentElement.clientWidth + 1 || item.right > document.documentElement.clientWidth + 1)
          .sort((a, b) => b.width - a.width)
          .slice(0, 4),
        containers: [".customers-panel", ".customers-table-wrap", ".admin-organizations", ".admin-table-wrap"].map((selector) => {
          const element = document.querySelector<HTMLElement>(selector);
          if (!element) return { selector, missing: true };
          const style = getComputedStyle(element);
          return { selector, width: Math.round(element.getBoundingClientRect().width), clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, overflowX: style.overflowX };
        }),
      }));
      expect(sizes.page, `${route}: scrollWidth ${sizes.page}, viewport ${sizes.viewport}, offenders ${JSON.stringify(sizes.offenders)}, containers ${JSON.stringify(sizes.containers)}`).toBeLessThanOrEqual(sizes.viewport + 1);
    });
  }
});

test("PWA expõe manifest e service worker online-first seguro", async ({ request }) => {
  const manifestResponse = await request.get("/manifest.webmanifest");
  expect(manifestResponse.ok()).toBeTruthy();
  const manifest = await manifestResponse.json();
  expect(manifest.name).toBe("Los Barberos");
  expect(manifest.icons).toEqual(expect.arrayContaining([
    expect.objectContaining({ sizes: "192x192" }),
    expect.objectContaining({ sizes: "512x512" }),
    expect.objectContaining({ purpose: "maskable" }),
  ]));

  const workerResponse = await request.get("/sw.js");
  expect(workerResponse.ok()).toBeTruthy();
  const worker = await workerResponse.text();
  expect(worker).toContain('request.mode === "navigate"');
  expect(worker).toContain('fetch(request).catch(() => caches.match("/offline.html"))');
  expect(worker).not.toContain("cache.put");
  expect(worker).not.toContain("/api/");
  expect(worker).not.toContain("/auth/");
});

test("página offline explica que dados sensíveis não ficam em cache", async ({ page }) => {
  await page.goto("/offline");
  await expect(page.getByRole("heading", { name: /A internet deu uma pausa/i })).toBeVisible();
  await expect(page.getByText(/agenda, clientes e pagamentos não ficam salvos/i)).toBeVisible();
});

test("service worker não devolve área privada antiga quando a rede cai", async ({ page, context }) => {
  test.skip(process.env.PWA_E2E !== "1", "exige servidor de produção com service worker ativo");

  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });

  await context.setOffline(true);
  await page.goto("/gestor");
  await expect(page.getByRole("heading", { name: /A internet deu uma pausa/i })).toBeVisible();
  await expect(page.getByText(/Agenda, clientes e pagamentos não ficam em cache/i)).toBeVisible();
  await expect(page.getByText(/Guilherme|Rafael|receita/i)).toHaveCount(0);
});

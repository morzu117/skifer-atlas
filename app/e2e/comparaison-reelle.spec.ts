import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { FAKE_DATABRICKS, seriousViolations } from "./demo";
import { AUTH_API, isolatedDemo, relay, test } from "./isolation";

// Plans 0008, 0009 et 0015 : la comparaison s'exécute pour de vrai sur le serveur sans données
// locales (8793) ; nordis-fr lit Databricks, c'est-à-dire le faux, qui peut retenir une requête
// ou répondre un résultat démesuré. Le faux ne calcule pas le SQL métier : ce que ces scénarios
// vérifient, c'est le cycle d'exécution (durée, annulation, doublon, refus de rapatriement).

const launchButton = (page: Page) => page.getByRole("button", { name: /Lancer la comparaison|Relancer/ });

async function configure(request: APIRequestContext, data = {}) {
  expect((await request.post(`${FAKE_DATABRICKS}/__test__/configure`, { data })).ok()).toBe(true);
}
const state = async (request: APIRequestContext) =>
  (await (await request.get(`${FAKE_DATABRICKS}/__test__/state`)).json()) as { canceled: string[]; held: string[]; statements: number };

test.afterEach(async ({ request }) => { await configure(request); });

/** Espace isolé, nordis-fr seule cochée, accès dbx-fr obtenu par l'OAuth du faux Databricks. */
async function connected(page: Page, request: APIRequestContext) {
  const ws = await isolatedDemo(request, AUTH_API);
  await relay(page, AUTH_API);
  const previewed = page.waitForResponse(r => r.url().endsWith("/comparisons/preview")
    && (JSON.parse(r.request().postData() ?? "{}") as { variants?: string[] }).variants?.join() === "nordis-fr");
  await page.goto(`${ws.root}/comparaison`);
  await page.getByRole("checkbox", { name: /nordis-es/ }).uncheck();
  await page.getByRole("checkbox", { name: /nordis-de/ }).uncheck();
  await previewed;
  const opened = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Se connecter à dbx-fr" }).click();
  const popup = await opened;
  await expect(popup.getByText(/Connexion réussie/)).toBeVisible();
  await popup.close();
  await expect(page.getByText("Connexion requise", { exact: true })).toHaveCount(0);
  await expect(launchButton(page)).not.toHaveAttribute("aria-disabled", "true");
  return ws;
}

test("[S-0015-05] [S-0009-10] Annuler une comparaison qui tourne vraiment : l'exécution est « annulée », la requête retenue est annulée chez la plateforme", async ({ page, request }) => {
  const ws = await connected(page, request);
  await configure(request, { hold: true });
  await launchButton(page).click();
  const bar = page.getByRole("progressbar", { name: "Databricks · nordis-fr" });
  await expect(bar).toBeVisible();
  await expect.poll(async () => (await state(request)).held.length).toBe(1);
  expect(await seriousViolations(page)).toEqual([]);

  await page.getByRole("button", { name: "Annuler" }).click();
  await expect(page.getByText(/Comparaison n° \d+ annulée\./)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Annuler" })).toHaveCount(0);
  await expect(page.getByText("Annulé", { exact: true }).first()).toBeVisible();
  // Chez la plateforme : la requête retenue a reçu son annulation, rien ne reste en cours.
  await expect.poll(async () => (await state(request)).canceled.length).toBe(1);
  expect((await state(request)).held).toEqual([]);
  await expect(launchButton(page)).not.toHaveAttribute("aria-disabled", "true");

  // L'historique garde l'exécution annulée, sans résultat.
  await page.goto(`${ws.root}/comparaison?vue=historique`);
  const rows = page.getByRole("table").getByRole("row");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText(/annulée/i);
  expect(await seriousViolations(page)).toEqual([]);
  await page.goto("about:blank");
});

test("[S-0009-13] Une seconde demande identique pendant l'exécution est refusée pour de vrai, sans seconde exécution", async ({ page, request }) => {
  const ws = await connected(page, request);
  await configure(request, { hold: true });
  await launchButton(page).click();
  await expect(page.getByRole("progressbar", { name: "Databricks · nordis-fr" })).toBeVisible();
  await expect.poll(async () => (await state(request)).held.length).toBe(1);

  // Un second onglet de la même session ouvre le même écran et lance la même comparaison.
  const other = await page.context().newPage();
  await relay(other, AUTH_API);
  await other.goto(`${ws.root}/comparaison`);
  await other.getByRole("checkbox", { name: /nordis-es/ }).uncheck();
  await other.getByRole("checkbox", { name: /nordis-de/ }).uncheck();
  const refused = other.waitForResponse(r => r.url().endsWith("/comparisons") && r.request().method() === "POST");
  await launchButton(other).click();
  const response = await refused;
  expect(response.status()).toBe(409);
  expect(await response.json()).toMatchObject({ detail: { code: "comparison_running" } });
  await expect(other.getByText("Comparaison déjà en cours")).toBeVisible();
  await expect(other.getByText("Attendez sa fin avant de relancer cette comparaison.")).toBeVisible();
  await expect(other.getByRole("progressbar")).toHaveCount(0);
  expect(await seriousViolations(other)).toEqual([]);
  await other.close();
  // Une seule requête est partie chez la plateforme.
  expect((await state(request)).held).toHaveLength(1);

  await page.getByRole("button", { name: "Annuler" }).click();
  await expect(page.getByText(/Comparaison n° \d+ annulée\./)).toBeVisible({ timeout: 15_000 });
  await page.goto("about:blank");
});

test("[S-0008-06] Un résultat au-delà de la limite de lignes n'est pas rapatrié : la comparaison échoue, la requête est annulée chez la plateforme", async ({ page, request }) => {
  const ws = await connected(page, request);
  await configure(request, { rows: 60_000, chunk_size: 60_000 });
  await launchButton(page).click();
  await expect(page.getByRole("button", { name: "Relancer" })).toBeVisible({ timeout: 30_000 });
  // Comportement attendu : un message traduit qui cite la limite de lignes, sans code technique.
  // Rouge tant que l'écran affiche le code brut `result_too_large` (issue à corriger).
  const failure = page.getByRole("status").filter({ hasText: /en échec/ });
  await expect.soft(failure).toContainText(/dépasse.*50[\s\u00a0\u202f]?000 lignes/);
  await expect.soft(failure).not.toContainText("result_too_large");
  await expect(page.getByRole("alert").filter({ hasText: "Comparaison en échec" })).toBeVisible();
  await expect.poll(async () => (await state(request)).canceled.length).toBeGreaterThan(0);
  expect(await seriousViolations(page)).toEqual([]);
  await page.goto(`${ws.root}/comparaison?vue=historique`);
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(2);
  await expect(page.getByRole("table").getByRole("row").nth(1)).toContainText(/échec|échouée/i);
  await page.goto("about:blank");
});

test("[S-0015-04] Après l'authentification, la reprise va jusqu'au bout : l'exécution se termine et son issue est affichée", async ({ page, request }) => {
  const ws = await connected(page, request);
  await launchButton(page).click();
  await expect(page.getByRole("button", { name: "Relancer" })).toBeVisible({ timeout: 30_000 });
  // Le faux ne calcule pas le SQL métier : la comparaison se termine en échec, expliqué à l'écran.
  await expect(page.getByRole("alert").or(page.getByText(/absente du résultat|Échec/)).first()).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
  await page.goto(`${ws.root}/comparaison?vue=historique`);
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(2);
  await page.goto("about:blank");
});

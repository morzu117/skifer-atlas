import { expect, test, type Locator, type Page } from "@playwright/test";
import { API, ensureNordis, FAKE_DATABRICKS, seriousViolations } from "./demo";
import { longKpi, type Raw } from "./graphe";

// Plan 0026 : mêmes serveurs après Chromium, sans supposer leur état initial.
const ROOT = "/#/w/groupe-nordis";
const EDITOR = `${API}/api/workspaces/groupe-nordis/editor`;

test.beforeAll(async ({ request }) => { await ensureNordis(request); });

async function move(page: Page, card: Locator) {
  const before = (await card.boundingBox())!;
  await page.mouse.move(before.x + before.width / 2, before.y + 12);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2, before.y + 60, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => (await card.boundingBox())!.y).toBeGreaterThan(before.y + 12);
}

test("accueil : création, ouverture et bascule entre deux espaces", async ({ page }) => {
  const name = `WebKit ${Date.now().toString(36)}`;
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Vos espaces de travail" })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
  await page.getByRole("button", { name: "Créer un espace" }).click();
  const dialog = page.getByRole("dialog", { name: "Créer un espace" });
  await dialog.getByLabel(/^Nom/).fill(name);
  const id = await dialog.getByLabel(/^Identifiant/).inputValue();
  expect(await seriousViolations(page)).toEqual([]);
  await dialog.getByRole("button", { name: "Créer l'espace" }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${id}/catalogue$`));
  await page.getByRole("link", { name: new RegExp(`Espace\\s*${name}`) }).click();
  await page.getByRole("list", { name: "Espaces" }).getByRole("link").filter({ hasText: "Groupe Nordis" }).click();
  await expect(page).toHaveURL(/#\/w\/groupe-nordis\/catalogue$/);
  await page.getByRole("link", { name: /Espace\s*Groupe Nordis/ }).click();
  await page.getByRole("list", { name: "Espaces" }).getByRole("link").filter({ hasText: name }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${id}/catalogue$`));
  expect(await seriousViolations(page)).toEqual([]);
});

test("catalogue : recherche avec et sans accents, navigation au clavier", async ({ page }) => {
  await page.goto(`${ROOT}/catalogue`);
  const table = page.getByRole("table", { name: "Concepts et KPI" });
  const search = page.getByRole("searchbox", { name: "Rechercher dans le catalogue" });
  for (const query of ["reference", "référence"]) {
    await search.fill(query);
    await expect(table.getByRole("link")).toHaveText(["Date de référence"]);
  }
  await search.fill("");
  const revenue = table.getByRole("link", { name: "Revenu net", exact: true });
  await revenue.focus();
  await page.keyboard.press("ArrowDown");
  await expect(table.getByRole("link", { name: "Taux de service" })).toBeFocused();
  await expect(page.getByRole("complementary", { name: "Taux de service" })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/fiche\/taux-de-service$/);
});

test("fiche : graphe en lecture, onglets au clavier et diff de versions", async ({ page }) => {
  await page.goto(`${ROOT}/fiche/revenu-net`);
  const graph = page.getByRole("figure", { name: "Graphe de Revenu net" });
  await expect(graph.locator(".graph-card")).toHaveCount(7);
  await expect(graph.getByRole("textbox")).toHaveCount(0);
  expect(await seriousViolations(page)).toEqual([]);
  const tabs = page.getByRole("navigation", { name: "Onglets de la fiche" });
  await tabs.getByRole("link", { name: "Définition", exact: true }).focus();
  // WebKit sous macOS (Safari, WKWebView donc Tauri) ne passe pas par les liens avec Tab
  // seul, sauf réglage : ⌥Tab les parcourt.
  await page.keyboard.press("Alt+Tab");
  await expect(tabs.getByRole("link", { name: /Déclinaisons/ })).toBeFocused();
  await page.keyboard.press("Alt+Tab");
  await expect(tabs.getByRole("link", { name: /Versions/ })).toBeFocused();
  await page.keyboard.press("Enter");
  await page.getByRole("combobox", { name: "De", exact: true }).selectOption("3");
  await page.getByRole("combobox", { name: "À", exact: true }).selectOption("4");
  await page.getByRole("button", { name: "Afficher les écarts" }).click();
  await expect(page.locator(".diff-item")).toHaveCount(3);
  await expect(page.getByRole("figure", { name: "Graphe de la version 4" }).locator(".graph-card").filter({ hasText: "n06" })).toContainText("ajouté");
  expect(await seriousViolations(page)).toEqual([]);
});

for (const count of [7, 200]) {
  test(`éditeur : Revenu net, ${count} nœuds, sélection et déplacement${count === 7 ? ", suppression annulée au clavier" : ", cartes visibles seulement"}`, async ({ page, request }) => {
    test.setTimeout(60_000);
    const response = await request.get(`${EDITOR}/documents/revenu-net`);
    expect(response.ok()).toBe(true);
    const opened = await response.json() as { document: Raw };
    const id = `webkit-${count}-${Date.now().toString(36)}`;
    const document = count === 200 ? longKpi(opened.document, count) : opened.document;
    (document.data_product as Record<string, unknown>).id = id;
    const saved = await request.put(`${EDITOR}/documents/${id}/draft`, { data: { document, positions: {}, highest: count, base_version: null } });
    expect(saved.ok()).toBe(true);
    try {
      const start = Date.now();
      await page.goto(`${ROOT}/editeur?from=${id}`);
      const canvas = page.getByRole("group", { name: /^Graphe de/ });
      const cards = canvas.locator("[data-node-id]");
      await expect(cards.first()).toBeVisible();
      const opening = Date.now() - start;
      const drawn = await cards.count();
      expect(drawn).toBeGreaterThan(1);
      if (count === 200) expect(drawn).toBeLessThan(count);
      else expect(drawn).toBe(count);
      const node = (await cards.nth(1).getAttribute("data-node-id"))!;
      const card = canvas.locator(`[data-node-id="${node}"]`);
      const selection = Date.now();
      await card.click();
      await expect(page.getByRole("complementary", { name: "Propriétés" }).getByText(node, { exact: true })).toBeVisible();
      const selected = Date.now() - selection;
      const movement = Date.now();
      await move(page, card);
      const moved = Date.now() - movement;
      if (count === 7) {
        // L'annulation porte sur les opérations du document, pas sur les positions (ADR 0017).
        await page.getByRole("complementary", { name: "Propriétés" }).getByRole("button", { name: "Supprimer" }).click();
        await expect(cards).toHaveCount(count - 1);
        await page.keyboard.press("ControlOrMeta+z");
        await expect(cards).toHaveCount(count);
        await expect(card).toBeVisible();
      }
      console.log(`WebKit ${count} nœuds, ${drawn} cartes : ouverture ${opening} ms, sélection ${selected} ms, déplacement ${moved} ms`);
      expect(await seriousViolations(page)).toEqual([]);
    } finally {
      await page.goto("/"); // démonter l'éditeur avant de supprimer son brouillon
      expect((await request.delete(`${EDITOR}/documents/${id}/draft`)).ok()).toBe(true);
    }
  });
}

test("propositions : file, proposition et diff en lecture seule", async ({ page }) => {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith(API) && !["GET", "OPTIONS"].includes(request.method())) writes.push(request.url());
  });
  await page.goto(`${ROOT}/propositions`);
  const queue = page.getByRole("list", { name: "File des propositions" });
  // FR reste ouverte après Chromium ; aucune hypothèse sur les validations ou le total.
  const entry = queue.getByRole("link").filter({ hasText: "Revenu net · nordis-fr" });
  await expect(entry).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
  await entry.click();
  await expect(page.getByRole("region", { name: "Proposition sélectionnée" })).toBeVisible();
  const diff = page.getByRole("region", { name: "Diff de la proposition" });
  await expect(diff.locator(".diff-item").first()).toBeVisible();
  await expect(page.getByRole("figure", { name: /Graphe : Canonique/ })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
  expect(writes).toEqual([]);
});

test("comparaison : lancement et ouverture du détail", async ({ page }) => {
  await page.goto(`${ROOT}/comparaison`);
  await expect(page.getByRole("combobox", { name: "KPI" })).toHaveValue("revenu-net");
  expect(await seriousViolations(page)).toEqual([]);
  const launched = page.waitForResponse((response) => response.url().endsWith("/comparisons") && response.request().method() === "POST");
  await page.getByRole("button", { name: /Lancer la comparaison|Relancer/ }).click();
  const response = await launched;
  expect(response.status()).toBe(202);
  const { id } = await response.json() as { id: number };
  await expect(page).toHaveURL(new RegExp(`id=${id}&variant=`), { timeout: 20_000 });
  await page.getByRole("link", { name: /Revenu net × nordis-fr : 100 % de validation/ }).click();
  const detail = page.getByRole("region", { name: /Détail · Revenu net · nordis-fr/ });
  await expect(detail).toBeVisible();
  await expect(detail.getByRole("row").nth(1)).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});

test("connexions : popup OAuth vers le faux Databricks et retour local", async ({ page, context }) => {
  await page.goto(`${ROOT}/connexions`);
  await page.getByRole("button", { name: "Ajouter un point d'accès" }).click();
  const panel = page.getByRole("complementary", { name: "Nouveau point d'accès" });
  const id = `webkit-dbx-${Date.now().toString(36)}`;
  await panel.getByRole("textbox", { name: "Identifiant" }).fill(id);
  await panel.getByRole("textbox", { name: "Hôte" }).fill(FAKE_DATABRICKS);
  await panel.getByRole("textbox", { name: "SQL warehouse" }).fill("abc123");
  await panel.getByRole("textbox", { name: "Schéma" }).fill("gold.finance");
  expect(await seriousViolations(page)).toEqual([]);
  const authorization = context.waitForEvent("request", (request) => request.url().startsWith(`${FAKE_DATABRICKS}/oidc/v1/authorize?`));
  const popupPromise = page.waitForEvent("popup");
  await panel.getByRole("button", { name: "S'authentifier avec OAuth" }).click();
  const popup = await popupPromise;
  const request = await authorization;
  expect(request.isNavigationRequest()).toBe(true);
  expect(request.frame().page()).toBe(popup);
  await expect(popup.getByText(/Connexion réussie/)).toBeVisible();
  await expect(popup).toHaveURL(/^http:\/\/localhost:8020\//);
  await popup.close();
  await expect(panel.getByText(`Connecté : le token est rangé dans votre coffre, sous ${id}.`)).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});

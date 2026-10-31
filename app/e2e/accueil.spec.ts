import { expect, test } from "@playwright/test";
import { relay } from "./isolation";
import { API, demoRemote, seriousViolations } from "./demo";

// Plan 0010 de bout en bout. Un seul serveur pour tout le fichier : les tests se suivent
// (registre vide, création, adhésion, puis deux cartes).
test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => { await relay(page, "http://127.0.0.1:8791"); });

let bare = "";

test.beforeAll(() => {
  bare = demoRemote();
});

test("[S-0010-02] [S-0010-09] [S-0010-10] registre vide : carte vide, polices locales, accessibilité (critères 2, 9, 10)", async ({ page }) => {
  const external: string[] = [];
  await page.route("**/*", (route) => {
    const { hostname } = new URL(route.request().url());
    if (hostname === "localhost" || hostname === "127.0.0.1") return route.continue();
    external.push(route.request().url());
    return route.abort(); // réseau coupé : rien d'autre que l'app et le serveur local
  });
  await page.goto("/");
  await expect(page.getByText("Aucun espace pour l'instant")).toBeVisible();

  const inter = await page.evaluate(async () => (await document.fonts.load("600 14px Inter")).length);
  const mono = await page.evaluate(async () => (await document.fonts.load('400 13px "JetBrains Mono"')).length);
  expect([inter, mono]).toEqual([1, 1]);
  expect(external).toEqual([]);

  expect(await seriousViolations(page)).toEqual([]);
});

test("[S-0005-01] [S-0010-03] [S-0010-06] créer un espace l'ouvre, un identifiant pris donne l'erreur sous le champ (critères 3, 6)", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Créer un espace" }).click();
  const dialog = page.getByRole("dialog", { name: "Créer un espace" });
  await dialog.getByLabel(/^Nom/).fill("Maison Perrault");
  await expect(dialog.getByLabel(/^Identifiant/)).toHaveValue("maison-perrault");
  await dialog.getByLabel("Secteur").fill("Luxe");
  await dialog.getByLabel("Entités").fill("mp-fr, mp-it");
  expect(await seriousViolations(page)).toEqual([]);
  await dialog.getByRole("button", { name: "Créer l'espace" }).click();

  await expect(page).toHaveURL(/#\/w\/maison-perrault\/catalogue$/);
  await expect(page.getByRole("heading", { name: "Catalogue" })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Navigation de l'espace" });
  await expect(nav.getByRole("link", { name: "Administration" })).toBeVisible(); // créatrice = référente
  expect(await seriousViolations(page)).toEqual([]);

  const switcher = page.getByRole("link", { name: /Espace\s*Maison Perrault/ });
  await switcher.click();
  await expect(page).toHaveURL(/#\/$/);
  await page.getByRole("button", { name: "Créer un espace" }).click();
  await dialog.getByLabel(/^Nom/).fill("Maison Perrault");
  await dialog.getByRole("button", { name: "Créer l'espace" }).click();
  await expect(dialog.getByLabel(/^Identifiant/)).toHaveAccessibleDescription(/Un espace porte déjà cet identifiant/);
});

test("[S-0005-02] [S-0010-04] [S-0010-07] rejoindre le dépôt de démonstration le clone et l'ouvre (critères 4, 7)", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Rejoindre un espace" }).click();
  const dialog = page.getByRole("dialog", { name: "Rejoindre un espace" });
  await dialog.getByLabel(/^Adresse du dépôt/).fill(bare);
  await dialog.getByRole("button", { name: "Cloner et ouvrir" }).click();

  await expect(page).toHaveURL(/#\/w\/groupe-nordis\/catalogue$/);
  await expect(page.getByRole("link", { name: /Espace\s*Groupe Nordis/ })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Navigation de l'espace" });
  await expect(nav.getByRole("link", { name: "Connexions" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Administration" })).toHaveCount(0); // anna.k : contributrice
  await expect(page.getByText("Contributeur")).toBeVisible();
});

test("[S-0010-01] [S-0010-10] deux espaces, deux cartes ; navigation au clavier (critères 1, 10)", async ({ page }) => {
  await page.goto("/");
  const cards = page.getByRole("list", { name: "Espaces" }).getByRole("link");
  await expect(cards).toHaveCount(2);
  const nordis = cards.filter({ hasText: "Groupe Nordis" });
  await expect(nordis).toContainText("Contributeur");
  await expect(nordis).toContainText("Distribution · 3 entités · 4 domaines");
  await expect(nordis).toContainText("4 KPI");
  await expect(nordis).toContainText("3 concepts");
  await expect(nordis).toContainText("Aucune proposition");
  const perrault = cards.filter({ hasText: "Maison Perrault" });
  await expect(perrault).toContainText("Référent d'annuaire");
  await expect(perrault).toContainText("Luxe · 2 entités · 0 domaine");
  expect(await seriousViolations(page)).toEqual([]);

  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press("Tab");
    if (await nordis.evaluate((el) => el === document.activeElement)) break;
  }
  await expect(nordis).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/w\/groupe-nordis\/catalogue$/);
  await expect(page.getByRole("heading", { name: "Catalogue" })).toBeFocused(); // le titre de la vue
  await page.keyboard.press("Shift+Tab"); // dernier lien de la navigation
  await expect(page.getByRole("link", { name: "Connexions" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("link", { name: "Propositions" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Propositions" })).toBeFocused();
  for (let i = 0; i < 5; i += 1) await page.keyboard.press("Shift+Tab"); // Connexions → … → sélecteur
  await expect(page.getByRole("link", { name: /Espace\s*Groupe Nordis/ })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Vos espaces de travail" })).toBeFocused();
});

test("[S-0010-05] serveur arrêté : bandeau, puis Réessayer après redémarrage (critère 5)", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("list", { name: "Espaces" })).toBeVisible();
  await page.route(`${API}/**`, (route) => route.abort("connectionrefused"));
  await page.getByRole("link", { name: /Groupe Nordis/ }).click();
  const banner = page.getByRole("alert").filter({ hasText: "Serveur local injoignable" });
  await expect(banner).toBeVisible();
  await banner.getByRole("button", { name: "Réessayer" }).click();
  await expect(banner).toBeVisible(); // toujours arrêté
  await page.unroute(`${API}/**`);
  await relay(page, "http://127.0.0.1:8791");
  await banner.getByRole("button", { name: "Réessayer" }).click();
  await expect(banner).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Catalogue" })).toBeVisible();
});

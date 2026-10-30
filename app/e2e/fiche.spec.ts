import { expect, test, type Page } from "@playwright/test";
import { ensureNordis, seriousViolations } from "./demo";

// Plan 0012 de bout en bout, sur l'espace de démonstration et l'historique de Revenu net
// (examples/depot-nordis.sh : v1 à v4).

const FICHE = "/#/w/groupe-nordis/fiche/revenu-net";

test.beforeAll(async ({ request }) => {
  await ensureNordis(request);
});

const graph = (page: Page, name = "Graphe de Revenu net") => page.getByRole("figure", { name });
const card = (page: Page, id: string, name?: string) =>
  graph(page, name).locator(".graph-card").filter({ has: page.locator(".graph-card-id", { hasText: new RegExp(`^${id}$`) }) });

test("catalogue → fiche : en-tête, compteurs, graphe et points de variation (critères 1 et 2)", async ({ page }) => {
  await page.goto("/#/w/groupe-nordis/catalogue");
  await page.getByRole("table", { name: "Concepts et KPI" }).getByRole("link", { name: "Revenu net" }).click();
  await expect(page).toHaveURL(/#\/w\/groupe-nordis\/fiche\/revenu-net$/);
  await expect(page.getByRole("heading", { level: 1, name: "Revenu net" })).toBeFocused();
  await expect(page.getByText("v4 · validée le 12 oct. 2026")).toBeVisible();
  await expect(page.getByText("Propriétaire : Claire M. · Validateurs : 2 requis (canonique) · Synonymes : CA net, net revenue")).toBeVisible();

  const tabs = page.getByRole("navigation", { name: "Onglets de la fiche" });
  await expect(tabs.getByRole("link", { name: "Déclinaisons 3" })).toBeVisible();
  await expect(tabs.getByRole("link", { name: "Versions 4" })).toBeVisible();
  await expect(tabs.getByRole("link", { name: "Définition" })).toHaveAttribute("aria-current", "page");

  for (const id of ["n01", "n02", "n03", "n04", "n05", "n06", "n07"]) await expect(card(page, id)).toBeVisible();
  for (const id of ["n03", "n04"]) {
    await expect(card(page, id)).toContainText("· variation");
    await expect(card(page, id)).toHaveCSS("border-top-style", "dashed");
    await expect(card(page, id)).toHaveCSS("border-top-color", "rgb(175, 90, 27)"); // --atlas-warn
    await expect(card(page, id)).toHaveCSS("border-top-width", "2px");
  }
  await expect(card(page, "n02")).toHaveCSS("border-top-style", "solid");
  await expect(page.getByText("Une nouvelle version touchera 2 documents.")).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);

  await page.getByRole("main").getByRole("link", { name: "Catalogue", exact: true }).click(); // fil d'Ariane
  await expect(page.getByRole("complementary", { name: "Revenu net" })).toBeVisible(); // retour sur la ligne
});

test("deux chargements donnent la même disposition (critère 6)", async ({ page }) => {
  const boxes = async () => {
    await page.goto(FICHE);
    await expect(card(page, "n07")).toBeVisible();
    const found: Record<string, unknown> = {};
    for (const id of ["n01", "n02", "n03", "n04", "n05", "n06", "n07"]) found[id] = await card(page, id).boundingBox();
    return found;
  };
  const first = await boxes();
  await page.reload();
  expect(await boxes()).toEqual(first);
});

test("versions : diff de v3 à v4, classé et coloré (critère 3)", async ({ page }) => {
  await page.goto(FICHE);
  await page.getByRole("navigation", { name: "Onglets de la fiche" }).getByRole("link", { name: /Versions/ }).click();
  const table = page.getByRole("table");
  await expect(table.getByRole("row")).toHaveCount(5);
  await expect(table.getByRole("row").nth(1)).toContainText("v4 · courante");
  await expect(table.getByRole("row").nth(2)).toContainText("Marc D.");
  await expect(page.getByRole("combobox", { name: "De" })).toHaveValue("3");
  await expect(page.getByRole("combobox", { name: "À" })).toHaveValue("4");
  await page.getByRole("button", { name: "Afficher les écarts" }).click();
  await expect(page).toHaveURL(/tab=versions&base=3&other=4$/);

  const items = page.locator(".diff-item");
  await expect(items).toHaveCount(3);
  await expect(items.nth(0)).toContainText("n04");
  await expect(items.nth(0)).toContainText("À examiner");
  await expect(items.nth(0)).toHaveCSS("border-left-color", "rgb(175, 90, 27)");
  for (const index of [1, 2]) {
    await expect(items.nth(index)).toContainText("Divergence critique");
    await expect(items.nth(index)).toHaveCSS("border-left-color", "rgb(177, 59, 59)"); // --atlas-bad
  }
  await expect(page.getByText("3 écarts : 2 critiques, 1 à surveiller, 0 sans effet.")).toBeVisible();

  const after = "Graphe de la version 4";
  await expect(card(page, "n06", after)).toContainText("ajouté");
  await expect(card(page, "n04", after)).toContainText("modifié");
  await expect(card(page, "n04", "Graphe de la version 3")).toContainText("modifié");
  await expect(card(page, "n06", after)).toHaveCSS("border-top-color", "rgb(41, 126, 118)"); // --atlas-ok
  expect(await seriousViolations(page)).toEqual([]);

  await page.reload(); // l'adresse garde le diff
  await expect(page.locator(".diff-item")).toHaveCount(3);
});

test("implémentations : extraire le SQL et le comparer au canonique (critère 4)", async ({ page }) => {
  await page.goto(`${FICHE}?tab=implementations`);
  const section = page.getByRole("region", { name: "nordis-fr · Databricks" });
  await expect(section).toContainText("implementations/revenu-net/nordis-fr/databricks.sql");
  await expect(section).toContainText("SUM(f.montant_ttc / 1.2 - f.avoirs) AS revenu_net");
  await section.getByRole("button", { name: "Extraire et comparer au canonique" }).click();
  await expect(section).toContainText("fidélité au SQL vérifiée");
  await expect(section).toContainText("Cardinalité de la jointure inconnue");
  const diff = section.getByRole("region", { name: "Écarts au canonique" });
  await expect(diff).toContainText("Écarts au canonique v4");
  await expect(diff.locator(".diff-item").first()).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});

test("déclinaisons, dépendances, scope", async ({ page }) => {
  await page.goto(`${FICHE}?tab=declinaisons`);
  const de = page.getByRole("row").filter({ hasText: "nordis-de" });
  await expect(de).toContainText("Surcharge · 3");
  await expect(de).toContainText("3, dont 2 hors points déclarés");
  await expect(page.getByRole("row").filter({ hasText: "nordis-es" })).toContainText("From scratch · candidate");
  expect(await seriousViolations(page)).toEqual([]);

  await page.goto(`${FICHE}?tab=dependances`);
  const by = page.getByRole("region", { name: "Référencé par" });
  await expect(by.getByRole("link", { name: "Panier moyen" })).toBeVisible();
  await expect(by).toContainText("KPI · Ventes · v4");
  await by.getByRole("link", { name: "Panier moyen" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Panier moyen" })).toBeVisible();

  await page.goto(`${FICHE}?tab=scope`);
  await expect(page.getByRole("row").filter({ hasText: "fy2026-mois-entite" })).toContainText("2026-02-01 → 2026-09-30");
  await expect(page.getByText("1,5 % (propre au KPI)")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Dernières comparaisons" })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});

test("« Proposer une modification » ouvre une copie en v5, en brouillon (critère 5)", async ({ page }) => {
  await page.goto(FICHE);
  await page.getByRole("link", { name: "Proposer une modification" }).click();
  await expect(page).toHaveURL(/#\/w\/groupe-nordis\/editeur\?from=revenu-net$/);
  await expect(page.getByRole("heading", { level: 1, name: "Revenu net : v5 · brouillon" })).toBeVisible();
  await expect(page.getByText("schéma 1 · 7 nœuds · 6 arêtes")).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});

test("une fiche de concept masque les onglets propres aux KPI (critère 7)", async ({ page }) => {
  await page.goto("/#/w/groupe-nordis/fiche/commande");
  await expect(page.getByRole("heading", { level: 1, name: "Commande" })).toBeVisible();
  const tabs = page.getByRole("navigation", { name: "Onglets de la fiche" }).getByRole("link");
  await expect(tabs).toHaveText(["Définition", "Versions1", "Dépendances"]);
  await expect(page.getByText("Clé")).toBeVisible();
  await expect(page.getByRole("link", { name: "Lancer une comparaison" })).toHaveCount(0);
  await page.goto("/#/w/groupe-nordis/fiche/commande?tab=scope"); // onglet absent : Définition
  await expect(page.getByRole("navigation", { name: "Onglets de la fiche" }).getByRole("link", { name: "Définition" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(await seriousViolations(page)).toEqual([]);
});

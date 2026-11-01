import { expect, test } from "@playwright/test";
import { ensureNordis, seriousViolations } from "./demo";

// Plan 0015 de bout en bout, sur l'espace de démonstration (anna.k) : exécution locale
// dans DuckDB sur les fichiers de core/tests/fixtures/compare (ATLAS_COMPARE_DATA).
// D'autres scénarios ont pu lancer des comparaisons avant : rien ne suppose un historique vide.
test.describe.configure({ mode: "serial" });

const COMPARISON = "/#/w/groupe-nordis/comparaison";

test.beforeAll(async ({ request }) => {
  await ensureNordis(request);
});

test("[S-0009-01] [S-0022-01] [S-0022-06] [S-0015-01] lancement, progression, matrice à 94 % / 6,1 % pour Revenu net × DE, ES à 75 % (critère 1 ; plan 0022)", async ({ page }) => {
  await page.goto(COMPARISON);
  await expect(page.getByRole("heading", { level: 1, name: "Comparaison" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "KPI" })).toHaveValue("revenu-net");
  const es = page.getByRole("checkbox", { name: /nordis-es/ });
  await expect(es).toBeEnabled(); // from scratch, rebranchée par ses binding (plan 0022)
  await expect(es).toBeChecked();
  await expect(page.getByRole("checkbox", { name: /nordis-de/ })).toBeChecked();
  await expect(page.getByText("Surcharge hors des points déclarés")).toBeVisible(); // avant tout lancement
  expect(await seriousViolations(page)).toEqual([]);

  await page.getByRole("button", { name: /Lancer la comparaison|Relancer/ }).click();
  await expect(page.getByRole("progressbar", { name: "Databricks · nordis-de, nordis-fr" })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Snowflake · nordis-es" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Relancer" })).toBeVisible({ timeout: 20_000 });
  await expect(page).toHaveURL(/id=\d+&variant=nordis-de/);

  const de = page.getByRole("link", { name: "Revenu net × nordis-de : 94 % de validation, écart max 6,1 %" });
  await expect(de).toBeVisible();
  await expect(de).toHaveAttribute("aria-current", "true");
  await expect(page.getByRole("link", { name: /Revenu net × nordis-fr : 100 % de validation/ })).toBeVisible();
  // La facture du 30 juin, clôturée après minuit à Madrid, compte en juillet côté ES.
  await expect(page.getByRole("link", { name: "Revenu net × nordis-es : 75 % de validation, écart max 2,9 %" })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});

test("[S-0015-02] [S-0015-06] détail : Sept. 2026 hors tolérance, le nœud divergent ouvre le diff au canonique (critères 2 et 6)", async ({ page }) => {
  await page.goto(COMPARISON);
  await page.getByRole("link", { name: /Revenu net × nordis-de : 94 %/ }).click();
  const detail = page.getByRole("region", { name: /Détail · Revenu net · nordis-de · par Mois fiscal × Entité/ });
  const september = detail.getByRole("row", { name: /Sept\. 2026 DE/ });
  await expect(september).toContainText("+6,1 % hors tolérance");
  await expect(september).toHaveClass(/is-out/);
  await expect(september.getByText("+6,1 %")).toHaveAttribute("title", /^6\.1001/);
  expect(await seriousViolations(page)).toEqual([]);

  await detail.getByRole("link", { name: "Nœud divergent : n02 · Factures validées" }).click();
  await expect(page).toHaveURL(/#\/w\/groupe-nordis\/fiche\/revenu-net--nordis-de\?diff=canonique&node=n02$/);
  await expect(page.getByText(/Nœud sélectionné : n02/)).toBeVisible();
  const variant = page.getByRole("figure", { name: /Graphe : Déclinaison nordis-de/ });
  await expect(variant.locator(".graph-card.is-selected")).toContainText("Factures validées");
  await expect(variant.locator(".graph-card.is-selected")).toBeInViewport();
  expect(await seriousViolations(page)).toEqual([]);
});

test("[S-0015-07] historique : « Tout voir », filtre par utilisateur (critère 7)", async ({ page }) => {
  await page.goto(COMPARISON);
  const strip = page.getByRole("region", { name: "Dernières comparaisons" });
  await expect(strip.getByRole("link", { name: /n° \d+ · Revenu net/ }).first()).toBeVisible();
  await strip.getByRole("link", { name: "Tout voir" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Historique des comparaisons" })).toBeVisible();
  const rows = page.getByRole("table").getByRole("row");
  await expect(rows.nth(1)).toContainText("anna.k");
  await expect(rows.nth(1)).toContainText("nordis-de 94 % · nordis-es 75 % · nordis-fr 100 %");

  await page.getByRole("combobox", { name: "Utilisateur" }).selectOption("anna.k");
  await expect(page).toHaveURL(/user=anna\.k/);
  await page.getByLabel("Depuis le").fill("2999-01-01");
  await expect(page.getByText("Aucune comparaison ne correspond à ces filtres.")).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});

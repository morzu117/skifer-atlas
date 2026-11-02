import { expect, type Page, type Request } from "@playwright/test";
import { API, ensureNordis, seriousViolations } from "./demo";
import { isolatedDemo, test } from "./isolation";

// Plan 0029 de bout en bout : nordis-es, déclinaison from scratch de Revenu net (ADR 0026),
// garde n06 du canonique telle quelle. L'aperçu le dit avant tout lancement, le détail
// d'un résultat le rappelle. Exécution locale dans DuckDB (ATLAS_COMPARE_DATA).

const MESSAGE =
  "nordis-es : n06 · Jours comptables (gold.finance.dim_date) n'a pas d'équivalent dans la déclinaison ; " +
  "la table du canonique est lue sur snowflake, des deux côtés.";
const COMMON_LINE = "Sources communes, lues sur snowflake des deux côtés : n06 · Jours comptables (gold.finance.dim_date).";

/** Le bandeau « Source commune » : ton info, donc role status (pas alert). */
function commonBanner(page: Page) {
  return page.getByRole("status").filter({ hasText: "Source commune" });
}

/** Coche exactement `wanted` parmi les déclinaisons du panneau de lancement. Si la
 * sélection change, attend l'aperçu de cette sélection-là : pendant son chargement, aucun
 * bandeau n'est affiché, et une absence de bandeau ne prouverait rien. */
async function choose(page: Page, wanted: string[]) {
  const boxes = ["nordis-de", "nordis-es", "nordis-fr"].map((entity) => ({
    box: page.getByRole("checkbox", { name: new RegExp(entity) }),
    on: wanted.includes(entity),
  }));
  const changed = (await Promise.all(boxes.map(async ({ box, on }) => (await box.isChecked()) !== on))).some(Boolean);
  if (!changed) return;
  const expected = JSON.stringify([...wanted].sort());
  const previewed = page.waitForResponse((response) => {
    if (!response.url().endsWith("/comparisons/preview") || response.request().method() !== "POST") return false;
    const variants = (response.request().postDataJSON() as { variants: string[] }).variants;
    return JSON.stringify([...variants].sort()) === expected;
  });
  for (const { box, on } of boxes) await box.setChecked(on);
  expect((await previewed).ok()).toBe(true);
}

test("[S-0029-01] L'aperçu signale la source commune de nordis-es, seule ou avec d'autres, sans rien lancer", async ({ page, request }) => {
  await ensureNordis(request);
  const launches: Request[] = [];
  page.on("request", (sent) => {
    if (sent.method() === "POST" && /\/comparisons$/.test(new URL(sent.url()).pathname)) launches.push(sent);
  });
  await page.goto("/#/w/groupe-nordis/comparaison");
  await expect(page.getByRole("combobox", { name: "KPI" })).toHaveValue("revenu-net");

  // Avec les autres déclinaisons (sélection par défaut).
  await choose(page, ["nordis-de", "nordis-es", "nordis-fr"]);
  const banner = commonBanner(page);
  await expect(banner).toHaveCount(1);
  await expect(banner).toHaveClass(/banner-info/);
  await expect(banner.getByText("Source commune", { exact: true })).toBeVisible();
  await expect(banner).toContainText(MESSAGE);
  await expect(page.getByRole("alert").filter({ hasText: "Source commune" })).toHaveCount(0);
  expect(await seriousViolations(page)).toEqual([]);

  // Sans nordis-es : plus de source commune.
  await choose(page, ["nordis-de", "nordis-fr"]);
  await expect(commonBanner(page)).toHaveCount(0);

  // nordis-es seule.
  await choose(page, ["nordis-es"]);
  await expect(commonBanner(page)).toHaveCount(1);
  await expect(commonBanner(page)).toContainText(MESSAGE);

  // nordis-es avec une seule autre déclinaison.
  await choose(page, ["nordis-de", "nordis-es"]);
  await expect(commonBanner(page)).toHaveCount(1);
  await expect(commonBanner(page)).toContainText(MESSAGE);

  // Rien n'a été lancé : aucune progression, aucun POST de lancement.
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  expect(launches.map((sent) => sent.url())).toEqual([]);
});

test("[S-0029-02] Le détail du résultat nordis-es nomme ses sources communes, lues sur snowflake des deux côtés", async ({ page, request }) => {
  // Une comparaison enregistrée modifie l'historique : espace isolé sur le serveur qui chiffre en local.
  const ws = await isolatedDemo(request, API);
  await page.goto(`${ws.root}/comparaison`);
  await expect(page.getByRole("combobox", { name: "KPI" })).toHaveValue("revenu-net");
  await choose(page, ["nordis-es"]);
  await expect(commonBanner(page)).toContainText(MESSAGE);

  await page.getByRole("button", { name: /Lancer la comparaison|Relancer/ }).click();
  await expect(page.getByRole("button", { name: "Relancer" })).toBeVisible({ timeout: 20_000 });
  const es = page.getByRole("link", { name: /Revenu net × nordis-es : 75 % de validation/ });
  await expect(es).toBeVisible();
  await es.click();
  await expect(page).toHaveURL(/id=\d+&variant=nordis-es/);

  const detail = page.getByRole("region", { name: /Détail · Revenu net · nordis-es/ });
  await expect(detail.getByText(COMMON_LINE, { exact: true })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);

  // Relue depuis le stockage : même ligne après rechargement.
  await page.reload();
  await expect(page.getByRole("region", { name: /Détail · Revenu net · nordis-es/ }).getByText(COMMON_LINE, { exact: true })).toBeVisible();
});

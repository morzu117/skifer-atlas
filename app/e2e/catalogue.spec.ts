import { expect, test, type Page } from "@playwright/test";
import { API, ensureNordis, seriousViolations } from "./demo";

// Plan 0011 de bout en bout, sur l'espace de démonstration (anna.k, contributrice).
// Les tests se suivent : le dernier lance une comparaison chiffrée.
test.describe.configure({ mode: "serial" });

const CATALOGUE = "/#/w/groupe-nordis/catalogue";

test.beforeAll(async ({ request }) => {
  await ensureNordis(request);
});

const table = (page: Page) => page.getByRole("table", { name: "Concepts et KPI" });
const row = (page: Page, name: string) => table(page).getByRole("row").filter({ has: page.getByRole("link", { name }) });

test("[S-0011-01] le tableau reprend l'index : versions et déclinaisons exactes (critère 1)", async ({ page, request }) => {
  const index = (await (await request.get(`${API}/api/workspaces/groupe-nordis/catalog`)).json()) as {
    label: string;
    kind: string;
    version: number;
    variant_count: number;
  }[];
  expect(index).toHaveLength(7);
  await page.goto(CATALOGUE);
  await expect(table(page).getByRole("row")).toHaveCount(8); // en-tête compris
  for (const doc of index) {
    const cells = row(page, doc.label).getByRole("cell");
    await expect(cells.nth(3)).toHaveText(`v${doc.version}`);
    await expect(cells.nth(4)).toHaveText(doc.kind === "kpi" ? String(doc.variant_count) : "—");
  }
  await expect(row(page, "Revenu net").getByRole("cell").nth(2)).toHaveText("Finance");
  await expect(page.getByRole("link", { name: "Nouveau concept ou KPI" })).toBeVisible(); // contributrice
  expect(await seriousViolations(page)).toEqual([]);
});

test("[S-0005-03] [S-0011-02] « CA net » trouve « Revenu net » (critère 2)", async ({ page }) => {
  await page.goto(CATALOGUE);
  await page.getByRole("searchbox", { name: "Rechercher dans le catalogue" }).fill("CA net");
  await expect(page).toHaveURL(/catalogue\?q=CA\+net$/);
  await expect(table(page).getByRole("row")).toHaveCount(2);
  await expect(table(page).getByRole("link", { name: "Revenu net" })).toBeVisible();
  await page.getByRole("searchbox").fill("zzz");
  await expect(page.getByText("Aucun concept ou KPI ne correspond")).toBeVisible();
});

test("[S-0005-04] [S-0011-03] filtres combinés, gardés dans l'adresse, retour arrière (critère 3)", async ({ page }) => {
  await page.goto(CATALOGUE);
  await expect(table(page).getByRole("row")).toHaveCount(8);
  await page.getByRole("combobox", { name: "Domaine" }).selectOption({ label: "Finance" });
  await expect(table(page).getByRole("row")).toHaveCount(4);
  await page.getByRole("combobox", { name: "Type" }).selectOption({ label: "KPI" });
  await expect(page).toHaveURL(/catalogue\?domain=finance&kind=kpi$/);
  await expect(table(page).getByRole("row")).toHaveCount(3);
  await page.goBack();
  await expect(page).toHaveURL(/catalogue\?domain=finance$/);
  await expect(page.getByRole("combobox", { name: "Type" })).toHaveValue("");
  await expect(table(page).getByRole("row")).toHaveCount(4);
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Domaine" })).toHaveValue("finance");
});

test("[S-0011-04] une ligne ouvre l'aperçu : références et points de variation (critère 4) ; clavier", async ({ page }) => {
  await page.goto(CATALOGUE);
  await row(page, "Revenu net").getByRole("cell").nth(2).click();
  const preview = page.getByRole("complementary", { name: "Revenu net" });
  await expect(preview).toBeVisible();
  await expect(preview).toContainText("Finance · v4 · propriétaire : Claire M.");
  await expect(preview).toContainText("n03 déduction des taxes");
  await expect(preview).toContainText("nordis-es (from scratch)");
  await expect(preview).toContainText(/Référencé par\s*Marge brute, Panier moyen/);
  await expect(preview).toContainText(/Dernière comparaison\s*Jamais comparé/);
  expect(await seriousViolations(page)).toEqual([]); // ligne sélectionnée comprise

  const link = table(page).getByRole("link", { name: "Revenu net" });
  await link.focus();
  await page.keyboard.press("ArrowDown");
  await expect(table(page).getByRole("link", { name: "Taux de service" })).toBeFocused();
  await expect(page.getByRole("complementary", { name: "Taux de service" })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/w\/groupe-nordis\/fiche\/taux-de-service$/);
  await page.goBack();
  await expect(page.getByRole("complementary", { name: "Taux de service" })).toBeVisible(); // sélection gardée
});

test("[S-0011-05] « + Nouveau » absent pour un lecteur (critère 5)", async ({ page }) => {
  await page.route(`${API}/api/workspaces`, async (route) => {
    const response = await route.fetch();
    const listed = (await response.json()) as { role: string; role_label: string }[];
    await route.fulfill({ response, json: listed.map((ws) => ({ ...ws, role: "lecteur", role_label: "Lecteur" })) });
  });
  await page.goto(CATALOGUE);
  await expect(table(page).getByRole("link", { name: "Revenu net" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Nouveau concept ou KPI" })).toHaveCount(0);
});

test("[S-0011-06] sous 900 px, l'aperçu passe sous le tableau (critère 6)", async ({ page }) => {
  await page.goto(`${CATALOGUE}?sel=revenu-net`);
  const preview = page.getByRole("complementary", { name: "Revenu net" });
  await expect(preview).toBeVisible();
  const beside = [await table(page).boundingBox(), await preview.boundingBox()];
  expect(beside[1]!.x).toBeGreaterThan(beside[0]!.x + beside[0]!.width - 1);

  await page.setViewportSize({ width: 880, height: 820 });
  await expect
    .poll(async () => {
      const [t, p] = [await page.locator(".table-wrap").boundingBox(), await preview.boundingBox()];
      return p!.y >= t!.y + t!.height;
    })
    .toBe(true);
});

test("[S-0011-07] « Jamais comparé », puis mis à jour après une comparaison (critère 7)", async ({ page, request }) => {
  await page.goto(CATALOGUE);
  const convergence = row(page, "Revenu net").getByRole("cell").nth(5);
  await expect(convergence).toHaveText("Jamais comparé");
  await expect(row(page, "Marge brute").getByRole("cell").nth(5)).toHaveText("Convergé"); // sans déclinaison

  const created = await request.post(`${API}/api/workspaces/groupe-nordis/comparisons`, {
    data: { kpi_id: "revenu-net", variants: ["nordis-de", "nordis-fr"], scope_id: "fy2026-mois-entite" },
  });
  expect(created.status()).toBe(202);
  const { id } = (await created.json()) as { id: number };
  await expect
    .poll(async () => ((await (await request.get(`${API}/api/workspaces/groupe-nordis/comparisons/${id}`)).json()) as { status: string }).status)
    .toBe("done");

  await page.reload();
  await expect(convergence).toHaveText("1 divergence"); // nordis-de, surcharge, à 94 %
  await row(page, "Revenu net").getByRole("cell").nth(2).click();
  await expect(page.getByRole("complementary", { name: "Revenu net" })).toContainText(
    /Dernière comparaison\s*9\d % · à l'instant/,
  );
  expect(await seriousViolations(page)).toEqual([]);
});

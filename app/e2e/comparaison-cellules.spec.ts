import { cellByColumn } from "./table";
import { expect } from "@playwright/test";
import { API } from "./demo";
import { isolatedDemo, test } from "./isolation";

// Réponse de détail contrôlée : le rendu des quatre cas limites est testé ici.
// Les calculs de tolérance eux-mêmes restent dans test_compare.py.
test("[S-0009-03] [S-0009-04] Cellules absentes et canonique nul : valeurs et tolérance explicites", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  const cells = [
    { dims: { mois_fiscal: "2026-01-01", entite: "DE" }, canonical_value: null, variant_value: 12, gap_pct: null, within_tolerance: false, missing: "canonical" },
    { dims: { mois_fiscal: "2026-02-01", entite: "DE" }, canonical_value: 12, variant_value: null, gap_pct: null, within_tolerance: false, missing: "variant" },
    { dims: { mois_fiscal: "2026-03-01", entite: "DE" }, canonical_value: 0, variant_value: 0, gap_pct: 0, within_tolerance: true, missing: null },
    { dims: { mois_fiscal: "2026-04-01", entite: "DE" }, canonical_value: 0, variant_value: 12, gap_pct: null, within_tolerance: false, missing: null },
  ];
  await page.route(`**/api/workspaces/${ws.id}/comparisons/424242`, route => route.fulfill({ json: {
    id: 424242, started_at: "2026-11-01T10:00:00Z", finished_at: "2026-11-01T10:00:01Z", user_account: "anna.k", kpi_id: "revenu-net", kpi_version: 4,
    scope: { id: "fy2026-mois-entite", granularity: ["mois_fiscal", "entite"] }, tolerance_pct: 1, status: "completed", error: null, progress: [],
    results: [{ variant_id: "revenu-net--nordis-de", entity: "nordis-de", variant_version: 3, platform: "databricks", access_point: "dbx-fr", cell_count: 4, validation_pct: 25, max_gap_pct: 0, divergent_node: null, divergent: null, bypass_nodes: [], cells }],
  } }));
  await page.goto(`${ws.root}/comparaison?id=424242&variant=nordis-de`);
  const table = page.getByRole("region", { name: /Détail · Revenu net/ }).getByRole("table");
  const rows = table.locator("tbody tr");
  await expect(rows).toHaveCount(4);
  await expect((await cellByColumn(rows.nth(0), table, "Canonique"))).toHaveText("absente");
  await expect((await cellByColumn(rows.nth(1), table, "Déclinaison nordis-de"))).toHaveText("absente");
  for (const index of [0, 1, 3]) {
    await expect(rows.nth(index)).toContainText("hors tolérance");
    await expect(rows.nth(index)).toHaveClass(/is-out/);
    await expect((await cellByColumn(rows.nth(index), table, "Écart"))).toContainText("—");
  }
  await expect(rows.nth(2)).not.toHaveClass(/is-out/);
  await expect(rows.nth(2)).not.toContainText("hors tolérance");
  await expect((await cellByColumn(rows.nth(2), table, "Canonique"))).toHaveText("0");
  await expect((await cellByColumn(rows.nth(2), table, "Déclinaison nordis-de"))).toHaveText("0");
  await expect((await cellByColumn(rows.nth(2), table, "Écart"))).toContainText("0,0 %");
  await expect((await cellByColumn(rows.nth(3), table, "Canonique"))).toHaveText("0");
  await expect((await cellByColumn(rows.nth(3), table, "Déclinaison nordis-de"))).toHaveText("12");
});

import { expect, test } from "@playwright/test";
import { API, ensureNordis } from "./demo";

// Plan 0024 : un graphe de 200 nœuds dans l'éditeur. Seules les cartes de la zone visible
// sont dessinées, et un déplacement reste fluide. Les temps mesurés sont notés dans la
// section « Mise en œuvre » du plan (annotations du rapport et sortie de la console).

const EDITOR = `${API}/api/workspaces/groupe-nordis/editor`;
const COUNT = 200;

test.beforeAll(async ({ request }) => {
  await ensureNordis(request);
});

type Raw = Record<string, unknown> & { graph: { nodes: { id: string }[] } };

/** Revenu net, réduit à sa source suivie d'une chaîne de calculs et d'une agrégation,
 * comme le graphe de 50 nœuds du plan 0013 (`_long_kpi`). */
function longKpi(document: Raw, count: number): Raw {
  const source = document.graph.nodes.find((node) => node.id === "n01")!;
  const nodes: Record<string, unknown>[] = [source];
  const id = (index: number) => `n${String(index).padStart(2, "0")}`;
  for (let index = 2; index < count; index++) {
    nodes.push({ id: id(index), type: "compute", inputs: [id(index - 1)], column: `c${index}`, expr: "montant_ttc - montant_taxes", column_type: "decimal" });
  }
  nodes.push({ id: id(count), type: "aggregate", inputs: [id(count - 1)], group_by: ["entite"], measures: [[`c${count - 1}`, "total", "sum"]] });
  const { variation_points: _, ...rest } = document;
  return { ...rest, graph: { nodes, output: id(count) } } as Raw;
}

test(`éditeur sur ${COUNT} nœuds : cartes visibles seulement, sélection et déplacement`, async ({ page, request }) => {
  test.setTimeout(60_000);
  const opened = (await (await request.get(`${EDITOR}/documents/revenu-net`)).json()) as { document: Raw; highest: number };
  const id = `graphe-${COUNT}-e2e-${Date.now().toString(36)}`;
  const document = longKpi(opened.document, COUNT);
  (document.data_product as Record<string, unknown>).id = id;
  const saved = await request.put(`${EDITOR}/documents/${id}/draft`, { data: { document, positions: {}, highest: COUNT, base_version: null } });
  expect(saved.ok()).toBe(true);

  const timings: Record<string, number> = {};
  let start = Date.now();
  await page.goto(`/#/w/groupe-nordis/editeur?from=${id}`);
  const canvas = page.getByRole("group", { name: /^Graphe de/ });
  const cards = canvas.locator("[data-node-id]");
  await expect(cards.first()).toBeVisible();
  timings.ouverture = Date.now() - start;

  const drawn = await cards.count();
  expect(drawn).toBeGreaterThan(0);
  expect(drawn).toBeLessThan(COUNT);

  // La vue d'ensemble est au zoom minimal : seules les cartes du milieu de la chaîne sont là.
  const first = (await cards.nth(0).getAttribute("data-node-id"))!;
  const second = (await cards.nth(1).getAttribute("data-node-id"))!;
  start = Date.now();
  await canvas.locator(`[data-node-id="${first}"]`).click();
  await expect(page.getByRole("complementary", { name: "Propriétés" }).getByText(first, { exact: true })).toBeVisible();
  timings.selection = Date.now() - start;

  // Déplacement à la souris, par pas : chaque pas met la position à jour.
  const card = canvas.locator(`[data-node-id="${second}"]`);
  const before = await card.boundingBox();
  start = Date.now();
  await page.mouse.move(before!.x + before!.width / 2, before!.y + 12);
  await page.mouse.down();
  await page.mouse.move(before!.x + before!.width / 2, before!.y + 12 + 48, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => (await card.boundingBox())!.y).toBeGreaterThan(before!.y + 12);
  timings.deplacement = Date.now() - start;

  for (const [name, ms] of Object.entries(timings)) test.info().annotations.push({ type: name, description: `${ms} ms` });
  console.log(`${COUNT} nœuds, ${drawn} cartes dessinées : ${Object.entries(timings).map(([n, ms]) => `${n} ${ms} ms`).join(", ")}`);
  await request.delete(`${EDITOR}/documents/${id}/draft`);
});

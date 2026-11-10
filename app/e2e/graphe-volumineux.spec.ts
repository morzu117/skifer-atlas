import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { API, ensureNordis } from "./demo";
import { longKpi, type Raw } from "./graphe";

// Plan 0024 : un graphe de 200 nœuds dans l'éditeur. Seules les cartes de la zone visible
// sont dessinées, et un déplacement reste fluide. Les temps mesurés sont notés dans la
// section « Mise en œuvre » du plan (annotations du rapport et sortie de la console).

const EDITOR = `${API}/api/workspaces/groupe-nordis/editor`;
const COUNT = 200;

test.beforeAll(async ({ request }) => {
  await ensureNordis(request);
});

test(`[S-0024-03] [S-0024-04] éditeur sur ${COUNT} nœuds : cartes visibles seulement, sélection et déplacement`, async ({ page, request }) => {
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

/** Dépose une chaîne de `count` nœuds en brouillon et ouvre l'éditeur dessus. */
async function openChain(page: Page, request: APIRequestContext, count: number) {
  const opened = (await (await request.get(`${EDITOR}/documents/revenu-net`)).json()) as { document: Raw };
  const id = `graphe-${count}-seuil-${Date.now().toString(36)}`;
  const document = longKpi(opened.document, count);
  (document.data_product as Record<string, unknown>).id = id;
  expect((await request.put(`${EDITOR}/documents/${id}/draft`, { data: { document, positions: {}, highest: count, base_version: null } })).ok()).toBe(true);
  await page.goto(`/#/w/groupe-nordis/editeur?from=${id}`);
  const canvas = page.getByRole("group", { name: /^Graphe de/ });
  await expect(canvas.locator("[data-node-id]").first()).toBeVisible();
  return { id, canvas };
}

const drawnIds = async (canvas: Locator) => (await canvas.locator("[data-node-id]").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-node-id")!))).sort();

test("[S-0024-03] jusqu'à 50 nœuds, toutes les cartes sont dessinées, même hors de l'écran", async ({ page, request }) => {
  const { id, canvas } = await openChain(page, request, 50);
  try {
    await expect(canvas.locator("[data-node-id]")).toHaveCount(50);
  } finally {
    await request.delete(`${EDITOR}/documents/${id}/draft`);
  }
});

test("[S-0024-03] au-delà de 50 nœuds, seules les cartes de la zone visible sont dessinées, et un déplacement de la vue en change la liste", async ({ page, request }) => {
  const { id, canvas } = await openChain(page, request, 120);
  try {
    const area = (await canvas.boundingBox())!;
    const before = await drawnIds(canvas);
    expect(before.length).toBeGreaterThan(0);
    expect(before.length).toBeLessThan(120);
    // Chaque carte dessinée coupe la zone visible du graphe.
    for (const node of await canvas.locator("[data-node-id]").all()) {
      const box = (await node.boundingBox())!;
      expect(box.x + box.width).toBeGreaterThan(area.x);
      expect(box.x).toBeLessThan(area.x + area.width);
      expect(box.y + box.height).toBeGreaterThan(area.y);
      expect(box.y).toBeLessThan(area.y + area.height);
    }
    // La vue glisse (bouton droit sur le fond, sans l'outil Main) : d'autres cartes entrent, d'autres sortent du dessin.
    await page.mouse.move(area.x + area.width / 2, area.y + area.height - 8);
    await page.mouse.down({ button: "right" });
    await page.mouse.move(area.x + 24, area.y + area.height - 8, { steps: 20 });
    await page.mouse.up({ button: "right" });
    await expect.poll(async () => (await drawnIds(canvas)).join()).not.toBe(before.join());
    const after = await drawnIds(canvas);
    expect(after.length).toBeLessThan(120);
    expect(after.some((n) => !before.includes(n))).toBe(true);
  } finally {
    await request.delete(`${EDITOR}/documents/${id}/draft`);
  }
});

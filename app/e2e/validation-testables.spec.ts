import { expect, type Page, type APIRequestContext } from "@playwright/test";
import { AUTH_API, CORE, isolatedDemo, python, relay, releaseSharedDemo, sharedDemo, test } from "./isolation";

// Les documents sont les fixtures de référence, les attendus ci-dessous sont fixes.
type Raw = Record<string, any>;
const fixtures = JSON.parse(python(`import sys,json
sys.path.insert(0,sys.argv[1]+'/tests/model')
from conftest import MINIMAL_NODES,read_fixture
print(json.dumps({'nodes':MINIMAL_NODES,'canonical':read_fixture('revenu-net.yaml'),'de':read_fixture('revenu-net--nordis-de.yaml'),'es':read_fixture('revenu-net--nordis-es.yaml')}))`, CORE)) as { nodes: Record<string, Raw>; canonical: Raw; de: Raw; es: Raw };
// Un seul espace isolé pour le fichier : chaque cas écrit un brouillon à identifiant unique
// et ne touche ni au dépôt ni à l'espace ; cloner un dépôt par cas coûtait plusieurs minutes.
let ws: Awaited<ReturnType<typeof isolatedDemo>>;
test.beforeAll(async ({ request }) => { ws = await sharedDemo(request, AUTH_API); });
test.afterAll(() => releaseSharedDemo(ws));
test.beforeEach(async ({ page }) => { await relay(page, AUTH_API); });
const panel = (page: Page) => page.getByRole("region", { name: "Validation du document" });
async function open(page: Page, request: APIRequestContext, ws: Awaited<ReturnType<typeof isolatedDemo>>, doc: Raw, id = `validation-${crypto.randomUUID()}`) {
  expect((await request.put(`${ws.api}/editor/documents/${id}/draft`, { data: { document: doc, positions: {}, highest: 20, base_version: null } })).ok()).toBe(true);
  await page.goto(`${ws.root}/editeur?from=${id}`);
}
async function issue(page: Page, request: APIRequestContext, ws: Awaited<ReturnType<typeof isolatedDemo>>, doc: Raw, code: string, node: string | null, message: string, path?: string) {
  const checked = await request.post(`${ws.api}/editor/check`, { data: { document: doc, node_id: null } });
  expect(checked.ok()).toBe(true);
  expect((await checked.json()).issues).toContainEqual(expect.objectContaining({ code, node_id: node, ...(path ? { path } : {}) }));
  await open(page, request, ws, doc);
  const problem = panel(page).getByRole("listitem").filter({ hasText: message }).first();
  await expect(problem).toBeVisible();
  if (node) {
    await expect(problem).toContainText(node);
    await expect(problem.getByRole("button", { name: `Aller au nœud ${node}`, exact: true })).toBeVisible();
  }
}

for (const [kind, node] of Object.entries(fixtures.nodes)) {
  for (const field of Object.keys(node)) {
    test(`[S-0001-02] ${kind} : ${field} requis, chemin et nœud du problème`, async ({ page, request }) => {
      const doc = structuredClone(fixtures.canonical);
      const incomplete = structuredClone(node); delete incomplete[field];
      doc.graph = { nodes: [incomplete], output: "n01" };
      await issue(page, request, ws, doc, "missing_field", field === "id" ? null : "n01", `Champ requis manquant : « ${field} ».`, `/graph/nodes/0/${field}`);
    });
  }
}

for (const [name, field] of [["de", "overrides"], ["es", "justification"], ["es", "concepts"]] as const) {
  test(`[S-0001-14] ${name} sans ${field} est refusée`, async ({ page, request }) => {
    const doc = structuredClone(fixtures[name]); delete doc[field];
    await issue(page, request, ws, doc, "missing_field", null, `Champ requis manquant : « ${field} ».`, `/${field}`);
    await page.getByRole("button", { name: "Soumettre la proposition" }).click({ force: true });
    await expect(page.getByRole("alert")).toContainText("Soumission bloquée");
  });
}

test("[S-0002-01] [S-0002-07] Une surcharge ne peut changer le type de n03", async ({ page, request }) => {
  const doc = structuredClone(fixtures.de);
  doc.overrides[1].replace = { id: "n03", type: "filter", inputs: ["n02"], condition: "avoirs:is_null", nulls: "keep" };
  await issue(page, request, ws, doc, "override_type_change", "n03", "type", "/overrides/1/replace/type");
});

test("[S-0002-02] Colonnes et types de chaque nœud de Revenu net", async ({ page, request }) => {
  await open(page, request, ws, fixtures.canonical);
  const factures = ["facture_id string", "entite string", "statut string", "date_facture date", "montant_ttc decimal", "montant_taxes decimal", "avoirs decimal"];
  const expected = { n01: factures, n02: factures, n03: [...factures, "montant_ht decimal"], n04: [...factures, "montant_ht decimal", "mois_fiscal date"], n05: ["mois_fiscal date", "entite string", "revenu_net decimal"] };
  for (const [id, columns] of Object.entries(expected)) {
    await page.locator(`[data-node-id="${id}"]`).click();
    await panel(page).getByRole("tab", { name: `Colonnes en sortie de ${id}`, exact: true }).click();
    await expect(panel(page).locator("tbody tr")).toHaveText(columns.map(c => c.replace(" ", "")));
  }
});

test("[S-0002-01] [S-0002-05] period refuse timestamp, puis accepte un to_date explicite", async ({ page, request }) => {
  const doc = structuredClone(fixtures.canonical);
  Object.assign(doc.graph.nodes[0].columns.find((c: Raw) => c.name === "date_facture"), { type: "timestamp", timezone: "UTC", format: "yyyy-MM-dd'T'HH:mm:ss" });
  await issue(page, request, ws, doc, "implicit_timezone_conversion", "n04", "to_date");
  doc.graph.nodes.splice(3, 0, { id: "n06", type: "temporal", inputs: ["n03"], operation: "to_date", column: "date_facture", target: "jour_facture", timezone: "Europe/Paris" });
  Object.assign(doc.graph.nodes.find((n: Raw) => n.id === "n04"), { inputs: ["n06"], column: "jour_facture" });
  delete doc.variation_points;
  await open(page, request, ws, doc);
  await expect(panel(page).getByText("Aucun problème.", { exact: true })).toBeVisible();
  await expect(panel(page)).toContainText("Compilable Databricks, Snowflake");
});

test("[S-0001-09] Le YAML désordonné devient canonique puis reste stable", async ({ page, request }) => {
  await open(page, request, ws, fixtures.canonical);
  await page.getByRole("button", { name: "Éditer en YAML" }).click();
  const editor = page.getByRole("textbox", { name: "YAML de Revenu net" });
  // JSON est du YAML valide, avec l'ordre des clés volontairement inversé.
  const unordered = JSON.stringify(Object.fromEntries(Object.entries(fixtures.canonical).reverse()));
  await editor.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText(unordered);
  await page.getByRole("button", { name: "Revenir au canevas" }).click();
  await page.getByRole("button", { name: "Éditer en YAML" }).click();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const copy = async () => {
    await editor.click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.press("ControlOrMeta+C");
    return page.evaluate(() => navigator.clipboard.readText());
  };
  const canonical = await copy();
  expect(canonical).toMatch(/^schema_version: 1\nkind: kpi\n/);
  expect(canonical).not.toBe(unordered);
  for (let n = 0; n < 2; n++) {
    await page.getByRole("button", { name: "Revenir au canevas" }).click();
    await page.getByRole("button", { name: "Éditer en YAML" }).click();
    expect(await copy()).toBe(canonical);
  }
});

const graphCases: { code: string; node: string; message: string; change: (d: Raw) => void }[] = [
  { code: "reaggregation", node: "n02", message: "Agrégation d'un flux déjà agrégé", change: d => { d.graph = { nodes: [{ id: "n01", type: "kpi_ref", kpi: "revenu-net", version: 4 }, { id: "n02", type: "aggregate", inputs: ["n01"], group_by: ["entite"], measures: [["revenu_net", "total", "sum"]] }], output: "n02" }; d.data_product.id = "revenu-annuel"; delete d.variation_points; } },
  { code: "ambiguous_column", node: "n07", message: "Colonnes présentes des deux côtés", change: d => { d.graph.nodes.push({ ...structuredClone(d.graph.nodes[0]), id: "n06" }, { id: "n07", type: "join", inputs: { left: "n01", right: "n06" }, how: "left", keys: [["entite", "entite"]], cardinality: "N:1", check: "required" }); d.graph.nodes[1].inputs = ["n07"]; } },
  { code: "cardinality_bypass", node: "n07", message: "Contrôle de cardinalité contourné : Doublons connus", change: d => { d.graph.nodes.push({ id: "n06", type: "source", platform: "databricks", table: "gold.ref.entites", owner: "claire.m", columns: [{ name: "entite", type: "string" }] }, { id: "n07", type: "join", inputs: { left: "n01", right: "n06" }, how: "left", keys: [["entite", "entite"]], cardinality: "N:1", check: "bypass", bypass_reason: "Doublons connus" }); d.graph.nodes[1].inputs = ["n07"]; } },
  { code: "unknown_input", node: "n03", message: "ne désigne aucun nœud", change: d => { d.graph.nodes[2].inputs = ["n99"]; } },
  { code: "cycle", node: "n02", message: "Le graphe contient un cycle", change: d => { d.graph.nodes[1].inputs = ["n02"]; } },
  { code: "orphan_node", node: "n09", message: "ne mène pas à la sortie", change: d => { d.graph.nodes.push({ ...d.graph.nodes[0], id: "n09" }); } },
  { code: "branch_not_merged", node: "n02", message: "ne rejoint pas les autres", change: d => { d.graph.nodes.push({ id: "n09", type: "compute", inputs: ["n02"], column: "x", expr: "avoirs * 2" }); } },
  { code: "metric_op_on_rows", node: "n09", message: "s'applique à des valeurs agrégées", change: d => { d.graph.nodes.push({ id: "n09", type: "metric_op", inputs: ["n03"], order: "aggregate_first", metrics: [{ name: "taux", expr: "montant_ht / montant_ttc" }] }); d.graph.output = "n09"; } },
  { code: "kpi_output_not_aggregated", node: "n04", message: "La sortie d'un KPI doit être agrégée", change: d => { d.graph.output = "n04"; } },
  { code: "concept_output_aggregated", node: "n05", message: "La sortie d'un concept décrit des lignes", change: d => { d.kind = "concept"; delete d.semantics; delete d.variation_points; d.entity = { key: ["entite"], attributes: [{ name: "entite", type: "string" }] }; } },
  { code: "missing_calendar", node: "n04", message: "suppose un calendrier déclaré", change: d => { d.kind = "concept"; delete d.semantics; delete d.variation_points; d.entity = { key: ["entite"], attributes: [{ name: "entite", type: "string" }] }; d.graph.output = "n04"; } },
  { code: "unknown_kpi_ref", node: "n01", message: "introuvable", change: d => { d.graph.nodes[0] = { id: "n01", type: "kpi_ref", kpi: "inexistant", version: 1 }; } },
  { code: "unknown_column", node: "n03", message: "avoir_typo", change: d => { d.graph.nodes[2].expr = "montant_ttc - avoir_typo"; } },
];
for (const c of graphCases) {
  test(`[S-0002-01] ${c.code} désigne ${c.node}`, async ({ page, request }) => {
    const doc = structuredClone(fixtures.canonical); c.change(doc);
    await issue(page, request, ws, doc, c.code, c.node, c.message);
  });
}

test("[S-0002-11] [S-0002-01] Références circulaires Revenu net et Marge brute", async ({ page, request }) => {
  const doc = structuredClone(fixtures.canonical);
  doc.graph = { nodes: [{ id: "n01", type: "kpi_ref", kpi: "marge-brute", version: 2 }], output: "n01" };
  delete doc.variation_points;
  await issue(page, request, ws, doc, "kpi_ref_cycle", "n01", "revenu-net v4 → marge-brute v2 → revenu-net v4");
});

const schemaCases: { code: string; node: string | null; message: string; change: (d: Raw) => void }[] = [
  { code: "unknown_key", node: "n03", message: "Clé « inconnue »", change: d => { d.graph.nodes[2].inconnue = true; } },
  { code: "unknown_node_type", node: "n03", message: "Type de nœud inconnu « pivot »", change: d => { d.graph.nodes[2].type = "pivot"; } },
  { code: "unknown_schema_version", node: null, message: "2", change: d => { d.schema_version = 2; } },
  { code: "missing_field", node: "n02", message: "Champ requis manquant : « nulls »", change: d => { delete d.graph.nodes[1].nulls; } },
  { code: "forbidden_function", node: "n03", message: "ROUND", change: d => { d.graph.nodes[2].expr = "ROUND(montant_ttc, 2)"; } },
  { code: "duplicate_node_id", node: "n03", message: "n03", change: d => { d.graph.nodes.push(structuredClone(d.graph.nodes[2])); } },
  { code: "invalid_value", node: "n02", message: "nulls", change: d => { d.graph.nodes[1].nulls = "invalide"; } },
  { code: "todo", node: "n01", message: "Valeur à compléter", change: d => { d.graph.nodes[0].table = "TODO"; } },
  { code: "needs_curation", node: null, message: "Brouillon à reprendre", change: d => { d.status = "needs_curation"; } },
  { code: "blocking_residue", node: null, message: "Résidu bloquant « test_residue »", change: d => { d.status = "draft"; d.extraction = { source_file: "test.sql", dialect: "databricks", sql_sha256: "a".repeat(64), residues: [{ code: "test_residue", message: "À traiter", blocking: true }] }; } },
];
for (const c of schemaCases) {
  test(`[S-0002-01] Schéma : ${c.code} et nœud attendu`, async ({ page, request }) => {
    const doc = structuredClone(fixtures.canonical); c.change(doc);
    await issue(page, request, ws, doc, c.code, c.node, c.message);
  });
}

for (const c of [
  { code: "unknown_override_target", node: "n09", message: "n09", change: (d: Raw) => { d.overrides[1].node = "n09"; d.overrides[1].replace.id = "n09"; } },
  { code: "undeclared_override", node: "n02", message: "n02", change: (_d: Raw) => {} },
]) {
  test(`[S-0002-01] Résolution : ${c.code} et nœud attendu`, async ({ page, request }) => {
    const doc = structuredClone(fixtures.de); c.change(doc);
    await issue(page, request, ws, doc, c.code, c.node, c.message);
  });
}
test("[S-0002-01] Un concept déclaré non relié est signalé", async ({ page, request }) => {
  const doc = structuredClone(fixtures.es); doc.concepts.push("client");
  await issue(page, request, ws, doc, "unbound_concept", null, "client");
});

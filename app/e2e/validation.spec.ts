import { expect, test } from "@playwright/test";
import { API, ensureNordis } from "./demo";

type Node = Record<string, unknown> & { id: string; type: string };
type Document = { schema_version: number; data_product: { id: string }; graph: { nodes: Node[]; output: string }; [key: string]: unknown };
const node = (doc: Document, id: string) => doc.graph.nodes.find(n => n.id === id)!;
const cases: { ids: string; title: string; changes: ((doc: Document) => void)[]; codes: string[]; shows?: string }[] = [
  { ids: "[S-0001-03]", title: "Une clé inconnue est expliquée dans les problèmes", changes: [d => { d.inconnue = true; }, d => { node(d, "n03").inconnue = true; }], codes: ["unknown_key"] },
  { ids: "[S-0001-04]", title: "Un type de nœud inconnu est refusé", changes: [d => { node(d, "n03").type = "pivot"; }], codes: ["unknown_node_type"] },
  { ids: "[S-0001-04]", title: "Une version de schéma inconnue est refusée", changes: [d => { d.schema_version = 2; }], codes: ["unknown_schema_version"] },
  { ids: "[S-0001-05]", title: "Nulls, cardinalité et raison du bypass sont obligatoires", changes: [d => { delete node(d, "n02").nulls; }, d => { delete node(d, "n07").cardinality; }, d => { node(d, "n07").check = "bypass"; }], codes: ["missing_field"] },
  { ids: "[S-0001-06] [S-0002-04]", title: "Arrondis, NOW et agrégations first et last sont refusés", changes: [d => { node(d, "n03").expr = "ROUND(montant_ttc, 2)"; }, d => { node(d, "n03").expr = "NOW()"; }, ...["first", "last"].map(fn => (d: Document) => { node(d, "n05").measures = [["montant_ht", "revenu_net", fn]]; })], codes: ["forbidden_function"] },
  { ids: "[S-0001-07]", title: "Une date horodatée exige son fuseau", changes: [d => { const columns = node(d, "n01").columns as Record<string, unknown>[]; const c = columns.find(c => c.name === "date_facture")!; c.type = "timestamp"; delete c.timezone; }], codes: ["missing_field"] },
  { ids: "[S-0001-08]", title: "Un identifiant de nœud dupliqué est signalé", changes: [d => { d.graph.nodes.push(structuredClone(node(d, "n03"))); }], codes: ["duplicate_node_id"] },
  { ids: "[S-0002-03]", title: "Une clé de jointure inconnue propose la colonne proche", changes: [d => { node(d, "n07").keys = [["date_factur", "date_jour"]]; }], codes: ["unknown_column"], shows: "date_facture" },
];

for (const scenario of cases) {
  test(`${scenario.ids} ${scenario.title}`, async ({ page, request }) => {
    await ensureNordis(request);
    const editor = `${API}/api/workspaces/groupe-nordis/editor`;
    for (const [index, change] of scenario.changes.entries()) {
      const { document } = await (await request.get(`${editor}/documents/revenu-net`)).json() as { document: Document };
      const id = `validation-${Date.now().toString(36)}-${index}`;
      document.data_product.id = id;
      change(document);
      const checked = await (await request.post(`${editor}/check`, { data: { document, node_id: null } })).json() as { issues: { code: string; message: string }[] };
      const code = scenario.codes.length > 1 ? scenario.codes[index] : scenario.codes[0];
      const issue = checked.issues.find(i => i.code === code);
      expect(issue, `${scenario.title} : ${JSON.stringify(checked.issues)}`).toBeDefined();
      expect((await request.put(`${editor}/documents/${id}/draft`, { data: { document, positions: {}, highest: 7, base_version: null } })).ok()).toBe(true);
      try {
        await page.goto(`/#/w/groupe-nordis/editeur?from=${id}`);
        const panel = page.getByRole("region", { name: "Validation du document" });
        await expect(panel.getByText(issue!.message, { exact: true }).first()).toBeVisible();
        if (scenario.shows) await expect(panel).toContainText(scenario.shows); // attendu fixé ici, pas relu au serveur
        await page.getByRole("button", { name: "Soumettre la proposition" }).click({ force: true });
        await expect(page.getByRole("alert")).toContainText("Soumission bloquée");
      } finally {
        await page.goto("/");
        await request.delete(`${editor}/documents/${id}/draft`);
      }
    }
  });
}

test("[S-0001-01] Les quatre documents de référence affichent un schéma valide", async ({ page, request }) => {
  await ensureNordis(request);
  for (const id of ["revenu-net", "revenu-net--nordis-de", "revenu-net--nordis-es", "commande"]) {
    await page.goto(`/#/w/groupe-nordis/editeur?from=${id}`);
    await expect(page.getByRole("region", { name: "Validation du document" }).getByText("Schéma valide", { exact: true })).toBeVisible();
  }
});

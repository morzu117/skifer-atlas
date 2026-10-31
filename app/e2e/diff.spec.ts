import { expect, test } from "@playwright/test";
import { AUTH_API, CORE, git, isolatedDemo, python, relay } from "./isolation";

// Chaque scénario a son dépôt, joint au serveur de julien.h (8793) et non au serveur
// principal : le registre de celui-ci ne garde qu'un seul « Groupe Nordis » pour les
// autres fichiers (hors-ligne, connexions, parcours WebKit).
test.beforeEach(async ({ page }) => { await relay(page, AUTH_API); });

const cases = [
  { id: "S-0003-01", title: "Permuter des filtres ne produit aucun écart", setup: "base=with_filters(CONDITIONS); other=with_filters(CONDITIONS[::-1])", text: "Aucun écart : les deux graphes sont identiques." },
  { id: "S-0003-03", title: "Passer de sum à avg est critique", setup: "base=revenu_net(); other=revenu_net(); nodes(other)['n05']['measures'][0][2]='avg'", text: "Divergence critique" },
  { id: "S-0003-04", title: "Contourner une cardinalité est critique", setup: "base=with_join(revenu_net()); other=with_join(revenu_net(),check='bypass',bypass_reason='Doublons connus.')", text: "Divergence critique" },
  { id: "S-0003-05", title: "Renommer un libellé est sans effet", setup: "base=revenu_net(); other=revenu_net(); nodes(other)['n03']['label']='Montant hors taxes'", text: "Sans effet" },
  { id: "S-0003-06", title: "Inverser jointure et dédoublonnage est critique", setup: "base=_join_then_dedup(False); other=_join_then_dedup(True)", text: "Ordre inversé" },
  { id: "S-0003-08", title: "Deux expressions non équivalentes restent à examiner", setup: "base=revenu_net(); other=revenu_net(); nodes(other)['n03']['expr']='montant_ttc * 0.8 - avoirs'", text: "À examiner" },
];
for (const scenario of cases) {
  test(`[${scenario.id}] ${scenario.title}`, async ({ page, request }) => {
    test.setTimeout(60_000);
    const ws = await isolatedDemo(request, AUTH_API);
    const id = `diff-${Date.now().toString(36)}`;
    const pair = JSON.parse(python(`import sys,json
sys.path.insert(0,sys.argv[1]+'/tests/model')
from graphs import revenu_net,nodes,with_join,with_filters,CONDITIONS
from test_diff import _join_then_dedup
${scenario.setup}
print(json.dumps([base,other]))`, CORE)) as { data_product: { id: string; version: number } }[];
    for (const [i, doc] of pair.entries()) {
      doc.data_product.id = id;
      doc.data_product.version = i + 1;
      python("import sys,yaml,json; from pathlib import Path; (Path(sys.argv[1])/'kpis'/sys.argv[2]).write_text(yaml.safe_dump(json.loads(sys.argv[3]),allow_unicode=True,sort_keys=False))", ws.work, `${id}.yaml`, JSON.stringify(doc));
      git(ws.work, "add", ".");
      git(ws.work, "commit", "-qm", `Version ${i + 1} du scénario`);
      git(ws.work, "tag", `doc/${id}/v${i + 1}`);
    }
    git(ws.work, "push", "origin", "main", "--tags");
    expect((await request.post(`${ws.api}/sync`)).ok()).toBe(true);
    await page.goto(`${ws.root}/fiche/${id}?tab=versions&base=1&other=2`);
    await expect(page.getByText(scenario.text, { exact: scenario.id !== "S-0003-06" }).first()).toBeVisible();
    if (scenario.id === "S-0003-01") await expect(page.locator(".diff-item")).toHaveCount(0);
    else await expect(page.locator(".diff-item")).toHaveCount(1);
  });
}

test("[S-0003-07] Une déclinaison from scratch affiche ses écarts et leur gravité", async ({ page, request }) => {
  const ws = await isolatedDemo(request, AUTH_API);
  await page.goto(`${ws.root}/fiche/revenu-net--nordis-es?diff=canonique`);
  const items = page.locator(".diff-item");
  await expect(items.first()).toBeVisible();
  for (const item of await items.all()) await expect(item).toContainText("From scratch");
  await expect(items.filter({ has: page.locator(".tone-bad") }).first()).toBeVisible();
});

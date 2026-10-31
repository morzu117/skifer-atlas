import { expect, test } from "@playwright/test";
import { CORE, python } from "./isolation";
import { API, ensureNordis } from "./demo";
import { longKpi, type Raw } from "./graphe";

// Les résultats numériques restent vérifiés par pytest ; ici les expressions SQL et
// les gardes sont réellement rendues par le serveur dans le panneau de l'éditeur.
test("[S-0007-01] [S-0007-02] [S-0021-06] SQL multi-dialecte et garde indépendante", async ({ page, request }) => {
  await ensureNordis(request);
  await page.goto("/#/w/groupe-nordis/editeur?from=revenu-net");
  const panel = page.getByRole("region", { name: "Validation du document" });
  await panel.getByRole("tab", { name: "SQL compilé" }).click();
  for (const dialect of ["Databricks", "Snowflake"]) {
    await panel.getByRole("radio", { name: dialect }).check();
    const sql = panel.getByLabel(`SQL ${dialect.toLowerCase()}`);
    await expect(sql).toContainText("atlas_guard");
    await expect(sql).toContainText("UNION ALL");
    await expect(sql).toContainText("n07");
  }
});

test("[S-0021-02] [S-0021-03] [S-0021-04] Division : DOUBLE et NULLIF visibles dans le SQL", async ({ page, request }) => {
  await ensureNordis(request);
  const editor = `${API}/api/workspaces/groupe-nordis/editor`;
  const opened = await (await request.get(`${editor}/documents/revenu-net`)).json() as { document: Raw };
  const doc = longKpi(opened.document, 3);
  const id = `division-${Date.now().toString(36)}`;
  (doc.data_product as Record<string, unknown>).id = id;
  const nodes = doc.graph.nodes as (Record<string, unknown> & { id: string })[];
  nodes[0] = { id: "n01", type: "source", platform: "databricks", table: "gold.finance.mesures", owner: "claire.m", columns: [{ name: "entite", type: "string" }, { name: "a", type: "integer" }, { name: "b", type: "integer" }] };
  nodes[1].expr = "a / NULLIF(b, 0)";
  delete nodes[1].column_type;
  expect((await request.put(`${editor}/documents/${id}/draft`, { data: { document: doc, positions: {}, highest: 3, base_version: null } })).ok()).toBe(true);
  try {
    await page.goto(`/#/w/groupe-nordis/editeur?from=${id}`);
    const panel = page.getByRole("region", { name: "Validation du document" });
    await page.locator('[data-node-id="n02"]').click();
    await panel.getByRole("tab", { name: "Colonnes en sortie" }).click();
    await expect(panel.getByRole("row").filter({ hasText: "c2" })).toContainText("double");
    await panel.getByRole("tab", { name: "SQL compilé" }).click();
    for (const dialect of ["Databricks", "Snowflake"]) {
      await panel.getByRole("radio", { name: dialect }).check();
      await expect(panel.getByLabel(`SQL ${dialect.toLowerCase()}`)).toContainText("CAST(a AS DOUBLE) / NULLIF(b, 0)");
      await expect(panel.getByLabel(`SQL ${dialect.toLowerCase()}`)).not.toContainText("NULLIF(NULLIF");
    }
  } finally {
    await page.goto("/");
    await request.delete(`${editor}/documents/${id}/draft`);
  }
});

test("[S-0007-07] TRY_CAST numérique nomme le nœud non compilable en Snowflake", async ({ page, request }) => {
  await ensureNordis(request);
  const editor = `${API}/api/workspaces/groupe-nordis/editor`;
  const opened = await (await request.get(`${editor}/documents/revenu-net`)).json() as { document: Raw };
  const doc = longKpi(opened.document, 3);
  const id = `try-cast-${Date.now().toString(36)}`;
  (doc.data_product as Record<string, unknown>).id = id;
  (doc.graph.nodes[1] as Record<string, unknown>).expr = "TRY_CAST(montant_ttc AS DOUBLE)";
  expect((await request.put(`${editor}/documents/${id}/draft`, { data: { document: doc, positions: {}, highest: 3, base_version: null } })).ok()).toBe(true);
  try {
    await page.goto(`/#/w/groupe-nordis/editeur?from=${id}`);
    const panel = page.getByRole("region", { name: "Validation du document" });
    await panel.getByRole("tab", { name: "SQL compilé" }).click();
    await panel.getByRole("radio", { name: "Snowflake" }).check();
    await expect(panel).toContainText("Non compilable (n02)");
    await expect(panel).toContainText("TRY_CAST");
  } finally {
    await page.goto("/");
    await request.delete(`${editor}/documents/${id}/draft`);
  }
});


test("[S-0021-05] La semaine Snowflake ne dépend pas de WEEK_START", async ({ page, request }) => {
  await ensureNordis(request);
  const editor = `${API}/api/workspaces/groupe-nordis/editor`;
  const doc = JSON.parse(python("import sys,json; sys.path.insert(0,sys.argv[1]+'/tests/compile'); from test_ecarts import weekly; print(json.dumps(weekly().model_dump(mode='json',exclude_none=True)))", CORE)) as Raw;
  const id = `semaine-${Date.now().toString(36)}`;
  (doc.data_product as Record<string, unknown>).id = id;
  expect((await request.put(`${editor}/documents/${id}/draft`, { data: { document: doc, positions: {}, highest: 3, base_version: null } })).ok()).toBe(true);
  try {
    await page.goto(`/#/w/groupe-nordis/editeur?from=${id}`);
    const panel = page.getByRole("region", { name: "Validation du document" });
    await panel.getByRole("tab", { name: "SQL compilé" }).click();
    await panel.getByRole("radio", { name: "Snowflake" }).check();
    await expect(panel.getByLabel("SQL snowflake")).toContainText("DAYOFWEEKISO");
    await expect(panel.getByLabel("SQL snowflake")).not.toContainText("DATE_TRUNC('WEEK'");
  } finally {
    await page.goto("/");
    await request.delete(`${editor}/documents/${id}/draft`);
  }
});

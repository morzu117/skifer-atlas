import { expect } from "@playwright/test";
import { CORE, python, test } from "./isolation";
import { API, ensureNordis } from "./demo";
import type { Raw } from "./graphe";

// Plans 0030 et 0031 : le SQL est réellement compilé par le serveur et lu dans le panneau
// de l'éditeur ; son exécution reste vérifiée par pytest (core/tests/compile/test_ecarts.py).

/** Le KPI `fuseau` de test_ecarts.py, colonne `passee_le` déclarée à Paris, avec un filtre
 * sur un littéral d'horodatage avant le jour local. */
const DOCUMENT = `import sys,json,yaml
sys.path.insert(0,sys.argv[1]+'/tests/compile')
from test_ecarts import orders, FUSEAU
nodes=yaml.safe_load((FUSEAU/'kpi.yaml').read_text(encoding='utf-8'))['graph']['nodes'][1:]
nodes[0]['inputs']=['n05']
filtre={'id':'n05','type':'filter','inputs':['n01'],'nulls':'drop','condition':'passee_le:greater_than:2025-01-01 00:00:00'}
print(json.dumps(orders('Europe/Paris',after=[filtre,*nodes]).model_dump(mode='json',exclude_none=True)))`;

/** La mise en page coupe les lignes selon leur longueur : on compare le SQL sur une ligne. */
const flatten = (sql: string) => sql.split(/\s+/).join(" ").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")");

test("[S-0030-01] [S-0030-02] [S-0030-04] [S-0031-01] [S-0031-04] Horodatage d'une source lu en heure murale de son fuseau dans le panneau SQL", async ({ page, request }) => {
  await ensureNordis(request);
  const editor = `${API}/api/workspaces/groupe-nordis/editor`;
  const doc = JSON.parse(python(DOCUMENT, CORE)) as Raw;
  const id = `fuseau-${Date.now().toString(36)}`;
  (doc.data_product as Record<string, unknown>).id = id;
  expect((await request.put(`${editor}/documents/${id}/draft`, { data: { document: doc, positions: {}, highest: 5, base_version: null } })).ok()).toBe(true);
  try {
    await page.goto(`/#/w/groupe-nordis/editeur?from=${id}`);
    const panel = page.getByRole("region", { name: "Validation du document" });
    await panel.getByRole("tab", { name: "SQL compilé" }).click();

    // Databricks : instant ou heure murale, la colonne est lue dans son fuseau déclaré.
    await panel.getByRole("radio", { name: "Databricks" }).check();
    const databricks = panel.getByLabel("SQL databricks");
    await expect(databricks).toContainText(id);
    const dbx = (await databricks.textContent())!;
    expect(flatten(dbx)).toContain(
      "CASE WHEN TYPEOF(passee_le) = 'timestamp' THEN CONVERT_TIMEZONE('UTC', 'Europe/Paris', " +
        "DATE_ADD(MICROSECOND, UNIX_MICROS(CAST(passee_le AS TIMESTAMP)), CAST('1970-01-01 00:00:00' AS TIMESTAMP_NTZ))) " +
        "ELSE CAST(passee_le AS TIMESTAMP_NTZ) END AS passee_le",
    );
    expect(dbx).toContain("passee_le > CAST('2025-01-01 00:00:00' AS TIMESTAMP_NTZ)");
    // Seule exception, quelle que soit la colonne : le cast d'un instant vers lui-même.
    expect(dbx.replace(/UNIX_MICROS\(CAST\(\w+ AS TIMESTAMP\)\)/g, "")).not.toContain("AS TIMESTAMP)");

    // Snowflake : un instant (TIMESTAMP_LTZ ou TIMESTAMP_TZ) passe dans le fuseau déclaré puis
    // perd son décalage ; une heure murale reste telle quelle. Aucun cast ne dépend de
    // TIMESTAMP_TYPE_MAPPING.
    await panel.getByRole("radio", { name: "Snowflake" }).check();
    const snowflake = panel.getByLabel("SQL snowflake");
    await expect(snowflake).toContainText(id);
    const snow = (await snowflake.textContent())!;
    expect(flatten(snow)).toContain(
      "CASE WHEN TYPEOF(CAST(passee_le AS VARIANT)) IN ('TIMESTAMP_LTZ', 'TIMESTAMP_TZ') " +
        "THEN CAST(CONVERT_TIMEZONE('Europe/Paris', CAST(passee_le AS TIMESTAMPTZ)) AS TIMESTAMPNTZ) " +
        "ELSE CAST(passee_le AS TIMESTAMPNTZ) END AS passee_le",
    );
    expect(snow).toContain("passee_le > CAST('2025-01-01 00:00:00' AS TIMESTAMPNTZ)");
    expect(snow).not.toContain("AS TIMESTAMP)");
  } finally {
    await page.goto("/");
    await request.delete(`${editor}/documents/${id}/draft`);
  }
});

test("[S-0030-01] [S-0031-01] Fuseau UTC : Databricks s'arrête à l'heure UTC, Snowflake garde CONVERT_TIMEZONE", async ({ page, request }) => {
  await ensureNordis(request);
  const editor = `${API}/api/workspaces/groupe-nordis/editor`;
  const doc = JSON.parse(python(
    "import sys,json; sys.path.insert(0,sys.argv[1]+'/tests/compile'); from test_ecarts import orders; print(json.dumps(orders().model_dump(mode='json',exclude_none=True)))", CORE)) as Raw;
  const id = `fuseau-utc-${Date.now().toString(36)}`;
  (doc.data_product as Record<string, unknown>).id = id;
  expect((await request.put(`${editor}/documents/${id}/draft`, { data: { document: doc, positions: {}, highest: 5, base_version: null } })).ok()).toBe(true);
  try {
    await page.goto(`/#/w/groupe-nordis/editeur?from=${id}`);
    const panel = page.getByRole("region", { name: "Validation du document" });
    await panel.getByRole("tab", { name: "SQL compilé" }).click();
    await panel.getByRole("radio", { name: "Databricks" }).check();
    await expect(panel.getByLabel("SQL databricks")).toContainText(id);
    const dbx = flatten((await panel.getByLabel("SQL databricks").textContent())!);
    expect(dbx).toContain(
      "THEN DATE_ADD(MICROSECOND, UNIX_MICROS(CAST(passee_le AS TIMESTAMP)), CAST('1970-01-01 00:00:00' AS TIMESTAMP_NTZ)) ELSE",
    );
    expect(dbx).not.toContain("CONVERT_TIMEZONE('UTC', 'UTC'");
    await panel.getByRole("radio", { name: "Snowflake" }).check();
    await expect(panel.getByLabel("SQL snowflake")).toContainText(id);
    const snow = flatten((await panel.getByLabel("SQL snowflake").textContent())!);
    expect(snow).toContain("THEN CAST(CONVERT_TIMEZONE('UTC', CAST(passee_le AS TIMESTAMPTZ)) AS TIMESTAMPNTZ)");
  } finally {
    await page.goto("/");
    await request.delete(`${editor}/documents/${id}/draft`);
  }
});

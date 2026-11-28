import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { PASS_THRESHOLD, WARN_THRESHOLD, tone } from "../src/thresholds";
import { API, seriousViolations } from "./demo";
import { AUTH_API, CORE, isolatedDemo, python, relay, test } from "./isolation";

// Plan 0015, « Reste à faire » : une comparaison réelle sur Databricks depuis l'écran (#31,
// #112, ADR 0075). Hors CI : sans ATLAS_DATABRICKS_HOST, ATLAS_DATABRICKS_WAREHOUSE et
// ATLAS_DATABRICKS_TOKEN (les variables de la sonde core/tests/test_databricks_real.py), le
// fichier est sauté. Avec elles, il crée des objets dans le workspace, et les retire.
//
// Le serveur 8793 (AUTH_API) n'a pas d'ATLAS_COMPARE_DATA : la comparaison part vraiment sur le
// point d'accès dbx-fr, repointé dans l'espace isolé sur l'hôte et le warehouse de
// l'environnement. Les données de nordis-fr sont chargées dans les tables exactes que lisent
// les documents (gold.finance.fact_facturation, gold.finance.dim_date) par
// core/tests/databricks_recette.py. L'oracle est la même comparaison en DuckDB local, sur les
// mêmes fichiers (serveur 8799, ATLAS_COMPARE_DATA).

const HOST = process.env.ATLAS_DATABRICKS_HOST ?? "";
const WAREHOUSE = process.env.ATLAS_DATABRICKS_WAREHOUSE ?? "";
const TOKEN = process.env.ATLAS_DATABRICKS_TOKEN ?? "";
const REAL = Boolean(HOST && WAREHOUSE && TOKEN);
const ORIGIN = REAL ? new URL(HOST.includes("://") ? HOST : `https://${HOST}`).origin : "";
const RECETTE = join(CORE, "tests", "databricks_recette.py");

test.skip(!REAL, "Comparaison Databricks réelle : ATLAS_DATABRICKS_HOST, ATLAS_DATABRICKS_WAREHOUSE et ATLAS_DATABRICKS_TOKEN sont requis");

/** Revenu net × nordis-fr en DuckDB local (core/tests/fixtures/compare/revenu-net/nordis-fr,
 * scope fy2026-mois-entite, tolérance 1,5 % du KPI) : huit mois, canonique et déclinaison
 * égaux (la TVA française de 20 % donne les mêmes montants hors taxes), donc 100 % et 0,0 %. */
const ORACLE = {
  validation: 100,
  tolerance: "1,5 %",
  cells: [
    ["Févr. 2026", 5163000],
    ["Mars 2026", 5184500],
    ["Avr. 2026", 5206000],
    ["Mai 2026", 5227500],
    ["Juin 2026", 5249000],
    ["Juil. 2026", 5270500],
    ["Août 2026", 5292000],
    ["Sept. 2026", 5313500],
  ] as const,
};
// La couleur attendue découle des seuils nommés de l'écran (plan 0015), pas d'un littéral.
const TOKENS = { pass: "--atlas-pale", warn: "--atlas-warn-cell", bad: "--atlas-bad-cell" } as const;

type Cell = { dims: Record<string, unknown>; canonical_value: number | null; variant_value: number | null; gap_pct: number | null; within_tolerance: boolean };
type Result = { entity: string; cell_count: number; validation_pct: number | null; max_gap_pct: number | null; cells: Cell[] };
type Run = { status: string; error: unknown; tolerance_pct: number; results: Result[]; runs: { side: string; platform: string; access_point: string | null; status: string }[] };

const launchButton = (page: Page) => page.getByRole("button", { name: /Lancer la comparaison|Relancer/ });
const connection = (page: Page) => page.getByRole("row").filter({ hasText: "gold.finance" });

function recette(action: "load" | "drop", state: string) {
  // Le jeton passe par l'environnement hérité, jamais par la ligne de commande.
  execFileSync("uv", ["run", "--project", CORE, "python", RECETTE, action, state], { stdio: ["ignore", "inherit", "inherit"], timeout: 10 * 60_000 });
}

/** Ce qui se compare d'une exécution à l'autre : les cellules et leur synthèse. */
function outcome(run: Run) {
  return run.results.map(({ entity, cell_count, validation_pct, max_gap_pct, cells }) => ({
    entity, cell_count, validation_pct, max_gap_pct,
    cells: cells.map(({ dims, canonical_value, variant_value, gap_pct, within_tolerance }) => ({ dims, canonical_value, variant_value, gap_pct, within_tolerance })),
  }));
}

async function finished(request: APIRequestContext, api: string, id: number): Promise<Run> {
  let run: Run | undefined;
  await expect.poll(async () => {
    run = (await (await request.get(`${api}/comparisons/${id}`)).json()) as Run;
    return run.status;
  }, { timeout: 60_000 }).not.toBe("running");
  return run!;
}

/** L'oracle : nordis-fr seule, en DuckDB local sur le serveur principal (ATLAS_COMPARE_DATA). */
async function oracle(request: APIRequestContext): Promise<Run> {
  const ws = await isolatedDemo(request, API);
  const started = await request.post(`${ws.api}/comparisons`, { data: { kpi_id: "revenu-net", variants: ["nordis-fr"], scope_id: "fy2026-mois-entite" } });
  expect(started.status(), await started.text()).toBe(202);
  const run = await finished(request, ws.api, ((await started.json()) as { id: number }).id);
  expect(run.status).toBe("done");
  return run;
}

/** dbx-fr sur l'hôte et le warehouse réels, dans le clone de l'espace isolé, avant sa
 * publication : aucune valeur réelle n'est écrite dans le dépôt Atlas. */
function repoint(work: string) {
  python(`import sys,yaml
from pathlib import Path
p=Path(sys.argv[1])/'access_points.yaml'
d=yaml.safe_load(p.read_text(encoding='utf-8'))
[point]=[a for a in d['access_points'] if a['id']=='dbx-fr']
point['host']=sys.argv[2]
point['warehouse_id']=sys.argv[3]
point.pop('http_path',None)
p.write_text(yaml.safe_dump(d,allow_unicode=True,sort_keys=False),encoding='utf-8')`, work, ORIGIN, WAREHOUSE);
}

/** Refus de l'autorisation dans la fenêtre du navigateur : la page de connexion du vrai
 * Databricks n'est jamais chargée, son retour porte `access_denied` comme un consentement
 * refusé. C'est le chemin documenté vers le repli par token personnel (plan 0008, ADR 0020). */
async function refuseAuthorization(page: Page) {
  await page.context().route((url) => url.origin === ORIGIN, async (route) => {
    const asked = new URL(route.request().url());
    const back = asked.searchParams.get("redirect_uri");
    const state = asked.searchParams.get("state");
    if (!back || !state) return route.abort();
    const target = new URL(back);
    target.searchParams.set("error", "access_denied");
    target.searchParams.set("error_description", "Autorisation refusée dans le navigateur.");
    target.searchParams.set("state", state);
    await route.fulfill({ status: 302, headers: { location: target.toString() } });
  });
}

let stateDir: string | undefined;

test.beforeAll(async () => {
  if (!REAL) return;
  test.setTimeout(10 * 60_000); // warehouse serverless à démarrer
  stateDir = mkdtempSync(join(tmpdir(), "atlas-recette-dbx-"));
  const state = join(stateDir, "etat.json");
  console.log(`État de la recette Databricks : ${state}`);
  recette("load", state);
});

// Même après un échec du chargement : l'état note chaque objet avant sa création.
test.afterAll(async () => {
  if (!stateDir) return;
  test.setTimeout(10 * 60_000);
  const state = join(stateDir, "etat.json");
  try {
    recette("drop", state);
  } catch (error) {
    console.error(`Nettoyage Databricks incomplet : relancer « uv run python tests/databricks_recette.py drop ${state} » depuis core/.`);
    throw error;
  }
  rmSync(stateDir, { recursive: true, force: true });
});

test("Comparaison réelle sur Databricks : jeton personnel, nordis-fr seule, mêmes résultats qu'en DuckDB local", async ({ page, request }) => {
  test.setTimeout(10 * 60_000);
  const expected = await oracle(request);
  // L'oracle lui-même : les chiffres ci-dessus sont bien ceux du calcul DuckDB local.
  const [local] = outcome(expected);
  expect(local).toMatchObject({ entity: "nordis-fr", cell_count: ORACLE.cells.length, validation_pct: ORACLE.validation, max_gap_pct: 0 });
  expect(local.cells.map((c) => [c.canonical_value, c.variant_value, c.gap_pct])).toEqual(ORACLE.cells.map(([, value]) => [value, value, 0]));

  const ws = await isolatedDemo(request, AUTH_API, repoint);
  await relay(page, AUTH_API);

  // Mes connexions : l'OAuth refusé ouvre le repli, le token va au coffre, « Tester » passe.
  await refuseAuthorization(page);
  page.on("popup", (popup) => { void popup.waitForLoadState().then(() => popup.close()).catch(() => undefined); });
  await page.goto(`${ws.root}/connexions`);
  const row = connection(page);
  await expect(row).toContainText("Jamais connecté");
  await row.getByRole("button", { name: "Se connecter à Databricks · dbx-fr" }).click();
  await expect(row.getByRole("alert")).toContainText(/Connexion échouée|OAuth indisponible/, { timeout: 60_000 });
  await row.getByRole("button", { name: "Utiliser un token personnel" }).click();
  const input = page.getByLabel("Token personnel Databricks");
  await expect(input).toHaveAttribute("type", "password");
  await input.fill(TOKEN);
  await page.getByRole("button", { name: "Ranger dans le coffre" }).click();
  await expect(row.getByRole("cell", { name: /^Connecté\s*·\s*token personnel$/ })).toBeVisible();
  await row.getByRole("button", { name: "Tester Databricks · dbx-fr" }).click();
  // Le message n'apparaît qu'avec la réponse du warehouse : attendre, puis lire son verdict.
  const tested = row.getByRole("status");
  await expect(tested).toBeVisible({ timeout: 120_000 });
  await expect(tested).toContainText(/Connexion OK · \d+ ms/, { timeout: 1_000 });
  const dom = await page.evaluate(() => [document.documentElement.outerHTML, ...Array.from(document.querySelectorAll("input,textarea"), (el) => (el as HTMLInputElement).value)].join("\n"));
  expect(dom.includes(TOKEN), "le jeton ne reste ni dans le DOM ni dans un champ").toBe(false);

  // Comparaison : nordis-fr seule, sans demande de connexion, lancée pour de vrai.
  const previewed = page.waitForResponse((r) => r.url().endsWith("/comparisons/preview")
    && (JSON.parse(r.request().postData() ?? "{}") as { variants?: string[] }).variants?.join() === "nordis-fr");
  await page.goto(`${ws.root}/comparaison`);
  await page.getByRole("checkbox", { name: /nordis-es/ }).uncheck();
  await page.getByRole("checkbox", { name: /nordis-de/ }).uncheck();
  await previewed;
  await expect(page.getByText("Connexion requise", { exact: true })).toHaveCount(0);
  await expect(launchButton(page)).not.toHaveAttribute("aria-disabled", "true");
  const started = page.waitForResponse((r) => r.url().endsWith("/comparisons") && r.request().method() === "POST");
  await launchButton(page).click();
  const launched = await started;
  expect(launched.status(), await launched.text()).toBe(202);
  const { id } = (await launched.json()) as { id: number };
  await expect(page.getByRole("progressbar", { name: "Databricks · nordis-fr" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Relancer" })).toBeVisible({ timeout: 5 * 60_000 });
  await expect(page.getByRole("alert").filter({ hasText: /Comparaison n° \d+ en échec/ })).toHaveCount(0);

  // Côté serveur : exécutée sur dbx-fr, mêmes cellules exactes que l'oracle DuckDB.
  const real = await finished(request, ws.api, id);
  expect(real.status).toBe("done");
  expect(real.error).toBeNull();
  expect(real.runs.map(({ side, platform, access_point, status }) => ({ side, platform, access_point, status })).sort((a, b) => a.side.localeCompare(b.side))).toEqual([
    { side: "canonical", platform: "databricks", access_point: "dbx-fr", status: "done" },
    { side: "variant", platform: "databricks", access_point: "dbx-fr", status: "done" },
  ]);
  expect(outcome(real)).toEqual(outcome(expected));

  // Matrice : 100 % / 0,0 %, teinte donnée par les seuils nommés.
  await expect(page).toHaveURL(new RegExp(`id=${id}&variant=nordis-fr`));
  const link = page.getByRole("link", { name: `Revenu net × nordis-fr : ${ORACLE.validation} % de validation, écart max 0,0 %` });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("aria-current", "true");
  const shade = tone(ORACLE.validation);
  expect(shade).toBe(ORACLE.validation >= PASS_THRESHOLD ? "pass" : ORACLE.validation >= WARN_THRESHOLD ? "warn" : "bad");
  const td = link.locator("xpath=ancestor::td");
  await expect(td).toHaveClass(new RegExp(`tone-cell-${shade}`));
  const [shown, wanted] = await td.evaluate((el, token) => {
    const probe = document.createElement("div");
    probe.style.background = `var(${token})`;
    document.body.append(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return [getComputedStyle(el).backgroundColor, color];
  }, TOKENS[shade]);
  expect(shown).toBe(wanted);

  // Détail : les huit mois de l'oracle, aucune ligne hors tolérance.
  const detail = page.getByRole("region", { name: /Détail · Revenu net · nordis-fr · par Mois fiscal × Entité/ });
  await expect(detail).toContainText(`tolérance ${ORACLE.tolerance}`);
  const rows = detail.getByRole("row").filter({ has: page.locator("td") });
  await expect(rows).toHaveCount(ORACLE.cells.length);
  await expect(detail.locator("tr.is-out")).toHaveCount(0);
  for (const [index, [month, value]] of ORACLE.cells.entries()) {
    const cells = rows.nth(index).locator("td");
    await expect(cells.nth(0)).toHaveText(month);
    await expect(cells.nth(1)).toHaveText("FR");
    const grouped = new RegExp(`^${String(value).replace(/\B(?=(\d{3})+(?!\d))/g, "\\s")}$`);
    for (const column of [2, 3]) {
      await expect(cells.nth(column).locator("span[title]")).toHaveAttribute("title", String(value));
      await expect(cells.nth(column)).toHaveText(grouped);
    }
    await expect(cells.nth(4)).toHaveText("0,0 %");
    await expect(cells.nth(4).locator("span[title]")).toHaveAttribute("title", "0");
  }
  expect(await seriousViolations(page)).toEqual([]);

  // Historique : cette seule comparaison, à 100 %.
  await page.goto(`${ws.root}/comparaison?vue=historique`);
  const history = page.getByRole("table").getByRole("row");
  await expect(history).toHaveCount(2);
  await expect(history.nth(1)).toContainText(`nordis-fr ${ORACLE.validation} %`);
  expect(await seriousViolations(page)).toEqual([]);

  // Le token quitte le coffre de ce poste (un token personnel n'est révoqué que localement).
  await page.goto(`${ws.root}/connexions`);
  await connection(page).getByRole("button", { name: "Révoquer Databricks · dbx-fr" }).click();
  await expect(connection(page)).toContainText("Jamais connecté");
  await page.goto("about:blank");
});

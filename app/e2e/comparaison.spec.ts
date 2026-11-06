import { expect, test, type Page } from "@playwright/test";
import { ensureNordis, seriousViolations } from "./demo";

// Plan 0015 de bout en bout, sur l'espace de démonstration (anna.k) : exécution locale
// dans DuckDB sur les fichiers de core/tests/fixtures/compare (ATLAS_COMPARE_DATA).
// D'autres scénarios ont pu lancer des comparaisons avant : rien ne suppose un historique vide.
test.describe.configure({ mode: "serial" });

const COMPARISON = "/#/w/groupe-nordis/comparaison";

test.beforeAll(async ({ request }) => {
  await ensureNordis(request);
});

test("[S-0009-01] [S-0022-01] [S-0022-06] [S-0015-01] lancement, progression, matrice à 94 % / 6,1 % pour Revenu net × DE, ES à 75 % (critère 1 ; plan 0022)", async ({ page }) => {
  await page.goto(COMPARISON);
  await expect(page.getByRole("heading", { level: 1, name: "Comparaison" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "KPI" })).toHaveValue("revenu-net");
  const es = page.getByRole("checkbox", { name: /nordis-es/ });
  await expect(es).toBeEnabled(); // from scratch, rebranchée par ses binding (plan 0022)
  await expect(es).toBeChecked();
  await expect(page.getByRole("checkbox", { name: /nordis-de/ })).toBeChecked();
  await expect(page.getByText("Surcharge hors des points déclarés")).toBeVisible(); // avant tout lancement
  expect(await seriousViolations(page)).toEqual([]);

  await page.getByRole("button", { name: /Lancer la comparaison|Relancer/ }).click();
  await expect(page.getByRole("progressbar", { name: "Databricks · nordis-de, nordis-fr" })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Snowflake · nordis-es" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Relancer" })).toBeVisible({ timeout: 20_000 });
  await expect(page).toHaveURL(/id=\d+&variant=nordis-de/);

  const de = page.getByRole("link", { name: "Revenu net × nordis-de : 94 % de validation, écart max 6,1 %" });
  await expect(de).toBeVisible();
  await expect(de).toHaveAttribute("aria-current", "true");
  await expect(page.getByRole("link", { name: /Revenu net × nordis-fr : 100 % de validation/ })).toBeVisible();
  // La facture du 30 juin, clôturée après minuit à Madrid, compte en juillet côté ES.
  await expect(page.getByRole("link", { name: "Revenu net × nordis-es : 75 % de validation, écart max 2,9 %" })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});

test("[S-0015-02] [S-0015-06] détail : Sept. 2026 hors tolérance, le nœud divergent ouvre le diff au canonique (critères 2 et 6)", async ({ page }) => {
  await page.goto(COMPARISON);
  await page.getByRole("link", { name: /Revenu net × nordis-de : 94 %/ }).click();
  const detail = page.getByRole("region", { name: /Détail · Revenu net · nordis-de · par Mois fiscal × Entité/ });
  const september = detail.getByRole("row", { name: /Sept\. 2026 DE/ });
  await expect(september).toContainText("+6,1 % hors tolérance");
  await expect(september).toHaveClass(/is-out/);
  await expect(september.getByText("+6,1 %")).toHaveAttribute("title", /^6\.1001/);
  expect(await seriousViolations(page)).toEqual([]);

  await detail.getByRole("link", { name: "Nœud divergent : n02 · Factures validées" }).click();
  await expect(page).toHaveURL(/#\/w\/groupe-nordis\/fiche\/revenu-net--nordis-de\?diff=canonique&node=n02$/);
  await expect(page.getByText(/Nœud sélectionné : n02/)).toBeVisible();
  const variant = page.getByRole("figure", { name: /Graphe : Déclinaison nordis-de/ });
  await expect(variant.locator(".graph-card.is-selected")).toContainText("Factures validées");
  await expect(variant.locator(".graph-card.is-selected")).toBeInViewport();
  expect(await seriousViolations(page)).toEqual([]);
});

test("[S-0015-07] historique : « Tout voir », filtre par utilisateur (critère 7)", async ({ page }) => {
  await page.goto(COMPARISON);
  const strip = page.getByRole("region", { name: "Dernières comparaisons" });
  await expect(strip.getByRole("link", { name: /n° \d+ · Revenu net/ }).first()).toBeVisible();
  await strip.getByRole("link", { name: "Tout voir" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Historique des comparaisons" })).toBeVisible();
  const rows = page.getByRole("table").getByRole("row");
  await expect(rows.nth(1)).toContainText("anna.k");
  await expect(rows.nth(1)).toContainText("nordis-de 94 % · nordis-es 75 % · nordis-fr 100 %");

  await page.getByRole("combobox", { name: "Utilisateur" }).selectOption("anna.k");
  await expect(page).toHaveURL(/user=anna\.k/);
  await page.getByLabel("Depuis le").fill("2999-01-01");
  await expect(page.getByText("Aucune comparaison ne correspond à ces filtres.")).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});

// Suivi de la revue globale : le serveur est simulé pour les réponses qu'une exécution locale
// ne produit pas à la demande (lancement retenu, refus, suivi en échec, annulation refusée).
// Les écrans, le setup et l'aperçu viennent du vrai serveur.
const RUNS = "/api/workspaces/groupe-nordis/comparisons";
type Reply = { status: number; json: unknown };
const refusal = (status: number, code: string, message: string): Reply => ({ status, json: { detail: { code, message } } });
const ongoing = (id: number): Reply => ({
  status: 200,
  json: {
    id, started_at: "2026-11-06T09:00:00", finished_at: null, user_account: "anna.k", kpi_id: "revenu-net", kpi_version: 4,
    scope: { id: "fy2026-mois-entite" }, tolerance_pct: 1, status: "running", error: null, results: [],
    progress: [
      { platform: "databricks", entities: ["nordis-de", "nordis-fr"], state: "running", percent: 40 },
      { platform: "snowflake", entities: ["nordis-es"], state: "pending", percent: 0 },
    ],
  },
});

type Replies = {
  start?: (count: number) => Reply | Promise<Reply>;
  poll?: (id: number, count: number) => Reply;
  cancel?: (id: number) => Reply;
};
/** Intercepte lancement, suivi et annulation ; tout le reste passe au vrai serveur. */
async function simulateRuns(page: Page, replies: Replies) {
  const seen = { starts: [] as unknown[], polls: [] as number[], cancels: [] as number[] };
  await page.route((url) => url.pathname.startsWith(RUNS), async (route) => {
    const request = route.request();
    const rest = new URL(request.url()).pathname.slice(RUNS.length);
    const method = request.method();
    const reply = async (value: Reply) => route.fulfill({ status: value.status, json: value.json });
    if (method === "POST" && rest === "" && replies.start) {
      seen.starts.push(request.postDataJSON());
      return reply(await replies.start(seen.starts.length));
    }
    const polled = rest.match(/^\/(\d+)$/);
    if (method === "GET" && polled && replies.poll) {
      const id = Number(polled[1]);
      seen.polls.push(id);
      return reply(replies.poll(id, seen.polls.filter((other) => other === id).length));
    }
    const cancelled = rest.match(/^\/(\d+)\/cancel$/);
    if (method === "POST" && cancelled && replies.cancel) {
      seen.cancels.push(Number(cancelled[1]));
      return reply(replies.cancel(Number(cancelled[1])));
    }
    return route.fallback();
  });
  return seen;
}

/** L'écran est prêt à lancer : l'aperçu a rendu ses plans et ses alertes. */
async function readyToLaunch(page: Page) {
  await page.goto(COMPARISON);
  await expect(page.getByText("Surcharge hors des points déclarés")).toBeVisible();
  return page.getByRole("button", { name: /Lancer la comparaison|Relancer/ });
}

test("[S-0015-08] un double clic sur le lancement n'envoie qu'une seule demande", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const seen = await simulateRuns(page, {
    start: async () => { await held; return { status: 202, json: { id: 9001, status: "running", alerts: [] } }; },
    poll: (id) => ongoing(id),
  });
  const launch = await readyToLaunch(page);
  await launch.dblclick();
  await expect(launch).toHaveAttribute("aria-busy", "true");
  await expect(launch).toHaveAttribute("aria-disabled", "true");
  release();
  await expect(page.getByRole("progressbar", { name: "Databricks · nordis-de, nordis-fr" })).toBeVisible();
  await expect(launch).not.toHaveAttribute("aria-busy", "true");
  expect(seen.starts).toHaveLength(1);
  expect(await seriousViolations(page)).toEqual([]);
});

test("[S-0009-13] la comparaison déjà en cours est refusée avec son message traduit", async ({ page }) => {
  const seen = await simulateRuns(page, {
    start: () => refusal(409, "comparison_running", "Cette comparaison est déjà en cours."),
  });
  const launch = await readyToLaunch(page);
  await launch.click();
  await expect(page.getByText("Comparaison déjà en cours", { exact: true })).toBeVisible();
  await expect(page.getByText("Attendez sa fin avant de relancer cette comparaison.")).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await expect(launch).not.toHaveAttribute("aria-disabled", "true");
  expect(seen.starts).toHaveLength(1);
  expect(await seriousViolations(page)).toEqual([]);
});

test("[S-0015-09] un suivi qui échoue durablement ou une exécution inconnue passent en échec, le lancement redevient possible", async ({ page }) => {
  const seen = await simulateRuns(page, {
    start: (count) => ({ status: 202, json: { id: 9000 + count, status: "running", alerts: [] } }),
    poll: (id) => id === 9001
      ? refusal(500, "oops", "Suivi impossible")
      : refusal(404, "not_found", "Comparaison introuvable"),
  });
  const launch = await readyToLaunch(page);
  await launch.click();
  await expect(page.getByRole("progressbar", { name: "Databricks · nordis-de, nordis-fr" })).toBeVisible();
  // Cinq erreurs consécutives, pas une de moins : le sondage s'arrête au cinquième échec.
  await expect(page.getByText("Suivi impossible")).toBeVisible({ timeout: 15_000 });
  expect(seen.polls).toEqual([9001, 9001, 9001, 9001, 9001]);
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await expect(launch).not.toHaveAttribute("aria-disabled", "true");
  expect(await seriousViolations(page)).toEqual([]);

  // Un nouveau lancement est accepté ; une exécution inconnue (404) échoue dès la première réponse.
  await launch.click();
  await expect(page.getByText("Comparaison introuvable")).toBeVisible();
  await expect(page.getByText("Suivi impossible")).toHaveCount(0);
  expect(seen.starts).toHaveLength(2);
  expect(seen.polls).toEqual([9001, 9001, 9001, 9001, 9001, 9002]);
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await expect(launch).not.toHaveAttribute("aria-disabled", "true");
  expect(await seriousViolations(page)).toEqual([]);
});

test("[S-0015-10] l'échec de l'annulation est affiché, la comparaison reste suivie", async ({ page }) => {
  const seen = await simulateRuns(page, {
    start: () => ({ status: 202, json: { id: 9001, status: "running", alerts: [] } }),
    poll: (id) => ongoing(id),
    cancel: () => refusal(500, "oops", "Annulation impossible"),
  });
  const launch = await readyToLaunch(page);
  await launch.click();
  await page.getByRole("button", { name: "Annuler" }).click();
  await expect(page.getByText("Annulation impossible")).toBeVisible();
  expect(seen.cancels).toEqual([9001]);
  await expect(page.getByRole("button", { name: "Annuler" })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Databricks · nordis-de, nordis-fr" })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});

test("[S-0015-11] une tolérance de 8 % règle le curseur sur 8 et la comparaison l'utilise", async ({ page }) => {
  // Le vrai serveur répond, avec une tolérance de 8 % pour le KPI.
  await page.route((url) => url.pathname === `${RUNS}/setup`, async (route) => {
    const setup = await (await route.fetch()).json() as { tolerance: { kpi: number | null; workspace: number } };
    await route.fulfill({ json: { ...setup, tolerance: { ...setup.tolerance, kpi: 8 } } });
  });
  await page.route((url) => url.pathname === `${RUNS}/preview`, async (route) => {
    const preview = await (await route.fetch()).json() as object;
    await route.fulfill({ json: { ...preview, tolerance: 8 } });
  });
  const seen = await simulateRuns(page, {
    start: () => ({ status: 202, json: { id: 9001, status: "running", alerts: [] } }),
    poll: (id) => ongoing(id),
  });
  const launch = await readyToLaunch(page);
  const slider = page.getByRole("slider", { name: /Tolérance/ });
  await expect(slider).toHaveValue("8");
  await expect(slider).toHaveAttribute("max", "8");
  await expect(page.getByText("Tolérance : 8 %")).toBeVisible();
  // La poignée n'est plus calée à 5 : revenir à la butée donne 8, pas 5.
  await slider.press("ArrowLeft");
  await expect(slider).toHaveValue("7.9");
  await slider.press("End");
  await expect(slider).toHaveValue("8");
  expect(await seriousViolations(page)).toEqual([]);

  await launch.click();
  await expect(page.getByRole("progressbar", { name: "Databricks · nordis-de, nordis-fr" })).toBeVisible();
  expect(seen.starts).toHaveLength(1);
  expect(seen.starts[0]).toMatchObject({ kpi_id: "revenu-net", tolerance: 8 });
});

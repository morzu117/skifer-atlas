import { expect, type Page } from "@playwright/test";
import { API, FAKE_DATABRICKS, seriousViolations } from "./demo";
import { AUTH_API, git, isolatedDemo, python, relay, test } from "./isolation";

// Plan 0016 : ce que l'écran « Mes connexions » dit quand le parcours nominal ne s'applique
// pas : délai de l'autorisation, plateformes retirées, simple lecteur, identifiant déjà pris.
// Chaque test travaille sur sa propre copie de l'espace, sur le serveur d'authentification (8793).

const row = (page: Page) => page.getByRole("row").filter({ hasText: "gold.finance" });
const panel = (page: Page) => page.getByRole("complementary", { name: "Nouveau point d'accès" });

test("[S-0016-10] une autorisation laissée sans réponse échoue au bout de 5 minutes, et « Se connecter » repart", async ({ page, request }) => {
  const ws = await isolatedDemo(request, AUTH_API);
  await relay(page, AUTH_API);
  await page.clock.install();
  await page.goto(`${ws.root}/connexions`);
  // La page d'autorisation du faux répondrait seule : on l'interrompt, comme une fenêtre abandonnée.
  let blocked = true;
  await page.context().route("**/oidc/v1/authorize**", (route) => (blocked ? route.abort() : route.fallback()));
  const popups: Page[] = [];
  page.on("popup", (popup) => popups.push(popup));

  await row(page).getByRole("button", { name: "Se connecter à Databricks · dbx-fr" }).click();
  await expect.poll(() => popups.length).toBe(1); // la fenêtre du faux est ouverte, personne ne répond
  await page.clock.runFor(4 * 60_000);
  await expect(row(page).getByRole("alert")).toHaveCount(0); // 4 minutes : encore en attente
  await page.clock.runFor(61_000);
  await expect(row(page).getByRole("alert")).toContainText("Délai dépassé");
  await expect(row(page).getByRole("alert")).toContainText("La connexion n'a pas abouti en 5 minutes : réessayer.");
  expect(await seriousViolations(page)).toEqual([]);

  // Le bouton relance un flux complet, qui aboutit.
  blocked = false;
  await row(page).getByRole("button", { name: "Se connecter à Databricks · dbx-fr" }).click();
  await expect.poll(() => popups.length).toBe(2);
  await expect(popups[1]!.getByText(/Connexion réussie/)).toBeVisible();
  await expect(row(page).getByRole("cell", { name: /^Connecté ?· ?session OAuth$/ })).toBeVisible();
  await expect(row(page).getByRole("alert")).toHaveCount(0);
  for (const popup of popups) await popup.close().catch(() => undefined);
});

test("[S-0016-11] sans plateforme autorisée, l'écran l'explique et n'offre pas d'ajout ; un lecteur n'a ni panneau ni bouton", async ({ page, request }) => {
  const ws = await isolatedDemo(request, AUTH_API);
  python(`import sys,yaml
from pathlib import Path
p=Path(sys.argv[1])/'governance.yaml'
d=yaml.safe_load(p.read_text()); d['allowed_platforms']=[]
p.write_text(yaml.safe_dump(d,allow_unicode=True,sort_keys=False))`, ws.work);
  git(ws.work, "add", "."); git(ws.work, "commit", "-qm", "Aucune plateforme autorisée"); git(ws.work, "push", "origin", "main");
  expect((await request.post(`${ws.api}/sync`)).ok()).toBe(true);
  await relay(page, AUTH_API);
  await page.goto(`${ws.root}/connexions`);

  const notice = page.getByRole("complementary", { name: "Configurer les plateformes" });
  await expect(notice.getByRole("heading", { name: "Aucune plateforme connectable autorisée" })).toBeVisible();
  await expect(notice).toContainText("Un référent de l'espace doit autoriser Databricks ou Snowflake dans l'administration avant d'ajouter un point d'accès.");
  await expect(notice.getByRole("link", { name: "Configurer les plateformes" })).toBeVisible(); // julien.h est référent de l'espace
  await expect(page.getByRole("button", { name: "Ajouter un point d'accès" })).toHaveCount(0);
  await expect(panel(page)).toHaveCount(0);

  // Les points déjà déclarés restent listés, avec la plateforme retirée signalée.
  await expect(row(page)).toContainText("Plateforme retirée par le référent");

  // Un simple lecteur ne voit ni l'avis de configuration, ni le panneau, ni le bouton.
  await page.route(`${API}/api/workspaces/${ws.id}`, async (route) => {
    const response = await route.fetch({ url: route.request().url().replace(API, AUTH_API) });
    const found = (await response.json()) as object;
    await route.fulfill({ response, json: { ...found, role: "lecteur", role_label: "Lecteur", space_referent: false } });
  });
  await page.reload();
  await expect(row(page)).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Configurer les plateformes" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ajouter un point d'accès" })).toHaveCount(0);
  await expect(panel(page)).toHaveCount(0);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("[S-0016-11] l'écran sans plateforme autorisée n'a aucune violation d'accessibilité sérieuse", async ({ page, request }) => {
  const ws = await isolatedDemo(request, AUTH_API);
  python(`import sys,yaml
from pathlib import Path
p=Path(sys.argv[1])/'governance.yaml'
d=yaml.safe_load(p.read_text()); d['allowed_platforms']=[]
p.write_text(yaml.safe_dump(d,allow_unicode=True,sort_keys=False))`, ws.work);
  git(ws.work, "add", "."); git(ws.work, "commit", "-qm", "Aucune plateforme autorisée"); git(ws.work, "push", "origin", "main");
  expect((await request.post(`${ws.api}/sync`)).ok()).toBe(true);
  await relay(page, AUTH_API);
  await page.goto(`${ws.root}/connexions`);
  await expect(page.getByRole("heading", { name: "Aucune plateforme connectable autorisée" })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});

test("[S-0016-12] se connecter ou tester avec un identifiant déjà déclaré est refusé, et le message renvoie à la liste", async ({ page, request }) => {
  const ws = await isolatedDemo(request, AUTH_API);
  await relay(page, AUTH_API);
  await page.goto(`${ws.root}/connexions`);
  const form = panel(page);
  await form.getByLabel("Identifiant").fill("dbx-fr");
  await form.getByLabel("Hôte").fill(FAKE_DATABRICKS);
  await form.getByLabel("SQL warehouse").fill("abc123");
  await form.getByLabel("Schéma").fill("gold.finance");

  const refused = form.getByRole("alert").filter({ hasText: "déjà déclaré" });
  await form.getByRole("button", { name: "Tester la connexion" }).click();
  await expect(refused).toContainText("« dbx-fr » est déjà déclaré : s'y connecter depuis la liste.");
  await expect(refused).not.toContainText(/Traceback|"detail"|access_point_exists/);
  await expect(form.getByText(/Connexion OK/)).toHaveCount(0);
  expect(await seriousViolations(page)).toEqual([]);

  // L'authentification du brouillon est refusée de même, sans ouvrir de fenêtre ni écrire dans le coffre.
  let popups = 0;
  page.on("popup", () => { popups += 1; });
  await form.getByRole("button", { name: "S'authentifier avec OAuth" }).click();
  await expect(refused).toContainText("« dbx-fr » est déjà déclaré");
  expect(popups).toBe(0);
  await expect(form.getByText(/Connecté : le token est rangé/)).toHaveCount(0);

  // Un identifiant libre n'a pas ce refus : le test de connexion se fait.
  await form.getByLabel("Identifiant").fill("dbx-libre");
  await expect(refused).toHaveCount(0);
});

test("les points REST présentent les clés et leurs seules actions disponibles", async ({ page, request }) => {
  const ws = await isolatedDemo(request, AUTH_API);
  await relay(page, AUTH_API);
  await page.route(`${API}/api/workspaces/${ws.id}/connections`, async (route) => {
    const response = await route.fetch({ url: route.request().url().replace(API, AUTH_API) });
    const existing = await response.json();
    const base = { platform: "rest", host: "https://api.example", entity: "nordis-fr", owner: "claire.m", owner_name: "Claire M.", freshness: null, allowed: true, supported: true, auth_mode: null, login: null, private_key_file: null, expires_in_days: null, error: null };
    await route.fulfill({ response, json: [...existing, { ...base, access_point: "api-sans-cle", schema: "api-sans-cle", auth: null, my_access: "never", key_source: null }, { ...base, access_point: "api-coffre", schema: "api-coffre", auth: "apikey", my_access: "connected", key_source: "vault" }] });
  });
  await page.goto(`${ws.root}/connexions`);
  const never = page.getByRole("row").filter({ hasText: "api-sans-cle" });
  const vault = page.getByRole("row").filter({ hasText: "api-coffre" });
  for (const line of [never, vault]) {
    await expect(line.getByText("API REST")).toBeVisible();
    await expect(line.getByText("nordis-fr · clé d'API")).toBeVisible();
    await expect(line.getByRole("button", { name: /Se connecter|Reconnecter|Tester/ })).toHaveCount(0);
  }
  await expect(never).toContainText("Jamais connecté");
  await expect(never.locator("code")).toHaveText(`atlas rest-key ${ws.id} api-sans-cle`);
  await expect(never.locator("code")).toHaveCSS("display", "block");
  await expect(never.locator("code")).toHaveCSS("white-space", "nowrap");
  await expect(never.locator("code")).toHaveCSS("font-size", await never.locator(".muted").evaluate((element) => getComputedStyle(element).fontSize));
  await expect(vault).toContainText("Connecté");
  await expect(vault).toContainText("clé au coffre");
  await expect(vault.getByRole("button", { name: "Retirer la clé API REST · api-coffre" })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});

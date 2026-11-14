import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { API, FAKE_DATABRICKS, FAKE_SNOWFLAKE, SNOWFLAKE_KEY, SNOWFLAKE_PASSPHRASE } from "./demo";
import { AUTH_API, git, isolatedDemo, python, relay, test } from "./isolation";

// Écran 106, Mes connexions : les gestes de l'utilisateur que les scénarios des plans 0016 et
// 0018 ne font pas (inventaire docs/tests/inventaire-ui-ecrans.md). L'oracle est la maquette
// 10.6, le guide (10.6), le brief (7.2, 10.6), les plans 0016 et 0018 et les ADR 0020 et 0044.
// Chaque test travaille sur sa propre copie de Groupe Nordis, sur le serveur de julien.h
// (référent de l'espace, 8793), dont dbx-fr pointe vers le faux Databricks et snow-de / snow-es
// vers le faux Snowflake.

const row = (page: Page, schema = "gold.finance") => page.getByRole("row").filter({ hasText: schema });
const panel = (page: Page) => page.getByRole("complementary", { name: "Nouveau point d'accès" });

async function configure(request: APIRequestContext, data = {}) {
  expect((await request.post(`${FAKE_DATABRICKS}/__test__/configure`, { data })).ok()).toBe(true);
}
async function configureSnowflake(request: APIRequestContext, data = {}) {
  expect((await request.post(`${FAKE_SNOWFLAKE}/__test__/configure`, { data })).ok()).toBe(true);
}
test.afterEach(async ({ request }) => { await configure(request); await configureSnowflake(request); });

/** Ouvre la page d'autorisation comme le navigateur du système, et la referme une fois réussie. */
async function authorizeIn(page: Page, click: () => Promise<void>) {
  const opened = page.waitForEvent("popup");
  await click();
  const popup = await opened;
  await expect(popup.getByText(/Connexion réussie/)).toBeVisible();
  await popup.close();
}

async function open(page: Page, request: APIRequestContext) {
  const ws = await isolatedDemo(request, AUTH_API);
  await relay(page, AUTH_API);
  await page.goto(`${ws.root}/connexions`);
  await expect(page.getByRole("heading", { level: 1, name: "Mes connexions" })).toBeVisible();
  return ws;
}

test("[S-UI-106-01] se connecter, recharger : l'accès reste « Connecté » ; révoquer, recharger : il reste « Jamais connecté »", async ({ page, request }) => {
  await open(page, request);
  // Sous-titre de la maquette : les tokens restent sur ce poste.
  await expect(page.getByText(/vos tokens sont chiffrés sur cette machine, jamais sur un serveur ni dans Git/)).toBeVisible();
  await authorizeIn(page, () => row(page).getByRole("button", { name: "Se connecter à Databricks · dbx-fr" }).click());
  await expect(row(page).getByRole("cell", { name: /^Connecté\s*·\s*session OAuth$/ })).toBeVisible();

  await page.reload();
  await expect(row(page).getByRole("cell", { name: /^Connecté\s*·\s*session OAuth$/ })).toBeVisible();
  await expect(row(page).getByRole("button", { name: "Tester Databricks · dbx-fr" })).toBeVisible();
  await expect(row(page).getByRole("button", { name: "Révoquer Databricks · dbx-fr" })).toBeVisible();

  await row(page).getByRole("button", { name: "Révoquer Databricks · dbx-fr" }).click();
  await expect(row(page).getByRole("status")).toContainText(/Accès (révoqué|retiré du coffre)/);
  await expect(row(page).getByRole("cell", { name: "Jamais connecté" })).toBeVisible();
  await page.reload();
  await expect(row(page).getByRole("cell", { name: "Jamais connecté" })).toBeVisible();
  await expect(row(page).getByRole("button", { name: "Se connecter à Databricks · dbx-fr" })).toBeVisible();
  await expect(row(page).getByRole("button", { name: "Tester Databricks · dbx-fr" })).toHaveCount(0);
});

test("[S-UI-106-02] le panneau ne propose que les plateformes autorisées ; l'identifiant suit la plateforme et l'entité, puis ne bouge plus une fois modifié", async ({ page, request }) => {
  await open(page, request);
  const form = panel(page);
  const platform = form.getByRole("combobox", { name: /^Plateforme/ });
  const entity = form.getByRole("combobox", { name: "Entité" });
  const id = form.getByRole("textbox", { name: "Identifiant", exact: true });

  // Gouvernance de la démonstration : Databricks et Snowflake seulement (guide 10.6, ADR 0020).
  await expect(platform.getByRole("option")).toHaveText(["Databricks", "Snowflake"]);

  // Par défaut, la première entité sans point d'accès sur la plateforme (dbx-fr est déclaré).
  await expect(entity).toHaveValue("nordis-de");
  await expect(id).toHaveValue("dbx-de");
  await entity.selectOption("nordis-es");
  await expect(id).toHaveValue("dbx-es");
  await entity.selectOption({ label: "Tout le groupe" });
  await expect(id).toHaveValue("dbx-groupe");
  await expect(form.getByRole("textbox", { name: "SQL warehouse" })).toBeVisible();
  await expect(form.getByRole("textbox", { name: "Hôte" })).toHaveAttribute("placeholder", "adb-xxxx.azuredatabricks.net");

  // Snowflake : ses propres champs remplacent le SQL warehouse ; l'identifiant suit.
  await platform.selectOption({ label: "Snowflake" });
  await expect(id).toHaveValue("snow-groupe");
  await expect(form.getByRole("textbox", { name: "SQL warehouse" })).toHaveCount(0);
  for (const name of ["Compte", "Entrepôt", "Rôle"]) await expect(form.getByRole("textbox", { name })).toBeVisible();
  const auth = form.getByRole("combobox", { name: "Authentification" });
  await expect(auth).toHaveValue("sso");
  await expect(form.getByRole("button", { name: "Ouvrir le SSO" })).toBeVisible();
  await expect(form.getByRole("button", { name: "S'authentifier avec OAuth" })).toHaveCount(0);
  await auth.selectOption({ label: "Paire de clés" });
  await expect(form.getByLabel("Fichier de clé privée")).toBeVisible();
  await expect(form.getByLabel("Passphrase (si la clé est chiffrée)")).toHaveAttribute("type", "password");
  await expect(form.getByRole("button", { name: "Ranger dans le coffre" })).toBeDisabled(); // identifiant et clé manquent

  // Un identifiant saisi à la main n'est plus recalculé.
  await id.fill("snow-perso");
  await entity.selectOption("nordis-fr");
  await expect(id).toHaveValue("snow-perso");
  await platform.selectOption({ label: "Databricks" });
  await expect(id).toHaveValue("snow-perso");
  await expect(form.getByRole("button", { name: "S'authentifier avec OAuth" })).toBeVisible();
});

test("[S-UI-106-03] « Proposer le point d'accès » attend une justification ; le panneau dit que la déclaration passe par une proposition", async ({ page, request }) => {
  await open(page, request);
  const form = panel(page);
  const propose = form.getByRole("button", { name: "Proposer le point d'accès" });
  await expect(form.getByText("La déclaration passe par une proposition sur access_points.yaml, validée par un référent d'espace.")).toBeVisible();
  await expect(propose).toBeDisabled();
  await form.getByRole("textbox", { name: "Justification" }).fill("   ");
  await expect(propose).toBeDisabled();
  await form.getByRole("textbox", { name: "Justification" }).fill("Point d'accès de nordis-de.");
  await expect(propose).toBeEnabled();
  await form.getByRole("textbox", { name: "Justification" }).fill("");
  await expect(propose).toBeDisabled();
});

test("[S-UI-106-04] « Tester la connexion » avant de s'authentifier dit qu'il faut se connecter, sans le texte brut du serveur", async ({ page, request }) => {
  await open(page, request);
  const form = panel(page);
  await form.getByRole("textbox", { name: "Hôte" }).fill(FAKE_DATABRICKS);
  await form.getByRole("textbox", { name: "SQL warehouse" }).fill("abc123");
  await form.getByRole("textbox", { name: "Schéma" }).fill("gold.finance");
  await form.getByRole("button", { name: "Tester la connexion" }).click();
  // ADR 0044 : un code (`not_connected`) s'affiche avec son titre et sa consigne.
  await expect(form).toContainText("Pas encore connecté");
  await expect(form).toContainText("Connectez-vous");
  await expect(form).not.toContainText(/not_connected|Traceback|"detail"/);
  await expect(form.getByText(/Connexion OK/)).toHaveCount(0);
});

test("[S-UI-106-05] panneau : « Annuler la connexion » libère les champs verrouillés pendant l'OAuth, puis l'OAuth se relance et aboutit", async ({ page, request }) => {
  await open(page, request);
  const form = panel(page);
  await form.getByRole("textbox", { name: "Hôte" }).fill(FAKE_DATABRICKS);
  await form.getByRole("textbox", { name: "SQL warehouse" }).fill("abc123");
  // La page d'autorisation ne s'ouvre pas : une fenêtre fermée ou bloquée.
  let blocked = true;
  await page.context().route("**/oidc/v1/authorize**", (route) => (blocked ? route.abort() : route.fallback()));

  await form.getByRole("button", { name: "S'authentifier avec OAuth" }).click();
  await expect(form.getByText("Terminez la connexion dans le navigateur : l'état se met à jour ici.")).toBeVisible();
  await expect(form.getByText("Les champs sont verrouillés le temps de la connexion")).toBeVisible();
  for (const name of ["Identifiant", "Hôte", "SQL warehouse", "Schéma"]) await expect(form.getByRole("textbox", { name })).toBeDisabled();
  await expect(form.getByRole("combobox", { name: /^Plateforme/ })).toBeDisabled();
  await expect(form.getByRole("button", { name: "S'authentifier avec OAuth" })).toBeDisabled();

  await form.getByRole("button", { name: "Annuler la connexion" }).click();
  await expect(form.getByText(/Terminez la connexion dans le navigateur/)).toHaveCount(0);
  for (const name of ["Identifiant", "Hôte", "SQL warehouse", "Schéma"]) await expect(form.getByRole("textbox", { name })).toBeEnabled();
  await expect(form.getByText(/Connecté : le token est rangé/)).toHaveCount(0);
  await expect(form.getByRole("alert")).toHaveCount(0);

  blocked = false;
  await authorizeIn(page, () => form.getByRole("button", { name: "S'authentifier avec OAuth" }).click());
  await expect(form.getByText("Connecté : le token est rangé dans votre coffre, sous dbx-de.")).toBeVisible();
  await expect(form.getByRole("button", { name: "Reconnecter avec OAuth" })).toBeVisible();
  await page.context().unrouteAll({ behavior: "ignoreErrors" });
});

test("[S-UI-106-06] panneau Snowflake : SSO puis test du brouillon, puis paire de clés, sans passphrase dans la page", async ({ page, request }) => {
  await open(page, request);
  const form = panel(page);
  await form.getByRole("combobox", { name: /^Plateforme/ }).selectOption({ label: "Snowflake" });
  await form.getByRole("combobox", { name: "Entité" }).selectOption({ label: "Tout le groupe" });
  await expect(form.getByRole("textbox", { name: "Identifiant", exact: true })).toHaveValue("snow-groupe");
  await form.getByRole("textbox", { name: "Hôte" }).fill(FAKE_SNOWFLAKE);
  await form.getByRole("textbox", { name: "Compte" }).fill("nordis-groupe");
  await form.getByRole("textbox", { name: "Entrepôt" }).fill("WH_FINANCE");
  await form.getByRole("textbox", { name: "Schéma" }).fill("FIN_GOLD.PUBLIC");

  const sso = form.getByRole("button", { name: "Ouvrir le SSO" });
  await expect(sso).toBeDisabled(); // identifiant Snowflake manquant
  await form.getByLabel("Identifiant Snowflake").fill("anna@nordis.example");
  await sso.click();
  await expect(form.getByText("Connecté : la session SSO est rangée dans votre coffre, sous snow-groupe.")).toBeVisible();
  await form.getByRole("button", { name: "Tester la connexion" }).click();
  await expect(form.getByText(/^Connexion OK · \d+ ms$/)).toBeVisible();

  // Même brouillon, en paire de clés : la passphrase part au coffre et le champ se vide.
  await form.getByRole("combobox", { name: "Authentification" }).selectOption({ label: "Paire de clés" });
  await form.getByLabel("Identifiant Snowflake").fill("svc_es");
  await form.getByLabel("Fichier de clé privée").fill(SNOWFLAKE_KEY);
  await form.getByLabel("Passphrase (si la clé est chiffrée)").fill(SNOWFLAKE_PASSPHRASE);
  await form.getByRole("button", { name: "Ranger dans le coffre" }).click();
  await expect(form.getByText("Clé enregistrée : la passphrase est dans votre coffre, sous snow-groupe.")).toBeVisible();
  await expect(form.getByLabel("Passphrase (si la clé est chiffrée)")).toHaveValue("");
  const seen = await page.evaluate(() => [document.documentElement.outerHTML, JSON.stringify(localStorage), JSON.stringify(sessionStorage)].join("\n"));
  expect(seen).not.toContain(SNOWFLAKE_PASSPHRASE);
  await page.goto("about:blank");
});

test("[S-UI-106-07] « Annuler » referme la connexion Snowflake d'une ligne et le champ du token personnel, sans rien enregistrer", async ({ page, request }) => {
  await open(page, request);
  const de = row(page, "FIN_GOLD.PUBLIC");
  await de.getByRole("button", { name: "Se connecter à Snowflake · snow-de" }).click();
  await de.getByLabel("Identifiant Snowflake").fill("anna@nordis.example");
  await de.getByRole("button", { name: "Annuler" }).click();
  await expect(de.getByLabel("Identifiant Snowflake")).toHaveCount(0);
  await expect(de.getByRole("button", { name: "Se connecter à Snowflake · snow-de" })).toBeVisible();
  await expect(de.getByRole("cell", { name: "Jamais connecté" })).toBeVisible();

  // Repli Databricks : il n'apparaît qu'après un échec de l'OAuth (plan 0016), et « Annuler » le referme.
  await configure(request, { refuse_authorize: true });
  const fr = row(page);
  await expect(fr.getByRole("button", { name: "Utiliser un token personnel" })).toHaveCount(0);
  const opened = page.waitForEvent("popup");
  await fr.getByRole("button", { name: "Se connecter à Databricks · dbx-fr" }).click();
  const popup = await opened;
  await expect(fr.getByRole("alert")).toContainText("Connexion échouée");
  await popup.close();
  await fr.getByRole("button", { name: "Utiliser un token personnel" }).click();
  const field = fr.getByLabel("Token personnel Databricks");
  await field.fill("dapi-factice-abandonne");
  await expect(fr.getByRole("button", { name: "Ranger dans le coffre" })).toBeEnabled();
  await fr.getByRole("button", { name: "Annuler" }).click();
  await expect(field).toHaveCount(0);
  await expect(fr.getByRole("button", { name: "Utiliser un token personnel" })).toBeVisible();
  await expect(fr.getByRole("cell", { name: "Jamais connecté" })).toBeVisible();
  await page.reload();
  await expect(fr.getByRole("cell", { name: "Jamais connecté" })).toBeVisible();
});

test("[S-UI-106-08] coffre indisponible au chargement : bandeau traduit, sans le texte brut du serveur", async ({ page, request }) => {
  const ws = await isolatedDemo(request, AUTH_API);
  await relay(page, AUTH_API);
  // Panne du serveur sur la liste : le trousseau du système ne répond pas.
  await page.route(`${API}/api/workspaces/${ws.id}/connections`, (route) =>
    route.fulfill({ status: 503, json: { detail: { code: "vault_unavailable", message: "SecKeychain -25308 RAW-OUTPUT" } } }));
  await page.goto(`${ws.root}/connexions`);
  const banner = page.getByRole("alert").filter({ hasText: "Trousseau du système indisponible" });
  await expect(banner).toContainText("Déverrouillez le trousseau");
  await expect(banner).not.toContainText("RAW-OUTPUT");
  await expect(page.getByRole("table", { name: "Points d'accès de l'espace" })).toHaveCount(0);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("[S-UI-106-09] erreur d'API sur la liste : le bandeau porte une action « Réessayer » qui relit la liste", async ({ page, request }) => {
  const ws = await isolatedDemo(request, AUTH_API);
  await relay(page, AUTH_API);
  let failing = true;
  await page.route(`${API}/api/workspaces/${ws.id}/connections`, (route) =>
    failing ? route.fulfill({ status: 503, json: { detail: { code: "vault_unavailable", message: "indisponible" } } }) : route.fallback());
  await page.goto(`${ws.root}/connexions`);
  const banner = page.getByRole("alert").filter({ hasText: "Trousseau du système indisponible" });
  await expect(banner).toBeVisible();
  // Plan 0010 (États) : « erreur d'API (bandeau avec le message et l'action) » ; guide 3.7.
  failing = false;
  await banner.getByRole("button", { name: "Réessayer" }).click({ timeout: 5_000 });
  await expect(row(page).getByRole("cell", { name: "Jamais connecté" })).toBeVisible();
  await expect(banner).toHaveCount(0);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("[S-UI-106-10] serveur local injoignable sur Mes connexions : bandeau critique, puis « Réessayer » recharge la liste", async ({ page, request }) => {
  const ws = await isolatedDemo(request, AUTH_API);
  await relay(page, AUTH_API);
  const down = `${API}/api/workspaces/${ws.id}/connections`;
  await page.route(down, (route) => route.abort("connectionrefused"));
  await page.goto(`${ws.root}/connexions`);
  const banner = page.getByRole("alert").filter({ hasText: "Serveur local injoignable" });
  await expect(banner).toBeVisible();
  await expect(page.getByRole("table", { name: "Points d'accès de l'espace" })).toHaveCount(0);
  await page.unroute(down);
  await banner.getByRole("button", { name: "Réessayer" }).click();
  await expect(banner).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "Mes connexions" })).toBeVisible();
  await expect(row(page).getByRole("cell", { name: "Jamais connecté" })).toBeVisible();
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("[S-UI-106-11] une plateforme autorisée mais pas encore prise en charge : « (bientôt) » grisé dans le panneau, « Bientôt dans Atlas » sur sa ligne", async ({ page, request }) => {
  const ws = await isolatedDemo(request, AUTH_API);
  python(`import sys,yaml
from pathlib import Path
root=Path(sys.argv[1])
g=root/'governance.yaml'; d=yaml.safe_load(g.read_text()); d['allowed_platforms'].append('bigquery')
g.write_text(yaml.safe_dump(d,allow_unicode=True,sort_keys=False))
a=root/'access_points.yaml'; p=yaml.safe_load(a.read_text())
p['access_points'].append({'id':'bq-groupe','platform':'bigquery','host':'https://bigquery.googleapis.com','schema':'mkt_gold','owner':'julien.h','freshness':'Quotidienne · 07:00'})
a.write_text(yaml.safe_dump(p,allow_unicode=True,sort_keys=False))`, ws.work);
  git(ws.work, "add", "."); git(ws.work, "commit", "-qm", "BigQuery autorisé et déclaré"); git(ws.work, "push", "origin", "main");
  expect((await request.post(`${ws.api}/sync`)).ok()).toBe(true);
  await relay(page, AUTH_API);
  await page.goto(`${ws.root}/connexions`);

  const bq = row(page, "mkt_gold");
  await expect(bq).toContainText("BigQuery");
  await expect(bq).toContainText("Bientôt dans Atlas");
  await expect(bq.getByRole("button")).toHaveCount(0);
  const option = panel(page).getByRole("combobox", { name: /^Plateforme/ }).getByRole("option", { name: "BigQuery (bientôt)" });
  await expect(option).toHaveCount(1);
  await expect(option).toBeDisabled();
});

test("[S-UI-106-16] liste des points d'accès lente : le panneau attend, puis propose un identifiant libre qui ne change plus ; un identifiant déjà pris retapé est refusé", async ({ page, request }) => {
  const ws = await isolatedDemo(request, AUTH_API);
  await relay(page, AUTH_API);
  // La liste des points d'accès répond quand le test la libère ; les plateformes, tout de suite.
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(`${API}/api/workspaces/${ws.id}/connections`, async (route) => { await held; await route.fallback(); });
  await page.goto(`${ws.root}/connexions`);
  await expect(page.getByRole("status").filter({ hasText: "Chargement du formulaire…" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Identifiant" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ajouter un point d'accès" })).toBeDisabled();

  release();
  await expect(row(page)).toBeVisible();
  const form = panel(page);
  const id = form.getByRole("textbox", { name: "Identifiant" });
  // dbx-fr est déjà déclaré : la première entité libre est nordis-de, dès le premier affichage.
  await expect(id).toHaveValue("dbx-de");
  await expect(form.getByRole("combobox", { name: "Entité" })).toHaveValue("nordis-de");
  await expect(page.getByRole("button", { name: "Ajouter un point d'accès" })).toBeEnabled();

  await id.fill("dbx-fr");
  await form.getByRole("textbox", { name: "Hôte" }).fill(FAKE_DATABRICKS);
  await form.getByRole("textbox", { name: "SQL warehouse" }).fill("abc123");
  await form.getByRole("textbox", { name: "Schéma" }).fill("gold.finance");
  await form.getByRole("button", { name: "Tester la connexion" }).click();
  await expect(form.getByRole("alert").filter({ hasText: "déjà déclaré" })).toContainText("« dbx-fr » est déjà déclaré : s'y connecter depuis la liste.");
  await expect(id).toHaveValue("dbx-fr");
  await expect(form.getByRole("textbox", { name: "Hôte" })).toHaveValue(FAKE_DATABRICKS);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

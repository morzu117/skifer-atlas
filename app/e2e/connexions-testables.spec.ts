import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, type Page, type APIRequestContext } from "@playwright/test";
import { FAKE_DATABRICKS } from "./demo";
import { AUTH_API, isolatedDemo, relay, python, git, test } from "./isolation";

const row = (page: Page) => page.getByRole("row").filter({ hasText: "gold.finance" });
async function configure(request: APIRequestContext, data = {}) {
  expect((await request.post(`${FAKE_DATABRICKS}/__test__/configure`, { data })).ok()).toBe(true);
}
async function authorize(page: Page, name = "Se connecter à Databricks · dbx-fr") {
  const opened = page.waitForEvent("popup");
  await row(page).getByRole("button", { name }).click();
  const popup = await opened;
  await expect(popup.getByText(/Connexion réussie/)).toBeVisible();
  await popup.close();
}
test.afterEach(async ({ request }) => { await configure(request); });

test("[S-0008-05] Échec OAuth : champ masqué, vidé avant réponse, token personnel sans fuite", async ({ page, request, context }) => {
  const ws = await isolatedDemo(request, AUTH_API);
  await relay(page, AUTH_API);
  await configure(request, { refuse_authorize: true });
  await page.goto(`${ws.root}/connexions`);
  await expect(page.getByLabel("Token personnel Databricks")).toHaveCount(0);
  const opened = page.waitForEvent("popup");
  await row(page).getByRole("button", { name: "Se connecter à Databricks · dbx-fr" }).click();
  const popup = await opened;
  await expect(row(page).getByRole("alert")).toContainText("access_denied");
  await popup.close();
  await row(page).getByRole("button", { name: "Utiliser un token personnel" }).click();
  const input = page.getByLabel("Token personnel Databricks");
  await expect(input).toHaveAttribute("type", "password");
  await expect(input).toHaveAttribute("autocomplete", "off");
  const token = `dapi-factice-${crypto.randomUUID()}`;
  await input.fill(token);
  // Retenir la réponse permet de vérifier la valeur avant le démontage du formulaire.
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const bodies: Promise<string>[] = [];
  page.on("response", response => {
    if (response.url().includes("/api/") && response.request().method() !== "OPTIONS") bodies.push(response.text());
  });
  await page.route(`**/api/workspaces/${ws.id}/connections/dbx-fr/token`, async route => {
    expect(route.request().postDataJSON()).toEqual({ token });
    await gate;
    const response = await route.fetch({ url: `${ws.api}/connections/dbx-fr/token` });
    await route.fulfill({ response });
  });
  try {
    await page.getByRole("button", { name: "Ranger dans le coffre" }).click();
    await expect(input).toHaveValue("");
  } finally { release(); }
  await expect(row(page).getByRole("cell", { name: /^Connecté\s*·\s*token personnel$/ })).toBeVisible();
  for (const path of ["connections", "connections/dbx-fr/status"]) {
    const response = await request.get(`${ws.api}/${path}`);
    expect(response.ok()).toBe(true);
    expect(await response.text()).not.toContain(token);
  }
  await page.reload();
  await expect(row(page)).toContainText("token personnel");
  const dom = await page.evaluate(() => [document.documentElement.outerHTML, ...Array.from(document.querySelectorAll("input,textarea"), el => (el as HTMLInputElement).value)].join("\n"));
  expect(dom).not.toContain(token);
  expect(JSON.stringify(await context.storageState({ indexedDB: true }))).not.toContain(token);
  expect(await page.evaluate(() => JSON.stringify(sessionStorage))).not.toContain(token);
  expect((await Promise.all(bodies)).join("\n")).not.toContain(token);
});

test("[S-0008-02] Deux espaces gardent des accès indépendants pour dbx-fr", async ({ page, request }) => {
  const first = await isolatedDemo(request, AUTH_API);
  const second = await isolatedDemo(request, AUTH_API);
  await relay(page, AUTH_API);
  for (const ws of [first, second]) {
    await page.goto(`${ws.root}/connexions`);
    await authorize(page);
    await expect(row(page)).toContainText("Connecté");
  }
  await page.goto(`${first.root}/connexions`);
  await row(page).getByRole("button", { name: "Révoquer Databricks · dbx-fr" }).click();
  await expect(row(page)).toContainText("Jamais connecté");
  await page.goto(`${second.root}/connexions`);
  await expect(row(page).getByRole("cell", { name: /^Connecté\s*·\s*session OAuth$/ })).toBeVisible();
  await row(page).getByRole("button", { name: "Tester Databricks · dbx-fr" }).click();
  await expect(row(page)).toContainText(/Connexion OK · \d+ ms/);
});

for (const refused of [false, true]) {
  test(`[S-0008-04] Jeton expiré : rafraîchissement ${refused ? "refusé" : "accepté"}`, async ({ page, request }) => {
    const ws = await isolatedDemo(request, AUTH_API);
    await configure(request, { expires_in: 0, refuse_refresh: refused });
    await relay(page, AUTH_API);
    await page.goto(`${ws.root}/connexions`);
    await authorize(page);
    await expect(row(page)).toContainText(refused ? "Session expirée" : "Connecté");
    if (!refused) {
      await configure(request);
      await row(page).getByRole("button", { name: "Tester Databricks · dbx-fr" }).click();
      await expect(row(page)).toContainText(/Connexion OK · \d+ ms/);
    } else await expect(row(page).getByRole("button", { name: "Reconnecter Databricks · dbx-fr" })).toBeVisible();
  });
}

test("[S-0008-07] [S-0016-06] Databricks retiré : absent du panneau et déclaration refusée", async ({ page, request }) => {
  const ws = await isolatedDemo(request, AUTH_API);
  python(`import sys,yaml
from pathlib import Path
p=Path(sys.argv[1])/'governance.yaml'
d=yaml.safe_load(p.read_text()); d['allowed_platforms'].remove('databricks')
p.write_text(yaml.safe_dump(d,allow_unicode=True,sort_keys=False))`, ws.work);
  git(ws.work, "add", "."); git(ws.work, "commit", "-qm", "Retrait de Databricks"); git(ws.work, "push", "origin", "main");
  expect((await request.post(`${ws.api}/sync`)).ok()).toBe(true);
  await relay(page, AUTH_API);
  await page.goto(`${ws.root}/connexions`);
  await expect(row(page)).toContainText("Plateforme retirée par le référent");
  await page.getByRole("button", { name: "Ajouter un point d'accès" }).click();
  const platforms = page.getByRole("complementary", { name: "Nouveau point d'accès" }).getByRole("combobox", { name: /Plateforme/ });
  await expect(platforms.getByRole("option", { name: "Snowflake", exact: true })).toHaveCount(1);
  await expect(platforms.getByRole("option", { name: "Databricks", exact: true })).toHaveCount(0);
  const denied = await request.post(`${ws.api}/connections`, { data: { access_point: { id: "dbx-interdit", platform: "databricks", host: FAKE_DATABRICKS, warehouse_id: "abc123", owner: "julien.h" }, justification: "Plateforme interdite" } });
  expect(denied.status()).toBe(422);
  expect(await denied.json()).toMatchObject({ detail: { code: "invalid_access_point", issues: expect.arrayContaining([expect.objectContaining({ code: "platform_not_allowed" })]) } });
});

test("[S-0008-03] [S-0016-09] Tester signale explicitement un hôte injoignable", async ({ page, request }) => {
  const ws = await isolatedDemo(request, AUTH_API);
  // Le port est choisi libre par le système ; aucun service externe n'est contacté.
  python(`import sys,yaml,socket
from pathlib import Path
with socket.socket() as probe:
 probe.bind(('127.0.0.1',0)); port=probe.getsockname()[1]
p=Path(sys.argv[1])/'access_points.yaml'; d=yaml.safe_load(p.read_text())
next(a for a in d['access_points'] if a['id']=='dbx-fr')['host']=f'http://127.0.0.1:{port}'
p.write_text(yaml.safe_dump(d,allow_unicode=True,sort_keys=False))`, ws.work);
  git(ws.work, "add", "."); git(ws.work, "commit", "-qm", "Hôte injoignable"); git(ws.work, "push", "origin", "main");
  expect((await request.post(`${ws.api}/sync`)).ok()).toBe(true);
  expect((await request.put(`${ws.api}/connections/dbx-fr/token`, { data: { token: "dapi-factice-hote-injoignable" } })).ok()).toBe(true);
  await relay(page, AUTH_API); await page.goto(`${ws.root}/connexions`);
  await row(page).getByRole("button", { name: "Tester Databricks · dbx-fr" }).click();
  await expect(row(page).getByRole("status")).toContainText("Hôte injoignable");
  await expect(row(page).getByRole("status")).toContainText("Vérifiez l'adresse et la connexion réseau");
});

test("[S-0016-07] Un double clic sur « Se connecter » ne lance qu'un flux OAuth, sans échec affiché", async ({ page, request }) => {
  const ws = await isolatedDemo(request, AUTH_API);
  await relay(page, AUTH_API);
  // L'autorisation tarde : la fenêtre pendant laquelle un second clic relançait l'OAuth reste ouverte.
  await page.route(`**/api/workspaces/${ws.id}/connections/dbx-fr/authorize`, async route => {
    await new Promise(resolve => setTimeout(resolve, 700));
    await route.fallback();
  });
  let authorizations = 0;
  page.on("request", r => { if (r.method() === "POST" && r.url().endsWith("/connections/dbx-fr/authorize")) authorizations += 1; });
  const popups: Page[] = [];
  page.on("popup", popup => { popups.push(popup); });
  await page.goto(`${ws.root}/connexions`);
  const connect = row(page).getByRole("button", { name: "Se connecter à Databricks · dbx-fr" });
  await connect.dblclick();
  await expect(row(page).getByText("Terminez la connexion dans le navigateur…")).toBeVisible();
  await expect.poll(() => popups.length).toBe(1);
  await expect(popups[0].getByText(/Connexion réussie/)).toBeVisible();
  await popups[0].close();
  await expect(row(page).getByRole("cell", { name: /^Connecté\s*·\s*session OAuth$/ })).toBeVisible();
  expect(authorizations).toBe(1);
  expect(popups).toHaveLength(1);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("[S-0016-07] Page d'autorisation abandonnée : « Annuler » arrête le flux (la page tardive ne connecte rien), « Se connecter » le relance sans port occupé", async ({ page, request }) => {
  const ws = await isolatedDemo(request, AUTH_API);
  await relay(page, AUTH_API);
  // Le premier flux est lancé et écoute, mais la page d'autorisation ne s'ouvre pas (fermée ou bloquée).
  let blocked = true;
  let abandonedUrl = "";
  await page.context().route("**/oidc/v1/authorize**", async route => {
    if (blocked) {
      abandonedUrl = route.request().url();
      await route.abort();
    } else await route.fallback();
  });
  await page.goto(`${ws.root}/connexions`);
  await row(page).getByRole("button", { name: "Se connecter à Databricks · dbx-fr" }).click();
  await expect(row(page).getByText("Terminez la connexion dans le navigateur…")).toBeVisible();
  await row(page).getByRole("button", { name: "Annuler la connexion Databricks · dbx-fr" }).click();
  await expect(row(page).getByRole("button", { name: "Se connecter à Databricks · dbx-fr" })).toBeVisible();
  // La page d'autorisation, restée ouverte, se termine après l'annulation : le serveur n'écoute plus,
  // rien n'est enregistré.
  expect(abandonedUrl).not.toBe("");
  await request.get(abandonedUrl, { failOnStatusCode: false }).then(reply => expect(reply.status()).not.toBe(200), () => undefined);
  await page.reload();
  await expect(row(page).getByRole("cell", { name: "Jamais connecté" })).toBeVisible();
  blocked = false;
  await row(page).getByRole("button", { name: "Se connecter à Databricks · dbx-fr" }).click();
  await expect(row(page).getByRole("cell", { name: /^Connecté\s*·\s*session OAuth$/ })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("[S-0016-08] [S-0016-09] Un test refusé pour accès expiré est expliqué, et « Reconnecter » ramène à la connexion", async ({ page, request }) => {
  const ws = await isolatedDemo(request, AUTH_API);
  // Le faux Databricks ne connaît pas ce token : la plateforme le refuse, l'accès passe à « expiré ».
  expect((await request.put(`${ws.api}/connections/dbx-fr/token`, { data: { token: "dapi-factice-refuse-par-la-plateforme" } })).ok()).toBe(true);
  await relay(page, AUTH_API);
  await page.goto(`${ws.root}/connexions`);
  await expect(row(page)).toContainText("Connecté");
  await row(page).getByRole("button", { name: "Tester Databricks · dbx-fr" }).click();
  const status = row(page).getByRole("status");
  await expect(status).toContainText("Accès expiré.");
  await expect(status).toContainText("Reconnectez-vous depuis Mes connexions, puis réessayez.");
  await expect(status).not.toContainText("identifiants");
  await expect(row(page).getByRole("cell", { name: "Token expiré" })).toBeVisible();
  await authorize(page, "Reconnecter Databricks · dbx-fr");
  await expect(row(page).getByRole("cell", { name: /^Connecté\s*·\s*session OAuth$/ })).toBeVisible();
  await row(page).getByRole("button", { name: "Tester Databricks · dbx-fr" }).click();
  await expect(row(page)).toContainText(/Connexion OK · \d+ ms/);
});

test("[S-0008-10] Un jeton recopié par la plateforme dans son erreur n'arrive jamais à l'écran", async ({ page, request }) => {
  const ws = await isolatedDemo(request, AUTH_API);
  const token = `dapi-factice-recopie-${crypto.randomUUID()}`;
  expect((await request.put(`${ws.api}/connections/dbx-fr/token`, { data: { token } })).ok()).toBe(true);
  await configure(request, { echo_token: true });
  await relay(page, AUTH_API);
  const bodies: Promise<string>[] = [];
  page.on("response", response => { if (response.url().includes("/api/")) bodies.push(response.text().catch(() => "")); });
  await page.goto(`${ws.root}/connexions`);
  await row(page).getByRole("button", { name: "Tester Databricks · dbx-fr" }).click();
  const status = row(page).getByRole("status");
  await expect(status).toContainText("Accès refusé par Databricks");
  await expect(status).toContainText("***");
  expect(await page.evaluate(() => document.documentElement.outerHTML)).not.toContain(token);
  expect((await Promise.all(bodies)).join("\n")).not.toContain(token);
});

test("[S-0016-09] Un accès retiré ailleurs : le test dit « Pas encore connecté » et mène à la connexion, sans le texte brut du serveur", async ({ page, request }) => {
  const ws = await isolatedDemo(request, AUTH_API);
  await relay(page, AUTH_API);
  await page.goto(`${ws.root}/connexions`);
  await authorize(page);
  await expect(row(page).getByRole("cell", { name: /^Connecté\s*·\s*session OAuth$/ })).toBeVisible();
  // L'accès disparaît du coffre pendant que la page reste ouverte.
  expect((await request.delete(`${ws.api}/connections/dbx-fr/token`)).ok()).toBe(true);
  await row(page).getByRole("button", { name: "Tester Databricks · dbx-fr" }).click();
  const status = row(page).getByRole("status");
  await expect(status).toContainText("Pas encore connecté");
  await expect(status).toContainText("Connectez-vous depuis Mes connexions, puis réessayez.");
  await expect(status).not.toContainText("Pas encore connecté à «");
});

test("[S-0016-09] Une plateforme qui répond par une erreur : « La plateforme a refusé la requête » et la consigne, sans le texte brut", async ({ page, request }) => {
  const ws = await isolatedDemo(request, AUTH_API);
  // Un faux entrepôt qui répond HTTP 500 : il tient lieu de la plateforme, sur un port libre local.
  const platform = createServer((incoming, outgoing) => {
    incoming.resume();
    outgoing.writeHead(500, { "Content-Type": "application/json" });
    outgoing.end(JSON.stringify({ message: "texte-brut-de-la-plateforme" }));
  });
  await new Promise<void>((resolve) => platform.listen(0, "127.0.0.1", resolve));
  try {
    const port = (platform.address() as AddressInfo).port;
    python(`import sys,yaml
from pathlib import Path
p=Path(sys.argv[1])/'access_points.yaml'; d=yaml.safe_load(p.read_text())
next(a for a in d['access_points'] if a['id']=='dbx-fr')['host']=f'http://127.0.0.1:{sys.argv[2]}'
p.write_text(yaml.safe_dump(d,allow_unicode=True,sort_keys=False))`, ws.work, String(port));
    git(ws.work, "add", "."); git(ws.work, "commit", "-qm", "Hôte qui répond en erreur"); git(ws.work, "push", "origin", "main");
    expect((await request.post(`${ws.api}/sync`)).ok()).toBe(true);
    expect((await request.put(`${ws.api}/connections/dbx-fr/token`, { data: { token: "dapi-factice-requete-refusee" } })).ok()).toBe(true);
    await relay(page, AUTH_API);
    await page.goto(`${ws.root}/connexions`);
    await row(page).getByRole("button", { name: "Tester Databricks · dbx-fr" }).click();
    const status = row(page).getByRole("status");
    await expect(status).toContainText("La plateforme a refusé la requête");
    await expect(status).toContainText("Vérifiez vos droits sur le schéma et l'entrepôt");
    await expect(status).not.toContainText("texte-brut-de-la-plateforme");
  } finally {
    platform.close();
  }
});

test("[S-0016-09] Le port de retour OAuth occupé : « Une connexion OAuth est déjà en cours » et sa consigne", async ({ page, request }) => {
  const ws = await isolatedDemo(request, AUTH_API);
  await relay(page, AUTH_API);
  // Une autre application tient le port de retour (8020) : la connexion ne peut pas écouter.
  const holder = createServer();
  await new Promise<void>((resolve, reject) => { holder.once("error", reject); holder.listen(8020, "127.0.0.1", resolve); });
  try {
    await page.goto(`${ws.root}/connexions`);
    await row(page).getByRole("button", { name: "Se connecter à Databricks · dbx-fr" }).click();
    const alert = row(page).getByRole("alert");
    await expect(alert).toContainText("Une connexion OAuth est déjà en cours");
    await expect(alert).toContainText("Terminez-la ou fermez-la, puis réessayez.");
    await expect(alert).not.toContainText("Le port 8020 est occupé");
    await expect(row(page).getByRole("cell", { name: "Jamais connecté" })).toBeVisible();
  } finally {
    await new Promise<void>((resolve) => { holder.close(() => resolve()); });
  }
  // Le port libéré, la connexion aboutit.
  await authorize(page);
  await expect(row(page).getByRole("cell", { name: /^Connecté\s*·\s*session OAuth$/ })).toBeVisible();
});

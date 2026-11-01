import { expect, type Page, type APIRequestContext } from "@playwright/test";
import { FAKE_DATABRICKS } from "./demo";
import { AUTH_API, isolatedDemo, relay, python, git, test } from "./isolation";

const row = (page: Page) => page.getByRole("row").filter({ hasText: "gold.finance" });
async function configure(request: APIRequestContext, data = {}) {
  expect((await request.post(`${FAKE_DATABRICKS}/__test__/configure`, { data })).ok()).toBe(true);
}
async function authorize(page: Page) {
  const opened = page.waitForEvent("popup");
  await row(page).getByRole("button", { name: "Se connecter à Databricks · dbx-fr" }).click();
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

test("[S-0008-03] Tester signale explicitement un hôte injoignable", async ({ page, request }) => {
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
});

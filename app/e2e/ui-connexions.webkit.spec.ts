import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { FAKE_DATABRICKS, FAKE_SNOWFLAKE } from "./demo";
import { AUTH_API, isolatedDemo, relay, test } from "./isolation";

// Écran 106 sous WebKit, le moteur de la vue Tauri sous macOS (règle 5) : focus, clavier,
// listes déroulantes natives, fenêtre d'autorisation et formulaires. Même préparation que
// ui-connexions.spec.ts : une copie de Groupe Nordis sur le serveur de julien.h (8793).

const row = (page: Page, schema = "gold.finance") => page.getByRole("row").filter({ hasText: schema });
const panel = (page: Page) => page.getByRole("complementary", { name: "Nouveau point d'accès" });

async function reset(request: APIRequestContext) {
  expect((await request.post(`${FAKE_DATABRICKS}/__test__/configure`, { data: {} })).ok()).toBe(true);
  expect((await request.post(`${FAKE_SNOWFLAKE}/__test__/configure`, { data: {} })).ok()).toBe(true);
}
test.afterEach(async ({ request }) => { await reset(request); });

async function open(page: Page, request: APIRequestContext) {
  const ws = await isolatedDemo(request, AUTH_API);
  await relay(page, AUTH_API);
  await page.goto(`${ws.root}/connexions`);
  await expect(page.getByRole("heading", { level: 1, name: "Mes connexions" })).toBeVisible();
  return ws;
}

test("[S-UI-106-12] WebKit : « Ajouter un point d'accès » au clavier amène le focus sur la plateforme ; les listes natives recalculent l'identifiant", async ({ page, request }) => {
  await open(page, request);
  const add = page.getByRole("button", { name: "Ajouter un point d'accès" });
  await add.focus();
  await page.keyboard.press("Enter");
  const form = panel(page);
  const platform = form.getByRole("combobox", { name: /^Plateforme/ });
  await expect(platform).toBeFocused();
  // Tab passe à l'entité, puis à l'identifiant déduit.
  await page.keyboard.press("Tab");
  const entity = form.getByRole("combobox", { name: "Entité" });
  await expect(entity).toBeFocused();
  await entity.selectOption("nordis-es");
  await expect(form.getByRole("textbox", { name: "Identifiant", exact: true })).toHaveValue("dbx-es");
  await platform.selectOption({ label: "Snowflake" });
  await expect(form.getByRole("textbox", { name: "Identifiant", exact: true })).toHaveValue("snow-es");
  await expect(form.getByRole("combobox", { name: "Authentification" })).toBeVisible();
  // Le choix dans la liste native ne dit rien de la place du focus : on repart de la plateforme.
  await platform.focus();
  await page.keyboard.press("Tab");
  await expect(entity).toBeFocused();
  await page.keyboard.press("Tab");
  const id = form.getByRole("textbox", { name: "Identifiant", exact: true });
  await expect(id).toBeFocused();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("snow-clavier");
  await expect(id).toHaveValue("snow-clavier");
  await entity.selectOption("nordis-fr");
  await expect(id).toHaveValue("snow-clavier");
});

test("[S-UI-106-13] WebKit : se connecter par la fenêtre d'autorisation, tester, recharger, révoquer", async ({ page, request }) => {
  await open(page, request);
  const fr = row(page);
  const opened = page.waitForEvent("popup");
  await fr.getByRole("button", { name: "Se connecter à Databricks · dbx-fr" }).click();
  const popup = await opened;
  await expect(popup.getByText(/Connexion réussie/)).toBeVisible();
  await popup.close();
  await expect(fr.getByRole("cell", { name: /^Connecté\s*·\s*session OAuth$/ })).toBeVisible();
  await fr.getByRole("button", { name: "Tester Databricks · dbx-fr" }).click();
  await expect(fr.getByText(/^Connexion OK · \d+ ms$/)).toBeVisible();
  await page.reload();
  await expect(fr.getByRole("cell", { name: /^Connecté\s*·\s*session OAuth$/ })).toBeVisible();
  // Au clavier : focus sur « Révoquer », Entrée.
  await fr.getByRole("button", { name: "Révoquer Databricks · dbx-fr" }).focus();
  await page.keyboard.press("Enter");
  await expect(fr.getByRole("cell", { name: "Jamais connecté" })).toBeVisible();
  await page.reload();
  await expect(fr.getByRole("cell", { name: "Jamais connecté" })).toBeVisible();
});

test("[S-UI-106-14] WebKit : connexion SSO Snowflake d'une ligne envoyée avec Entrée depuis le champ ; « Annuler » referme le formulaire", async ({ page, request }) => {
  await open(page, request);
  const de = row(page, "FIN_GOLD.PUBLIC");
  await de.getByRole("button", { name: "Se connecter à Snowflake · snow-de" }).click();
  await de.getByRole("button", { name: "Annuler" }).click();
  await expect(de.getByLabel("Identifiant Snowflake")).toHaveCount(0);
  await de.getByRole("button", { name: "Se connecter à Snowflake · snow-de" }).click();
  const user = de.getByLabel("Identifiant Snowflake");
  await user.click();
  await page.keyboard.type("anna@nordis.example");
  await page.keyboard.press("Enter");
  await expect(de.getByRole("cell", { name: /^Connecté ?· ?session SSO$/ })).toBeVisible();
  await de.getByRole("button", { name: "Révoquer Snowflake · snow-de" }).click();
  await expect(de.getByRole("cell", { name: "Jamais connecté" })).toBeVisible();
});

test("[S-UI-106-15] WebKit : panneau, champs verrouillés pendant l'OAuth puis libérés par « Annuler la connexion »", async ({ page, request }) => {
  await open(page, request);
  const form = panel(page);
  await form.getByRole("textbox", { name: "Hôte" }).fill(FAKE_DATABRICKS);
  await form.getByRole("textbox", { name: "SQL warehouse" }).fill("abc123");
  await page.context().route("**/oidc/v1/authorize**", (route) => route.abort());
  await form.getByRole("button", { name: "S'authentifier avec OAuth" }).click();
  await expect(form.getByText("Terminez la connexion dans le navigateur : l'état se met à jour ici.")).toBeVisible();
  await expect(form.getByRole("textbox", { name: "Hôte" })).toBeDisabled();
  await form.getByRole("button", { name: "Annuler la connexion" }).click();
  await expect(form.getByRole("textbox", { name: "Hôte" })).toBeEnabled();
  await expect(form.getByRole("textbox", { name: "Hôte" })).toHaveValue(FAKE_DATABRICKS);
  await expect(form.getByRole("alert")).toHaveCount(0);
  await page.context().unrouteAll({ behavior: "ignoreErrors" });
});

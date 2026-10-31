import { expect, test, type Page } from "@playwright/test";
import { ensureNordis, FAKE_DATABRICKS, seriousViolations } from "./demo";

// Plan 0016 de bout en bout, sur l'espace de démonstration (anna.k) : dbx-fr pointe vers
// le faux Databricks (examples/points-acces-nordis.py), dont l'OAuth s'ouvre dans une
// fenêtre du navigateur et revient sur le serveur local (127.0.0.1:8020).
test.describe.configure({ mode: "serial" });

const CONNECTIONS = "/#/w/groupe-nordis/connexions";

test.beforeAll(async ({ request }) => {
  await ensureNordis(request);
});

/** Ni jeton d'accès ni jeton de rafraîchissement dans la page ou le stockage (critère 5). */
async function expectNoSecret(page: Page) {
  const seen = await page.evaluate(() => [document.documentElement.outerHTML, JSON.stringify(localStorage), JSON.stringify(sessionStorage)].join("\n"));
  expect(seen).not.toMatch(/at-secret|rt-secret/);
}

/** Clique, puis termine l'OAuth dans la fenêtre ouverte comme dans le navigateur du système. */
async function authorizeIn(page: Page, click: () => Promise<void>) {
  const popup = page.waitForEvent("popup");
  await click();
  const window = await popup;
  await expect(window.getByText(/Connexion réussie/)).toBeVisible();
  await window.close();
}

test("liste, se connecter par OAuth, tester, révoquer (critères 1, 2, 3, 5 et 6)", async ({ page }) => {
  await page.goto(CONNECTIONS);
  await expect(page.getByRole("heading", { level: 1, name: "Mes connexions" })).toBeVisible();
  const table = page.getByRole("table", { name: "Points d'accès de l'espace" });
  const fr = table.getByRole("row").filter({ hasText: "gold.finance" });
  await expect(fr).toContainText("Claire M.");
  await expect(fr).toContainText("Quotidienne · 06:10");
  await expect(fr).toContainText("Jamais connecté");
  const de = table.getByRole("row").filter({ hasText: "FIN_GOLD.PUBLIC" });
  await expect(de).toContainText("Snowflake");
  await expect(de).toContainText("Bientôt dans Atlas");
  await expect(page.getByLabel(/token/i)).toHaveCount(0);
  expect(await seriousViolations(page)).toEqual([]);

  await authorizeIn(page, () => fr.getByRole("button", { name: "Se connecter à Databricks · dbx-fr" }).click());
  await expect(fr.getByRole("cell", { name: /^Connecté ?· ?session OAuth$/ })).toBeVisible();
  await expectNoSecret(page);

  await fr.getByRole("button", { name: "Tester Databricks · dbx-fr" }).click();
  await expect(fr.getByText(/^Connexion OK · \d+ ms$/)).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);

  await fr.getByRole("button", { name: "Révoquer Databricks · dbx-fr" }).click();
  await expect(fr).toContainText("Jamais connecté");
  await expect(fr.getByRole("button", { name: "Se connecter à Databricks · dbx-fr" })).toBeVisible();
  await expectNoSecret(page);
});

test("nouveau point d'accès : OAuth et test avant de le proposer", async ({ page }) => {
  await page.goto(CONNECTIONS);
  await page.getByRole("button", { name: "Ajouter un point d'accès" }).click();
  const panel = page.getByRole("complementary", { name: "Nouveau point d'accès" });
  const platform = panel.getByRole("combobox", { name: /Plateforme/ });
  await expect(platform).toBeFocused();
  await expect(platform.getByRole("option", { name: "Snowflake (bientôt)" })).toBeDisabled();
  await expect(panel.getByRole("combobox", { name: "Entité" })).toHaveValue("nordis-de");
  await expect(panel.getByRole("textbox", { name: "Identifiant" })).toHaveValue("dbx-de");
  await panel.getByRole("textbox", { name: "Hôte" }).fill(FAKE_DATABRICKS);
  await panel.getByRole("textbox", { name: "SQL warehouse" }).fill("abc123");
  await panel.getByRole("textbox", { name: "Schéma" }).fill("gold.finance");

  await authorizeIn(page, () => panel.getByRole("button", { name: "S'authentifier avec OAuth" }).click());
  await expect(panel.getByText("Connecté : le token est rangé dans votre coffre, sous dbx-de.")).toBeVisible();
  await panel.getByRole("button", { name: "Tester la connexion" }).click();
  await expect(panel.getByText(/^Connexion OK · \d+ ms$/)).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);

  await panel.getByRole("textbox", { name: "Justification" }).fill("Point d'accès de nordis-de.");
  await panel.getByRole("button", { name: "Proposer le point d'accès" }).click();
  await expect(panel.getByText(/^Proposition n° \d+ ouverte\./)).toBeVisible();
  await expectNoSecret(page);
  await panel.getByRole("link", { name: "Voir la proposition" }).click();
  await expect(page).toHaveURL(/#\/w\/groupe-nordis\/propositions\?n=\d+&status=open&domain=tous$/);
  await expect(page.getByRole("heading", { name: /dbx-de/ }).first()).toBeVisible();
});

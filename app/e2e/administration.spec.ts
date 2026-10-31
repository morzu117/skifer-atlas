import { expect, test, type Page } from "@playwright/test";
import { API, demoRemote, seriousViolations } from "./demo";

// Plan 0017 de bout en bout : julien.h, seul référent de Groupe Nordis, sur son propre
// serveur et son propre dépôt de démonstration. Ses fusions de gouvernance ne touchent
// donc pas l'espace des autres scénarios.
test.describe.configure({ mode: "serial" });

const JULIEN = "http://127.0.0.1:8795";
const ADMIN = "/#/w/groupe-nordis/administration";

test.beforeAll(async ({ request }) => {
  const listed = (await (await request.get(`${JULIEN}/api/workspaces`)).json()) as { id: string }[];
  if (listed.some((ws) => ws.id === "groupe-nordis")) return;
  const joined = await request.post(`${JULIEN}/api/workspaces/join`, { data: { remote_url: demoRemote() } });
  if (!joined.ok()) throw new Error(await joined.text());
});

/** L'app parle au serveur de julien.h : ses requêtes sont relayées vers son port. */
async function asJulien(page: Page) {
  await page.route(`${API}/**`, async (route) => {
    const response = await route.fetch({ url: route.request().url().replace(API, JULIEN) });
    await route.fulfill({ response });
  });
}

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" }); // relevés de la coque encore en vol
});

const domains = (page: Page) => page.getByRole("region", { name: "Domaines métier" });
const save = (page: Page) => page.getByRole("button", { name: /^Enregistrer et/ });

test("référent seul : bandeau, domaine sans référent, enregistrement fusionné (critères 2, 3, 6 et 8)", async ({ page }) => {
  await asJulien(page);
  await page.goto(ADMIN);
  await expect(page.getByRole("heading", { level: 1, name: "Administration — Groupe Nordis" })).toBeVisible();
  await expect(page.getByText("Vous êtes le seul référent de l'espace")).toBeVisible();
  await expect(domains(page).getByText(/^Aucun référent · \d+ KPI$/)).toHaveCount(1); // Marketing
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(save(page)).toHaveText("Enregistrer et fusionner");
  expect(await seriousViolations(page)).toEqual([]);

  const canonical = page.getByRole("spinbutton", { name: "Canonique (min 1)" });
  await canonical.fill("0");
  await expect(page.getByText("Au moins 1.")).toBeVisible();
  await expect(save(page)).toBeDisabled();
  await canonical.fill("3");

  await page.getByRole("button", { name: "Domaine", exact: true }).click();
  const form = page.getByRole("group", { name: "Nouveau domaine" });
  await form.getByRole("textbox", { name: /Libellé/ }).fill("Data");
  await expect(form.getByRole("textbox", { name: /Identifiant/ })).toHaveValue("data");
  await form.getByRole("button", { name: "Ajouter le domaine" }).click();
  await expect(domains(page).getByText(/^Aucun référent/)).toHaveCount(2);
  expect(await seriousViolations(page)).toEqual([]);

  await save(page).click();
  await expect(page.getByText(/Paramètres enregistrés : proposition n° \d+ fusionnée sans revue\./)).toBeVisible();
  // Relu sur la branche principale : le domaine est là, et le formulaire n'a plus rien à enregistrer.
  await expect(domains(page).getByText("Data", { exact: true })).toBeVisible();
  await expect(canonical).toHaveValue("3");
  await expect(save(page)).toBeDisabled();
});

test("deuxième référent : le bandeau disparaît, la suite passe par une revue (critère 8)", async ({ page }) => {
  await asJulien(page);
  await page.goto(ADMIN);
  await page.getByRole("button", { name: "Modifier Claire M." }).click();
  const form = page.getByRole("group", { name: "Membre Claire M." });
  await form.getByRole("combobox", { name: "Rôle" }).selectOption("referent");
  await form.getByRole("checkbox", { name: "Finance" }).uncheck(); // aucun domaine : tout l'espace
  await form.getByRole("button", { name: "Appliquer" }).click();
  await save(page).click();
  await expect(page.getByText(/fusionnée sans revue/)).toBeVisible();

  await expect(page.getByText("Vous êtes le seul référent de l'espace")).toHaveCount(0);
  await expect(page.getByText(/Require review from Code Owners/)).toBeVisible();
  await page.getByRole("checkbox", { name: "BigQuery" }).check();
  await expect(save(page)).toHaveText("Enregistrer et créer la proposition");
  await save(page).click();
  await expect(page.getByText(/Proposition n° \d+ ouverte : elle attend la revue d'un autre référent\./)).toBeVisible();
  await page.getByRole("link", { name: "Voir la proposition" }).click();
  await expect(page).toHaveURL(/#\/w\/groupe-nordis\/propositions\?n=\d+&status=open&domain=tous$/);
  await expect(page.getByRole("heading", { name: /Gouvernance de l'espace/ }).first()).toBeVisible();
});

test("Synchroniser met à jour la date et l'index (critère 7)", async ({ page }) => {
  await asJulien(page);
  await page.goto(ADMIN);
  const repository = page.getByRole("region", { name: "Dépôt Git de l'espace" });
  await repository.getByRole("button", { name: "Synchroniser" }).click();
  await expect(repository.getByRole("status")).toHaveText(/Synchronisé · index reconstruit\.|Déjà à jour avec le dépôt distant\./);
  await expect(repository.getByText(/^à l'instant · index à jour$/)).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});

import { expect, test } from "@playwright/test";
import { ensureNordis, seriousViolations } from "./demo";

// Plans 0005 et 0012 : ce que l'écran dit quand l'adresse ouverte ne mène à rien.

test.beforeAll(async ({ request }) => {
  await ensureNordis(request);
});

test("[S-0005-09] un espace absent du registre renvoie à l'accueil, avec un message", async ({ page }) => {
  await page.goto("/#/w/espace-inconnu/catalogue");
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByRole("heading", { name: "Vos espaces de travail" })).toBeVisible();
  await expect(page.getByText("L'espace « espace-inconnu » n'est pas dans votre registre local.")).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);

  // Le message disparaît dès qu'on ouvre un espace du registre.
  await page.getByRole("link", { name: /Groupe Nordis/ }).first().click();
  await expect(page).toHaveURL(/#\/w\/groupe-nordis\//);
  await expect(page.getByText("n'est pas dans votre registre local")).toHaveCount(0);
});

test("[S-0012-08] une fiche inexistante affiche « Fiche introuvable » et une erreur traduite, sans écran blanc", async ({ page }) => {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  await page.goto("/#/w/groupe-nordis/fiche/document-inexistant");
  await expect(page.getByRole("heading", { level: 1, name: "Fiche introuvable" })).toBeVisible();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("alert")).not.toContainText(/Traceback|\{"detail"|undefined/);
  await expect(page.getByRole("link", { name: "Catalogue", exact: true }).first()).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
  expect(failures).toEqual([]);
});

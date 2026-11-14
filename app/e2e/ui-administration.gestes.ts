import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { isolatedDemo, relay } from "./isolation";

// Écran 107 (Administration), gestes réels partagés entre Chromium (ui-administration.spec.ts)
// et WebKit (ui-administration.webkit.spec.ts), le moteur de la vue Tauri sous macOS.
// julien.h, seul référent de l'espace de démonstration, sur son propre serveur (8795) : chaque
// scénario a sa copie isolée de Groupe Nordis, et ses enregistrements sont fusionnés sans revue.
// Oracle : maquette 10.7, guide 10.7, brief 5 et 10.7, plans 0017 et 0023, ADR 0021, 0027, 0043.

export const JULIEN = "http://127.0.0.1:8795";

export const save = (page: Page) => page.getByRole("button", { name: /^Enregistrer et/ });
export const nav = (page: Page) => page.getByRole("navigation", { name: "Navigation de l'espace" });
export const domains = (page: Page) => page.getByRole("region", { name: "Domaines métier" });
export const validators = (page: Page) => page.getByRole("region", { name: "Validateurs requis" });
export const platforms = (page: Page) => page.getByRole("region", { name: "Plateformes autorisées" });

/** Ouvre l'Administration d'une copie isolée de Groupe Nordis, en julien.h. */
export async function openAdmin(page: Page, request: APIRequestContext) {
  const ws = await isolatedDemo(request, JULIEN);
  await relay(page, JULIEN);
  await page.goto(`${ws.root}/administration`);
  await expect(page.getByRole("heading", { level: 1, name: "Administration — Groupe Nordis" })).toBeVisible();
  await expect(save(page)).toBeVisible();
  return ws;
}

/** Enregistre (fusion sans revue : référent seul) et attend la relecture des paramètres. */
export async function saveMerged(page: Page) {
  const reread = page.waitForResponse((r) => r.url().endsWith("/admin") && r.request().method() === "GET");
  await save(page).click();
  await expect(page.getByText(/Paramètres enregistrés : proposition n° \d+ fusionnée sans revue\./)).toBeVisible();
  await reread;
  await expect(save(page)).toBeDisabled();
}

/** Plateformes autorisées : la barre d'espace coche et décoche, l'enregistrement persiste. */
export async function platformsByKeyboard(page: Page, request: APIRequestContext) {
  await openAdmin(page, request);
  const bigquery = platforms(page).getByRole("checkbox", { name: "BigQuery" });
  const snowflake = platforms(page).getByRole("checkbox", { name: "Snowflake" });
  await expect(bigquery).not.toBeChecked();
  await expect(snowflake).toBeChecked();
  await bigquery.press("Space");
  await expect(bigquery).toBeChecked();
  await expect(bigquery).toBeFocused();
  await snowflake.press("Space");
  await expect(snowflake).not.toBeChecked();
  await expect(save(page)).toBeEnabled();
  await saveMerged(page);
  await page.reload();
  await expect(platforms(page).getByRole("checkbox", { name: "BigQuery" })).toBeChecked();
  await expect(platforms(page).getByRole("checkbox", { name: "Snowflake" })).not.toBeChecked();
  await expect(platforms(page).getByRole("checkbox", { name: "Databricks" })).toBeChecked();
}

/** Validateurs requis : les flèches du clavier règlent le nombre, sans descendre sous 1. */
export async function validatorsByKeyboard(page: Page, request: APIRequestContext) {
  await openAdmin(page, request);
  const canonical = validators(page).getByRole("spinbutton", { name: "Canonique (min 1)" });
  await expect(canonical).toHaveValue("2");
  await canonical.press("ArrowUp");
  await expect(canonical).toHaveValue("3");
  await canonical.press("ArrowDown");
  await canonical.press("ArrowDown");
  await canonical.press("ArrowDown"); // min 1 : la flèche s'arrête à 1
  await expect(canonical).toHaveValue("1");
  await expect(save(page)).toBeEnabled();
  // 0 saisi au clavier : refusé, sans enregistrement possible (plan 0017, critère 3).
  await canonical.press("Backspace");
  await canonical.pressSequentially("0");
  await expect(canonical).toHaveAccessibleDescription(/Au moins 1\./);
  await expect(save(page)).toBeDisabled();
  await canonical.press("Backspace");
  await canonical.pressSequentially("1");
  await expect(save(page)).toBeEnabled();
  await saveMerged(page);
  await page.reload();
  await expect(validators(page).getByRole("spinbutton", { name: "Canonique (min 1)" })).toHaveValue("1");
}

/** Confirmation de sortie (ADR 0043) : focus sur « Annuler », Tab enfermé, Échap reste. */
export async function leaveConfirmationByKeyboard(page: Page, request: APIRequestContext) {
  const ws = await openAdmin(page, request);
  const bigquery = platforms(page).getByRole("checkbox", { name: "BigQuery" });
  await bigquery.check();
  const propositions = nav(page).getByRole("link", { name: /^Propositions/ });
  await propositions.click();
  const dialog = page.getByRole("alertdialog", { name: "Quitter l'Administration ?" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleDescription(/Les modifications de la gouvernance n'ont pas été enregistrées/);
  const cancel = dialog.getByRole("button", { name: "Annuler" });
  const quit = dialog.getByRole("button", { name: "Quitter sans enregistrer" });
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(quit).toBeFocused();
  await page.keyboard.press("Tab"); // le focus reste dans la question
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(quit).toBeFocused();

  // Échap : on reste, brouillon intact, focus rendu au lien cliqué.
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`#/w/${ws.id}/administration$`));
  await expect(bigquery).toBeChecked();
  await expect(propositions).toBeFocused();

  // Entrée sur « Quitter sans enregistrer » : la vue demandée s'ouvre.
  await propositions.click();
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Propositions" })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`#/w/${ws.id}/propositions`));
  // Le brouillon est bien abandonné : la gouvernance relue n'autorise pas BigQuery.
  await nav(page).getByRole("link", { name: "Administration" }).click();
  await expect(platforms(page).getByRole("checkbox", { name: "BigQuery" })).not.toBeChecked();
}

/** « + Domaine » : référent et validateur cochés au clavier, ajouté, enregistré, relu. */
export async function domainWithReferent(page: Page, request: APIRequestContext) {
  await openAdmin(page, request);
  await domains(page).getByRole("button", { name: "Domaine", exact: true }).click();
  const form = page.getByRole("group", { name: "Nouveau domaine" });
  const label = form.getByRole("textbox", { name: /Libellé/ });
  await label.click();
  await label.pressSequentially("Achats");
  await expect(form.getByRole("textbox", { name: /Identifiant/ })).toHaveValue("achats");
  await form.getByRole("group", { name: "Référents" }).getByRole("checkbox", { name: "Marc D." }).press("Space");
  await form.getByRole("group", { name: "Validateurs" }).getByRole("checkbox", { name: "Marc D." }).press("Space");
  await form.getByRole("group", { name: "Validateurs" }).getByRole("checkbox", { name: "Claire M." }).press("Space");
  await form.getByRole("button", { name: "Ajouter le domaine" }).press("Enter");
  await expect(form).toHaveCount(0);
  const row = domains(page).getByRole("listitem").filter({ hasText: "Achats" });
  await expect(row).toContainText(/Référent Marc D\. · 2 validateurs · 0 KPI/);
  await expect(row).not.toContainText("Aucun référent");
  await saveMerged(page);
  await page.reload();
  await expect(domains(page).getByRole("listitem").filter({ hasText: "Achats" })).toContainText(/Référent Marc D\. · 2 validateurs/);
}

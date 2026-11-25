import { existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { seriousViolations } from "./demo";
import { test, trackWorkspace } from "./isolation";

// Issue #214 (ADR 0067) : un espace enregistré dont le dossier local ou son atlas.yaml a
// disparu ne s'ouvre pas, mais l'écran le dit (« Dossier local introuvable ») au lieu de
// renvoyer à l'accueil comme un espace inconnu. L'accueil le liste toujours ; une fois le
// dossier restauré, « Réessayer » rouvre l'espace sans recharger.

const DATA = process.env.ATLAS_E2E_DATA!;
const TITLE = "Dossier local introuvable";
const TEXT = "Le dossier de cet espace ou son fichier atlas.yaml a disparu de ce poste. Restaurez-les, puis réessayez.";
const unique = () => crypto.randomUUID().slice(0, 8);
const cards = (page: Page) => page.getByRole("list", { name: "Espaces" }).getByRole("link");

async function createWorkspace(page: Page, id: string, name: string) {
  trackWorkspace(id);
  await page.goto("/#/");
  await page.getByRole("button", { name: "Créer un espace" }).click();
  const dialog = page.getByRole("dialog", { name: "Créer un espace" });
  await dialog.getByLabel(/^Nom/).fill(name);
  await dialog.getByLabel(/^Identifiant/).fill(id);
  await dialog.getByRole("button", { name: "Créer l'espace" }).click();
  await expect(page).toHaveURL(new RegExp(`#/w/${id}/catalogue$`));
  await expect(page.getByRole("heading", { level: 1, name: "Catalogue" })).toBeVisible();
}

/** Ouvre l'espace par sa carte de l'accueil, comme l'utilisateur. */
async function openFromHome(page: Page, name: string) {
  await page.goto("/#/");
  const card = cards(page).filter({ hasText: name });
  await expect(card).toHaveCount(1);
  await card.click();
}

async function expectMissingCard(page: Page, id: string) {
  const alert = page.getByRole("alert").filter({ hasText: TITLE });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText(TEXT);
  // Pas de renvoi à l'accueil comme pour un espace inconnu, pas de chemin local affiché.
  await expect(page).toHaveURL(new RegExp(`#/w/${id}/catalogue$`));
  await expect(alert).not.toContainText(DATA);
  await expect(page.getByRole("heading", { level: 1, name: "Catalogue" })).toHaveCount(0);
  return alert;
}

test("[S-0005-14] [S-UI-100-11] dossier local d'un espace déplacé : « Dossier local introuvable », l'accueil le liste toujours, « Réessayer » le rouvre une fois restauré", async ({ page }) => {
  const id = `absent-${unique()}`;
  const name = `Absent ${id}`;
  await createWorkspace(page, id, name);
  const folder = join(DATA, "workspaces", id, "repo");
  const aside = `${folder}.deplace`;
  expect(existsSync(join(folder, "atlas.yaml"))).toBe(true);

  renameSync(folder, aside);
  try {
    await openFromHome(page, name);
    const alert = await expectMissingCard(page, id);
    expect(await seriousViolations(page)).toEqual([]);

    // « Réessayer » tant que le dossier manque : la même carte, toujours sur l'espace.
    await alert.getByRole("button", { name: "Réessayer" }).click();
    await expectMissingCard(page, id);

    // Le sélecteur d'espace (nom inconnu : l'identifiant) ramène à l'accueil, qui liste toujours l'espace.
    await page.getByRole("link", { name: new RegExp(`Espace\\s*${id}`) }).click();
    await expect(page).toHaveURL(/#\/$/);
    await expect(cards(page).filter({ hasText: name })).toHaveCount(1);
    await cards(page).filter({ hasText: name }).click();
    await expectMissingCard(page, id);
  } finally {
    if (existsSync(aside)) renameSync(aside, folder);
  }

  // Dossier restauré : « Réessayer » rouvre le catalogue sans recharger la page.
  await page.getByRole("alert").filter({ hasText: TITLE }).getByRole("button", { name: "Réessayer" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Catalogue" })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: TITLE })).toHaveCount(0);
});

test("[S-0005-14] [S-UI-100-12] fichier atlas.yaml seul retiré du dossier : même carte « Dossier local introuvable », puis l'espace rouvre une fois le fichier remis", async ({ page }) => {
  const id = `sans-meta-${unique()}`;
  const name = `Sans meta ${id}`;
  await createWorkspace(page, id, name);
  const meta = join(DATA, "workspaces", id, "repo", "atlas.yaml");
  const aside = `${meta}.deplace`;

  renameSync(meta, aside);
  try {
    await openFromHome(page, name);
    await expectMissingCard(page, id);
  } finally {
    if (existsSync(aside)) renameSync(aside, meta);
  }

  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Catalogue" })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: TITLE })).toHaveCount(0);
});

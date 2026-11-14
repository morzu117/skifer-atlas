import { renameSync } from "node:fs";
import { expect } from "@playwright/test";
import { API } from "./demo";
import { isolatedDemo, relay, test, trackWorkspace } from "./isolation";
import { expectScreen, JULIEN, nav, SCREENS, walkHistory, walkSidebar } from "./ui-cadre.gestes";

// Écran 108, cadre commun : barre latérale, navigation entre écrans, sélecteur et changement
// d'espace, synchronisation automatique, retour arrière, fenêtre minimale (lot ui-ecrans).
// L'oracle : guide 1 (principe 5), 3.1 et 6, brief 5.3 et 10.0, plan 0010, ADR 0013 et 0049.
// Ce qui est déjà couvert (clavier, serveur injoignable, compteur, hors ligne, rattachement
// interrompu, garde de sortie) est cité dans docs/tests/inventaire-ui-ecrans.md.

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("[S-UI-108-01] la barre latérale ouvre chaque écran : adresse, titre focalisé, seul élément courant ; rechargement sur le même écran", async ({ page, request }) => {
  const ws = await isolatedDemo(request, JULIEN);
  await relay(page, JULIEN);
  await page.goto(`${ws.root}/catalogue`);
  await expectScreen(page, ws.root, SCREENS[0]);
  await walkSidebar(page, ws.root);

  await nav(page).getByRole("link", { name: /^Connexions/ }).click();
  await expectScreen(page, ws.root, SCREENS[3]);
  await page.reload();
  await expectScreen(page, ws.root, SCREENS[3]);
});

test("[S-UI-108-02] une fiche ouverte depuis le catalogue garde « Catalogue » comme élément courant", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await page.goto(`${ws.root}/catalogue`);
  await page.getByRole("table", { name: "Concepts et KPI" }).getByRole("link", { name: "Revenu net", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Revenu net" })).toBeFocused();
  await expect(nav(page).getByRole("link", { name: /^Catalogue/ })).toHaveAttribute("aria-current", "page");
  await nav(page).getByRole("link", { name: /^Catalogue/ }).click();
  await expectScreen(page, ws.root, SCREENS[0]);
});

test("[S-UI-108-03] retour arrière et avance du navigateur entre les écrans, puis depuis l'accueil", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await walkHistory(page, ws.root);
});

test("[S-UI-108-04] changer d'espace : le sélecteur ramène à l'accueil, la carte d'un autre espace remplace le nom, la navigation selon le rôle et le contenu", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await page.goto(`${ws.root}/catalogue`);
  const switcher = page.getByRole("link", { name: /^Espace/ });
  await expect(switcher).toContainText("Groupe Nordis");
  await expect(nav(page).getByRole("link", { name: /^Administration/ })).toHaveCount(0); // anna.k : contributrice
  const table = page.getByRole("table", { name: "Concepts et KPI" });
  await expect(table.getByRole("link", { name: "Revenu net", exact: true })).toBeVisible();

  // Un second espace, le sien, créé depuis l'accueil.
  const id = `ui-bascule-${Date.now().toString(36)}`;
  trackWorkspace(id);
  await switcher.click();
  await expect(page.getByRole("heading", { level: 1, name: "Vos espaces de travail" })).toBeFocused();
  await page.getByRole("button", { name: "Créer un espace" }).click();
  const dialog = page.getByRole("dialog", { name: "Créer un espace" });
  await dialog.getByLabel(/^Nom/).fill("Atelier Bascule");
  await dialog.getByLabel(/^Identifiant/).fill(id);
  await dialog.getByRole("button", { name: "Créer l'espace" }).click();
  await expect(page).toHaveURL(new RegExp(`#/w/${id}/catalogue$`));

  await page.getByRole("link", { name: /^Espace/ }).click();
  await page.getByRole("list", { name: "Espaces" }).getByRole("link").filter({ hasText: "Atelier Bascule" }).click();
  await expect(page.getByRole("link", { name: /^Espace/ })).toContainText("Atelier Bascule");
  await expect(nav(page).getByRole("link", { name: /^Administration/ })).toBeVisible(); // référente de son espace
  await expect(page.getByRole("link", { name: "Revenu net", exact: true })).toHaveCount(0); // rien ne traverse
  await nav(page).getByRole("link", { name: /^Propositions/ }).click();
  await expect(page).toHaveURL(new RegExp(`#/w/${id}/propositions`));
  await expect(page.getByRole("link", { name: /Revenu net/ })).toHaveCount(0);
});

test("[S-UI-108-05] dépôt distant injoignable à l'ouverture : un signal discret, qui ne revient pas à chaque changement d'écran", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  renameSync(ws.remote, `${ws.remote}.absent`); // le dépôt distant disparaît (réseau, droits…)
  try {
    await page.goto(`${ws.root}/catalogue`);
    await expect(page.getByRole("heading", { level: 1, name: "Catalogue" })).toBeVisible();
    const signal = page.getByRole("status").filter({ hasText: /Dépôt momentanément inaccessible|La synchronisation n’a pas abouti/ });
    await expect(signal).toBeVisible({ timeout: 10_000 });
    // Les lectures continuent sur la copie locale (ADR 0049).
    await expect(page.getByRole("table", { name: "Concepts et KPI" }).getByRole("link", { name: "Revenu net", exact: true })).toBeVisible();
    await nav(page).getByRole("link", { name: /^Propositions/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Propositions" })).toBeFocused();
    await expect(signal).toHaveCount(0);
    // Retour à l'écran d'origine : le signal ne doit pas revenir (ADR 0049).
    await nav(page).getByRole("link", { name: /^Catalogue/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Catalogue" })).toBeFocused();
    await expect(signal).toHaveCount(0);
  } finally {
    renameSync(`${ws.remote}.absent`, ws.remote);
  }
});

test("[S-UI-108-06] la barre latérale montre l'utilisateur courant : initiales, nom et rôle", async ({ page, request }) => {
  // Guide 3.1 : « utilisateur courant en bas (avatar initiales sur --atlas-mint, nom, rôle) » ;
  // maquettes 10.4 à 10.7 : « JH », « Julien H. », « Référent d'annuaire ».
  const ws = await isolatedDemo(request, JULIEN);
  await relay(page, JULIEN);
  await page.goto(`${ws.root}/catalogue`);
  const sidebar = page.getByRole("complementary").filter({ has: nav(page) });
  await expect(sidebar).toContainText("Référent d'annuaire");
  await expect(sidebar).toContainText("JH");
  await expect(sidebar).toContainText("Julien H.");
});

test("[S-UI-108-07] à la fenêtre minimale (960 × 640), chaque écran tient en largeur : rien ne déborde de la page", async ({ page, request }) => {
  // Guide 6 : « La fenêtre minimale est 960 × 640 » ; « Les tableaux larges défilent
  // horizontalement dans leur conteneur ; rien n'est tronqué. »
  const ws = await isolatedDemo(request, JULIEN);
  await relay(page, JULIEN);
  await page.setViewportSize({ width: 960, height: 640 });
  await page.goto(`${ws.root}/catalogue`);
  const overflow: string[] = [];
  for (const screen of SCREENS) {
    await nav(page).getByRole("link", { name: new RegExp(`^${screen.link}`) }).click();
    await expect(page.getByRole("heading", { level: 1, name: screen.heading })).toBeVisible();
    await expect(page.getByText(/^Chargement/)).toHaveCount(0);
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    if (width > 960) overflow.push(`${screen.link} : ${width} px`);
  }
  expect(overflow).toEqual([]);
});

test("[S-UI-108-10] l'espace en erreur serveur à l'ouverture : bandeau traduit avec une action, « Réessayer » ouvre l'écran", async ({ page, request }) => {
  // ADR 0013, États du serveur : « Une erreur d'API s'affiche dans un bandeau, avec le message
  // traduit et une action. » ; plan 0010, États.
  const ws = await isolatedDemo(request, API);
  const workspace = (url: URL) => url.pathname === `/api/workspaces/${ws.id}`;
  await page.route(workspace, (route) => route.request().method() === "GET"
    ? route.fulfill({ status: 500, contentType: "text/plain", body: "Internal Server Error" }) // exception non rattrapée
    : route.fallback());
  await page.goto(`${ws.root}/catalogue`);
  const banner = page.getByRole("alert");
  await expect(banner).toBeVisible();
  await expect(banner).not.toContainText("Internal Server Error");
  await page.unroute(workspace);
  await banner.getByRole("button", { name: "Réessayer" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Catalogue" })).toBeVisible();
  await expect(banner).toHaveCount(0);
});

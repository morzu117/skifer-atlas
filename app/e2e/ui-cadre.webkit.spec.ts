import { expect } from "@playwright/test";
import { API } from "./demo";
import { isolatedDemo, relay, test } from "./isolation";
import { expectScreen, JULIEN, SCREENS, walkHistory, walkSidebar } from "./ui-cadre.gestes";

// Écrans 100 et 108 sous WebKit, le moteur de la vue Tauri sous macOS (règle 5 du lot
// ui-ecrans) : navigation, historique, panneaux modaux de l'accueil et focus.

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("[S-UI-108-08] WebKit : la barre latérale ouvre chaque écran, le titre reçoit le focus", async ({ page, request }) => {
  const ws = await isolatedDemo(request, JULIEN);
  await relay(page, JULIEN);
  await page.goto(`${ws.root}/catalogue`);
  await expectScreen(page, ws.root, SCREENS[0]);
  await walkSidebar(page, ws.root);
});

test("[S-UI-108-09] WebKit : retour arrière et avance du navigateur entre les écrans", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await walkHistory(page, ws.root);
});

// Navigation au clavier reportée par décision du 13 novembre 2026.
test.fixme("[S-UI-100-10] WebKit : les panneaux de l'accueil gardent le focus, Échap les ferme et rend le focus au bouton", async ({ page, request }) => {
  await isolatedDemo(request, API); // au moins une carte à l'accueil
  await page.goto("/");
  const create = page.getByRole("button", { name: "Créer un espace" });
  await create.click();
  const dialog = page.getByRole("dialog", { name: "Créer un espace" });
  await expect(dialog.getByLabel(/^Nom/)).toBeFocused();
  await page.keyboard.type("Atelier Safari");
  await expect(dialog.getByLabel(/^Identifiant/)).toHaveValue("atelier-safari");
  for (let i = 0; i < 8; i += 1) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((panel) => panel.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(create).toBeFocused();

  const join = page.getByRole("button", { name: "Rejoindre un espace" });
  await join.click();
  const joinDialog = page.getByRole("dialog", { name: "Rejoindre un espace" });
  await joinDialog.getByRole("button", { name: "Cloner et ouvrir" }).click();
  await expect(joinDialog.getByLabel(/^Adresse du dépôt/)).toHaveAccessibleDescription("L'adresse du dépôt est requise.");
  await joinDialog.getByRole("button", { name: "Fermer" }).click();
  await expect(joinDialog).toHaveCount(0);
  await expect(join).toBeFocused();
});

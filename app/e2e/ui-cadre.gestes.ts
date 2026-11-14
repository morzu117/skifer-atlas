import { expect, type Page } from "@playwright/test";

// Gestes du cadre commun (écran 108), partagés par ui-cadre.spec.ts (Chromium) et
// ui-cadre.webkit.spec.ts (WebKit, le moteur de la vue Tauri sous macOS).

export const JULIEN = "http://127.0.0.1:8795"; // référent de l'espace Groupe Nordis

/** Les écrans de la navigation, dans l'ordre de la barre latérale (guide 3.1), avec leur titre. */
export const SCREENS = [
  { link: "Catalogue", path: "catalogue", heading: "Catalogue" },
  { link: "Propositions", path: "propositions", heading: "Propositions" },
  { link: "Comparaison", path: "comparaison", heading: "Comparaison" },
  { link: "Connexions", path: "connexions", heading: "Mes connexions" },
  { link: "Administration", path: "administration", heading: "Administration — Groupe Nordis" },
] as const;

export const nav = (page: Page) => page.getByRole("navigation", { name: "Navigation de l'espace" });

/** L'élément de navigation de l'écran est le seul marqué courant, et le focus est sur le titre. */
export async function expectScreen(page: Page, root: string, screen: (typeof SCREENS)[number]) {
  await expect(page).toHaveURL(new RegExp(`${root.replace(/[/#]/g, "\\$&")}/${screen.path}(\\?.*)?$`));
  await expect(page.getByRole("heading", { level: 1, name: screen.heading })).toBeFocused();
  await expect(nav(page).getByRole("link", { name: new RegExp(`^${screen.link}`) })).toHaveAttribute("aria-current", "page");
  await expect(nav(page).locator('[aria-current="page"]')).toHaveCount(1);
}

/** Clic sur chaque élément de la barre latérale, dans l'ordre, puis retour au catalogue. */
export async function walkSidebar(page: Page, root: string) {
  for (const screen of [...SCREENS.slice(1), SCREENS[0]]) {
    await nav(page).getByRole("link", { name: new RegExp(`^${screen.link}`) }).click();
    await expectScreen(page, root, screen);
  }
}

/** Retour arrière et avance du navigateur entre trois écrans, puis jusqu'à l'accueil. */
export async function walkHistory(page: Page, root: string) {
  const [catalogue, propositions, comparaison] = SCREENS;
  await page.goto(`${root}/catalogue`);
  await expectScreen(page, root, catalogue);
  await nav(page).getByRole("link", { name: /^Propositions/ }).click();
  await expectScreen(page, root, propositions);
  await nav(page).getByRole("link", { name: /^Comparaison/ }).click();
  await expectScreen(page, root, comparaison);
  await page.goBack();
  await expectScreen(page, root, propositions);
  await page.goBack();
  await expectScreen(page, root, catalogue);
  await page.goForward();
  await expectScreen(page, root, propositions);
  // Le sélecteur d'espace mène à l'accueil ; le retour arrière rouvre l'écran quitté.
  await page.getByRole("link", { name: /Espace\s*Groupe Nordis/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Vos espaces de travail" })).toBeFocused();
  await page.goBack();
  await expectScreen(page, root, propositions);
}

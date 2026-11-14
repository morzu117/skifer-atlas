import { expect, type Locator, type Page } from "@playwright/test";
import { ensureNordis } from "./demo";
import { test, trackWorkspace } from "./isolation";

// Écran 10.0 Accueil des espaces : chaque geste de l'utilisateur, fait pour de vrai (lot
// ui-ecrans). L'oracle : maquette 10.0, guide 3.1 et 10.0, brief 10.0, plan 0010, ADR 0013,
// plans 0033 et 0034 pour le rattachement depuis le panneau de création. Les gestes déjà
// couverts par accueil*.spec.ts, rattachement.spec.ts et reinitialisation.spec.ts ne sont pas
// refaits ici (voir docs/tests/inventaire-ui-ecrans.md).
//
// Serveur principal (anna.k). Les espaces créés ici sont retirés du registre à la fin du test.

const unique = (prefix: string) => `${prefix}-${Date.now().toString(36)}`;
const createButton = (page: Page) => page.getByRole("button", { name: "Créer un espace" });
const joinButton = (page: Page) => page.getByRole("button", { name: "Rejoindre un espace" });

/** Les écritures parties vers le serveur, hors synchronisation automatique (ADR 0049). */
function writes(page: Page) {
  const sent: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() === "POST" && path.startsWith("/api/") && !path.endsWith("/sync/auto")) sent.push(path);
  });
  return sent;
}

async function focusInside(dialog: Locator) {
  return dialog.evaluate((panel) => panel.contains(document.activeElement));
}

test.beforeAll(async ({ request }) => {
  await ensureNordis(request);
});

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("[S-UI-100-01] créer un espace : nom vide et identifiant invalide refusés sous leur champ, sans rien envoyer", async ({ page }) => {
  const sent = writes(page);
  await page.goto("/");
  await createButton(page).click();
  const dialog = page.getByRole("dialog", { name: "Créer un espace" });
  await expect(dialog.getByLabel(/^Nom/)).toBeFocused(); // le premier champ reçoit le focus

  await dialog.getByRole("button", { name: "Créer l'espace" }).click();
  await expect(dialog.getByLabel(/^Nom/)).toHaveAccessibleDescription("Le nom est requis.");
  await expect(dialog.getByLabel(/^Identifiant/)).toHaveAccessibleDescription(/De 2 à 64 caractères/);

  await dialog.getByLabel(/^Nom/).fill("Atelier Été");
  await expect(dialog.getByLabel(/^Identifiant/)).toHaveValue("atelier-ete"); // dérivé, sans accents
  await dialog.getByLabel(/^Identifiant/).fill("Atelier!");
  await dialog.getByRole("button", { name: "Créer l'espace" }).click();
  await expect(dialog.getByLabel(/^Nom/)).not.toHaveAttribute("aria-invalid", "true");
  await expect(dialog.getByLabel(/^Identifiant/)).toHaveAccessibleDescription(/minuscules, chiffres et tirets/);

  // Modifié à la main, l'identifiant ne suit plus le nom (ADR 0013, Formulaires).
  await dialog.getByLabel(/^Nom/).fill("Atelier Hiver");
  await expect(dialog.getByLabel(/^Identifiant/)).toHaveValue("Atelier!");
  expect(sent).toEqual([]);
  await expect(dialog).toBeVisible();
});

test("[S-UI-100-02] créer un espace au clavier : Entrée envoie, la carte porte le nom, le rôle, le secteur et les entités, et reste après rechargement", async ({ page }) => {
  const id = unique("ui-atelier");
  trackWorkspace(id);
  await page.goto("/");
  await createButton(page).click();
  const dialog = page.getByRole("dialog", { name: "Créer un espace" });
  await page.keyboard.type("Atelier Bleu");
  await dialog.getByLabel(/^Identifiant/).fill(id);
  await dialog.getByLabel("Secteur").fill("Luxe");
  await dialog.getByLabel("Entités").fill("ab-fr, ab-it");
  await dialog.getByLabel("Entités").press("Enter");

  await expect(page).toHaveURL(new RegExp(`#/w/${id}/catalogue$`));
  await expect(page.getByRole("heading", { level: 1, name: "Catalogue" })).toBeFocused();
  await page.getByRole("link", { name: /Espace\s*Atelier Bleu/ }).click();
  await page.reload();
  const card = page.getByRole("list", { name: "Espaces" }).getByRole("link").filter({ hasText: "Atelier Bleu" });
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("Référent d'annuaire"); // le créateur devient référent (plan 0010)
  await expect(card).toContainText("Luxe · 2 entités · 0 domaine");
  await expect(card).toContainText("AB"); // initiales
  await card.click();
  await expect(page).toHaveURL(new RegExp(`#/w/${id}/catalogue$`));
});

test("[S-UI-100-03] panneaux de création et d'adhésion : Échap et « Fermer » ferment sans rien créer, le focus revient au bouton, Tab reste dans le panneau", async ({ page }) => {
  const sent = writes(page);
  await page.goto("/");
  const cards = page.getByRole("list", { name: "Espaces" }).getByRole("link");
  await expect(cards.filter({ hasText: "Groupe Nordis" }).first()).toBeVisible();
  const before = await cards.count();

  await createButton(page).click();
  const create = page.getByRole("dialog", { name: "Créer un espace" });
  await create.getByLabel(/^Nom/).fill("Abandonné");
  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press("Tab");
    expect(await focusInside(create)).toBe(true);
  }
  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press("Shift+Tab");
    expect(await focusInside(create)).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(create).toHaveCount(0);
  await expect(createButton(page)).toBeFocused();

  await createButton(page).click();
  await expect(create.getByLabel(/^Nom/)).toHaveValue(""); // rien n'est resté du premier essai
  await create.getByRole("button", { name: "Fermer" }).click();
  await expect(create).toHaveCount(0);
  await expect(createButton(page)).toBeFocused();

  await joinButton(page).click();
  const join = page.getByRole("dialog", { name: "Rejoindre un espace" });
  await expect(join.getByLabel(/^Adresse du dépôt/)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(join).toHaveCount(0);
  await expect(joinButton(page)).toBeFocused();
  await joinButton(page).click();
  await join.getByRole("button", { name: "Fermer" }).click();
  await expect(join).toHaveCount(0);
  await expect(joinButton(page)).toBeFocused();

  expect(sent).toEqual([]);
  await expect(cards).toHaveCount(before);
});

test("[S-UI-100-04] rejoindre un espace : adresse vide refusée sur le champ, dépôt introuvable expliqué sans la sortie de git, le panneau reste utilisable", async ({ page }) => {
  const sent = writes(page);
  await page.goto("/");
  await joinButton(page).click();
  const join = page.getByRole("dialog", { name: "Rejoindre un espace" });
  await join.getByRole("button", { name: "Cloner et ouvrir" }).click();
  await expect(join.getByLabel(/^Adresse du dépôt/)).toHaveAccessibleDescription("L'adresse du dépôt est requise.");
  expect(sent).toEqual([]);

  await join.getByLabel(/^Adresse du dépôt/).fill(`/tmp/atlas-depot-introuvable-${Date.now()}.git`);
  await join.getByLabel(/^Adresse du dépôt/).press("Enter");
  const refusal = join.getByRole("alert");
  await expect(refusal).toContainText("Le dépôt n'a pas pu être cloné");
  await expect(refusal).toContainText("Vérifiez l'adresse et vos droits d'accès au dépôt");
  await expect(refusal).not.toContainText(/fatal|does not appear|git clone/i);
  await expect(join.getByLabel(/^Adresse du dépôt/)).toBeEnabled();
  await expect(join.getByRole("button", { name: "Cloner et ouvrir" })).toBeEnabled();
  await expect(page.getByRole("heading", { level: 1, name: "Vos espaces de travail" })).toBeVisible(); // on reste à l'accueil
});

test("[S-UI-100-05] créer un espace avec une adresse refusée : l'espace est créé, le rattachement s'ouvre dans le panneau avec l'adresse, « Ouvrir l'espace » mène au catalogue", async ({ page }) => {
  const id = unique("ui-remote");
  trackWorkspace(id);
  await page.goto("/");
  await createButton(page).click();
  const dialog = page.getByRole("dialog", { name: "Créer un espace" });
  await dialog.getByLabel(/^Nom/).fill("Atelier Distant");
  await dialog.getByLabel(/^Identifiant/).fill(id);
  await dialog.getByLabel("Dépôt distant").fill("https://gitlab.example.invalid/nordis/atelier.git");
  await dialog.getByRole("button", { name: "Créer l'espace" }).click();

  await expect(dialog.getByRole("alert").filter({ hasText: "Espace créé, dépôt distant non rattaché" })).toBeVisible();
  const group = dialog.getByRole("group", { name: "Rattacher un dépôt distant" });
  await expect(group.getByLabel(/Adresse du dépôt vide/)).toHaveValue("https://gitlab.example.invalid/nordis/atelier.git");
  await expect(page.getByText(/Traceback|stderr/)).toHaveCount(0);

  await dialog.getByRole("button", { name: "Ouvrir l'espace" }).click();
  await expect(page).toHaveURL(new RegExp(`#/w/${id}/catalogue$`));
  await expect(page.getByRole("link", { name: /Espace\s*Atelier Distant/ })).toBeVisible();
});

test("[S-UI-100-06] le message « espace absent du registre » se ferme avec « Fermer »", async ({ page }) => {
  await page.goto("/#/w/espace-ui-inconnu/catalogue");
  const notice = page.getByRole("status").filter({ hasText: "L'espace « espace-ui-inconnu » n'est pas dans votre registre local." });
  await expect(notice).toBeVisible();
  await notice.getByRole("button", { name: "Fermer" }).click();
  await expect(notice).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Espaces" })).toBeVisible();
});

test("[S-UI-100-07] la liste des espaces en erreur serveur : bandeau traduit, « Réessayer » la relit", async ({ page }) => {
  const list = (url: URL) => url.pathname === "/api/workspaces";
  await page.route(list, (route) => route.request().method() === "GET"
    ? route.fulfill({ status: 500, contentType: "text/plain", body: "Internal Server Error" }) // exception non rattrapée
    : route.fallback());
  await page.goto("/");
  const banner = page.getByRole("alert");
  await expect(banner).toBeVisible();
  await expect(banner).not.toContainText("Internal Server Error");
  await page.unroute(list);
  await banner.getByRole("button", { name: "Réessayer" }).click();
  await expect(page.getByRole("list", { name: "Espaces" }).getByRole("link").filter({ hasText: "Groupe Nordis" }).first()).toBeVisible();
  await expect(banner).toHaveCount(0);
  // Note fixe du guide 10.0, sous la grille.
  await expect(page.getByText("Vos tokens d'accès sont stockés chiffrés sur cette machine, rangés par espace. Ils ne quittent jamais votre poste.")).toBeVisible();
});

test("[S-UI-100-08] l'en-tête de l'accueil montre l'utilisateur par ses initiales et son nom", async ({ page }) => {
  // Maquette 10.0 : « JH » et « Julien H. » ; guide 10.0 : « En-tête : logo, utilisateur ».
  // anna.k est « Anna K. » dans governance.yaml de Groupe Nordis.
  await page.goto("/");
  await expect(page.getByRole("list", { name: "Espaces" })).toBeVisible();
  const header = page.getByRole("banner");
  await expect(header).toContainText("AK");
  await expect(header).toContainText("Anna K.");
});

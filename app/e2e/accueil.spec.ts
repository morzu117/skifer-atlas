import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { relay } from "./isolation";
import { API, demoRemote, seriousViolations } from "./demo";

// Plan 0010 de bout en bout. Un seul serveur pour tout le fichier : les tests se suivent
// (registre vide, création, adhésion, puis deux cartes).
test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => { await relay(page, "http://127.0.0.1:8791"); });

let bare = "";

test.beforeAll(() => {
  bare = demoRemote();
});

test("[S-0010-02] [S-0010-09] [S-0010-10] registre vide : carte vide, polices locales, accessibilité (critères 2, 9, 10)", async ({ page }) => {
  const external: string[] = [];
  await page.route("**/*", (route) => {
    const { hostname } = new URL(route.request().url());
    if (hostname === "localhost" || hostname === "127.0.0.1") return route.continue();
    external.push(route.request().url());
    return route.abort(); // réseau coupé : rien d'autre que l'app et le serveur local
  });
  await page.goto("/");
  await expect(page.getByText("Aucun espace pour l'instant")).toBeVisible();

  const inter = await page.evaluate(async () => (await document.fonts.load("600 14px Inter")).length);
  const mono = await page.evaluate(async () => (await document.fonts.load('400 13px "JetBrains Mono"')).length);
  expect([inter, mono]).toEqual([1, 1]);
  expect(external).toEqual([]);

  expect(await seriousViolations(page)).toEqual([]);
});

test("[S-0005-01] [S-0010-03] [S-0010-06] créer un espace l'ouvre, un identifiant pris donne l'erreur sous le champ (critères 3, 6)", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Créer un espace" }).click();
  const dialog = page.getByRole("dialog", { name: "Créer un espace" });
  await dialog.getByLabel(/^Nom/).fill("Maison Perrault");
  await expect(dialog.getByLabel(/^Identifiant/)).toHaveValue("maison-perrault");
  await dialog.getByLabel("Secteur").fill("Luxe");
  await dialog.getByLabel("Entités").fill("mp-fr, mp-it");
  expect(await seriousViolations(page)).toEqual([]);
  await dialog.getByRole("button", { name: "Créer l'espace" }).click();

  await expect(page).toHaveURL(/#\/w\/maison-perrault\/catalogue$/);
  await expect(page.getByRole("heading", { name: "Catalogue" })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Navigation de l'espace" });
  await expect(nav.getByRole("link", { name: "Administration" })).toBeVisible(); // créatrice = référente
  expect(await seriousViolations(page)).toEqual([]);

  const switcher = page.getByRole("link", { name: /Espace\s*Maison Perrault/ });
  await switcher.click();
  await expect(page).toHaveURL(/#\/$/);
  await page.getByRole("button", { name: "Créer un espace" }).click();
  await dialog.getByLabel(/^Nom/).fill("Maison Perrault");
  await dialog.getByRole("button", { name: "Créer l'espace" }).click();
  await expect(dialog.getByLabel(/^Identifiant/)).toHaveAccessibleDescription(/Un espace porte déjà cet identifiant/);
});

test("[S-0005-02] [S-0010-04] [S-0010-07] rejoindre le dépôt de démonstration le clone et l'ouvre (critères 4, 7)", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Rejoindre un espace" }).click();
  const dialog = page.getByRole("dialog", { name: "Rejoindre un espace" });
  await dialog.getByLabel(/^Adresse du dépôt/).fill(bare);
  await dialog.getByRole("button", { name: "Cloner et ouvrir" }).click();

  await expect(page).toHaveURL(/#\/w\/groupe-nordis\/catalogue$/);
  await expect(page.getByRole("link", { name: /Espace\s*Groupe Nordis/ })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Navigation de l'espace" });
  await expect(nav.getByRole("link", { name: "Connexions" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Administration" })).toHaveCount(0); // anna.k : contributrice
  await expect(page.getByText("Contributeur")).toBeVisible();
});

test("[S-0010-01] [S-0010-10] deux espaces, deux cartes ; navigation au clavier (critères 1, 10)", async ({ page }) => {
  await page.goto("/");
  const cards = page.getByRole("list", { name: "Espaces" }).getByRole("link");
  await expect(cards).toHaveCount(2);
  const nordis = cards.filter({ hasText: "Groupe Nordis" });
  await expect(nordis).toContainText("Contributeur");
  await expect(nordis).toContainText("Distribution · 3 entités · 4 domaines");
  await expect(nordis).toContainText("4 KPI");
  await expect(nordis).toContainText("3 concepts");
  await expect(nordis).toContainText("Aucune proposition");
  const perrault = cards.filter({ hasText: "Maison Perrault" });
  await expect(perrault).toContainText("Référent d'annuaire");
  await expect(perrault).toContainText("Luxe · 2 entités · 0 domaine");
  expect(await seriousViolations(page)).toEqual([]);

  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press("Tab");
    if (await nordis.evaluate((el) => el === document.activeElement)) break;
  }
  await expect(nordis).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/w\/groupe-nordis\/catalogue$/);
  await expect(page.getByRole("heading", { name: "Catalogue" })).toBeFocused(); // le titre de la vue
  await page.keyboard.press("Shift+Tab"); // dernier lien de la navigation
  await expect(page.getByRole("link", { name: "Connexions" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("link", { name: "Propositions" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Propositions" })).toBeFocused();
  for (let i = 0; i < 5; i += 1) await page.keyboard.press("Shift+Tab"); // Connexions → … → sélecteur
  await expect(page.getByRole("link", { name: /Espace\s*Groupe Nordis/ })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Vos espaces de travail" })).toBeFocused();
});

test("[S-0010-05] serveur arrêté : bandeau, puis Réessayer après redémarrage (critère 5)", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("list", { name: "Espaces" })).toBeVisible();
  await page.route(`${API}/**`, (route) => route.abort("connectionrefused"));
  await page.getByRole("link", { name: /Groupe Nordis/ }).click();
  const banner = page.getByRole("alert").filter({ hasText: "Serveur local injoignable" });
  await expect(banner).toBeVisible();
  await banner.getByRole("button", { name: "Réessayer" }).click();
  await expect(banner).toBeVisible(); // toujours arrêté
  await page.unroute(`${API}/**`);
  await relay(page, "http://127.0.0.1:8791");
  await banner.getByRole("button", { name: "Réessayer" }).click();
  await expect(banner).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Catalogue" })).toBeVisible();
});

// Suivi de la revue globale (issue 146). Ces scénarios ne créent rien sur le serveur : la requête
// d'envoi est retenue par `page.route`, puis résolue à la main avec un espace qui existe déjà.
const SERVER = "http://127.0.0.1:8791";

async function holdPost(page: Page, request: APIRequestContext, path: string, space: string) {
  let release!: () => void;
  let reached!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const arrived = new Promise<void>((resolve) => { reached = resolve; });
  await page.route(`${API}${path}`, async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    reached();
    await gate;
    const spaces = await (await request.get(`${SERVER}/api/workspaces`)).json();
    return route.fulfill({ status: 201, json: spaces.find((s: { id: string }) => s.id === space) });
  });
  return { arrived, release };
}

// Pendant l'envoi : « Fermer » est inactif (`aria-disabled`) mais focalisable, Échap et un clic
// ne ferment pas, et Tab reste dans le panneau (le focus ne passe pas à la page dessous).
async function expectSealed(page: Page, dialog: Locator) {
  const close = dialog.getByRole("button", { name: "Fermer" });
  await expect(close).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Escape");
  await close.click({ force: true }); // Playwright attend un bouton `aria-disabled` : on passe outre
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((panel) => panel.contains(document.activeElement))).toBe(true);
}

test("[S-0005-13] créer un espace : Échap et « Fermer » sont sans effet pendant l'envoi, puis l'espace s'ouvre", async ({ page, request }) => {
  const sending = await holdPost(page, request, "/api/workspaces", "maison-perrault");
  await page.goto("/");
  await page.getByRole("button", { name: "Créer un espace" }).click();
  const dialog = page.getByRole("dialog", { name: "Créer un espace" });
  const name = dialog.getByLabel(/^Nom/);
  await name.fill("Atelier Bleu");
  await dialog.getByRole("button", { name: "Créer l'espace" }).click();
  await sending.arrived;
  await expect(dialog.getByRole("button", { name: "Création…" })).toBeDisabled();

  await expectSealed(page, dialog);
  await name.press("Escape"); // la touche part du champ, qui n'est pas désactivé
  await expectSealed(page, dialog);

  sending.release();
  await expect(page).toHaveURL(/#\/w\/maison-perrault\/catalogue$/);
  await expect(page.getByRole("heading", { name: "Catalogue" })).toBeVisible();
  await expect(dialog).toHaveCount(0);
});

test("[S-0005-13] rejoindre un espace : Échap et « Fermer » sont sans effet pendant le clonage, puis l'espace s'ouvre", async ({ page, request }) => {
  const sending = await holdPost(page, request, "/api/workspaces/join", "groupe-nordis");
  await page.goto("/");
  await page.getByRole("button", { name: "Rejoindre un espace" }).click();
  const dialog = page.getByRole("dialog", { name: "Rejoindre un espace" });
  await dialog.getByLabel(/^Adresse du dépôt/).fill(bare);
  await dialog.getByRole("button", { name: "Cloner et ouvrir" }).click();
  await sending.arrived;
  await expect(dialog.getByText("Clonage du dépôt…")).toBeVisible();

  // Champ et bouton d'envoi désactivés : « Fermer » garde le focus dans le panneau.
  await expect(dialog.getByRole("button", { name: "Fermer" })).toBeFocused();
  await expectSealed(page, dialog);

  sending.release();
  await expect(page).toHaveURL(/#\/w\/groupe-nordis\/catalogue$/);
  await expect(dialog).toHaveCount(0);
});

test("[S-0005-12] registre ou dépôt tenus par un autre processus : le panneau l'explique et reste utilisable", async ({ page }) => {
  const busy = (code: string, message: string) => (route: import("@playwright/test").Route) =>
    route.request().method() === "POST"
      ? route.fulfill({ status: 503, json: { detail: { code, message } } })
      : route.fallback();
  await page.route(`${API}/api/workspaces`, busy("registry_busy", "La liste des espaces est en cours de modification par un autre processus Atlas."));
  await page.route(`${API}/api/workspaces/join`, busy("clone_busy", "Une autre opération tient le dépôt de l'espace."));
  await page.goto("/");

  await page.getByRole("button", { name: "Créer un espace" }).click();
  const create = page.getByRole("dialog", { name: "Créer un espace" });
  await create.getByLabel(/^Nom/).fill("Atelier Bleu");
  await create.getByRole("button", { name: "Créer l'espace" }).click();
  await expect(create).toContainText("Liste des espaces occupée");
  await expect(create).toContainText("Réessayez dans un instant");
  await expect(create.getByRole("button", { name: "Créer l'espace" })).toBeEnabled();
  await create.getByRole("button", { name: "Fermer" }).click();

  await page.getByRole("button", { name: "Rejoindre un espace" }).click();
  const join = page.getByRole("dialog", { name: "Rejoindre un espace" });
  await join.getByLabel(/^Adresse du dépôt/).fill(bare);
  await join.getByRole("button", { name: "Cloner et ouvrir" }).click();
  await expect(join).toContainText("Espace en cours d'utilisation");
  await expect(join).toContainText("Réessayez quand elle aura fini");
  await expect(join.getByRole("button", { name: "Cloner et ouvrir" })).toBeEnabled();
});

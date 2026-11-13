import { expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { API } from "./demo";
import { isolatedDemo, relay, test } from "./isolation";

// Écran 10.4 Propositions : chaque geste de l'utilisateur, fait pour de vrai (lot ui-ecrans).
// L'oracle : maquette 10.4, guide 10.4, brief 10.4, plan 0014, ADR 0013, 0018 et 0043. Les gestes
// déjà couverts par propositions*.spec.ts ne sont pas refaits ici (voir l'inventaire du lot).
//
// Les cinq propositions de démonstration (examples/propositions-nordis.py) : n° 1 nordis-es (from
// scratch, Sofia R.), n° 2 Taux de service v3 (Supply chain, Julien H., prête), n° 3 Revenu net v5
// (Julien H., 1 / 2), n° 4 nordis-fr (Claire M.), n° 5 nordis-de (Anna K., commentée par Claire M.).
// Quatre comptes, quatre serveurs : anna.k (contributrice, serveur principal), claire.m
// (référente Finance), marc.d (validateur Finance et Ventes), julien.h (référent de l'espace).

const CLAIRE = "http://127.0.0.1:8798";
const MARC = "http://127.0.0.1:8797";
const JULIEN = "http://127.0.0.1:8795";

async function joinAs(request: APIRequestContext, server: string, remote: string) {
  const joined = await request.post(`${server}/api/workspaces/join`, { data: { remote_url: remote } });
  expect(joined.status(), await joined.text()).toBe(201);
}

/** Les écritures de l'utilisateur, hors synchronisation automatique de la coque (ADR 0049). */
function writes(page: Page) {
  const sent: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() === "POST" && path.startsWith("/api/") && !path.endsWith("/sync/auto")) sent.push(path);
  });
  return sent;
}

const queue = (page: Page) => page.getByRole("list", { name: "File des propositions" });
const entry = (page: Page, title: string) => queue(page).getByRole("link").filter({ hasText: title });
const selection = (page: Page) => page.getByRole("region", { name: "Proposition sélectionnée" });
const detailTitle = (page: Page) => selection(page).getByRole("heading", { level: 2 });
/** Un vrai clic de souris au centre de l'élément : Playwright refuse `click()` sur un bouton
 * `aria-disabled`, que l'utilisateur, lui, peut cliquer. */
async function mouseClick(page: Page, target: Locator) {
  const box = (await target.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}
const filter = (page: Page, name: "Domaine" | "Statut" | "Entité" | "KPI" | "Auteur") => page.getByRole("combobox", { name });

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" }); // relevés de la coque encore en vol
});

test("[S-UI-104-01] filtre Domaine : « Supply chain » ne garde que ses propositions, survit au rechargement, et le retour arrière rend la file entière", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await page.goto(`${ws.root}/propositions`);
  await expect(filter(page, "Domaine")).toHaveValue("tous"); // anna.k ne valide aucun domaine
  await expect(queue(page).getByRole("link")).toHaveCount(5);

  await filter(page, "Domaine").selectOption({ label: "Supply chain" });
  await expect(queue(page).getByRole("link")).toHaveCount(1);
  await expect(entry(page, "Taux de service · canonique v3")).toHaveAttribute("aria-current", "true");
  await expect(detailTitle(page)).toHaveText("Nouvelle version de Taux de service (v3)");
  await expect(page).toHaveURL(/domain=supply/);

  await page.reload();
  await expect(filter(page, "Domaine")).toHaveValue("supply");
  await expect(queue(page).getByRole("link")).toHaveCount(1);

  await page.goBack();
  await expect(filter(page, "Domaine")).toHaveValue("tous");
  await expect(queue(page).getByRole("link")).toHaveCount(5);
});

test("[S-UI-104-02] filtre Entité : une entité, puis « Canonique », puis « Toutes entités »", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await page.goto(`${ws.root}/propositions`);
  await expect(queue(page).getByRole("link")).toHaveCount(5);

  await filter(page, "Entité").selectOption("nordis-de");
  await expect(queue(page).getByRole("link")).toHaveCount(1);
  await expect(entry(page, "Revenu net · nordis-de")).toBeVisible();
  await expect(detailTitle(page)).toHaveText("Surcharge sur Revenu net — nordis-de");

  await filter(page, "Entité").selectOption({ label: "Canonique" });
  await expect(queue(page).getByRole("link")).toHaveCount(2);
  await expect(entry(page, "Revenu net · canonique v5")).toBeVisible();
  await expect(entry(page, "Taux de service · canonique v3")).toBeVisible();

  await filter(page, "Entité").selectOption({ label: "Toutes entités" });
  await expect(queue(page).getByRole("link")).toHaveCount(5);
});

test("[S-UI-104-03] filtre Statut : Fusionnées sans actions, Fermées vide, Toutes réunit ouvertes et fusionnées", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await page.goto(`${ws.root}/propositions`);
  await expect(queue(page).getByRole("link")).toHaveCount(5);

  // Les points d'accès de la démonstration ont été proposés puis fusionnés.
  await filter(page, "Statut").selectOption({ label: "Fusionnées" });
  await expect(queue(page).getByRole("link").first()).toContainText("Fusionnée");
  await expect(entry(page, "Revenu net · nordis-de")).toHaveCount(0);
  await expect(selection(page).getByText("Fusionnée", { exact: true })).toBeVisible();
  await expect(selection(page).getByRole("button", { name: /Approuver|Demander des changements|Fusionner/ })).toHaveCount(0);

  await filter(page, "Statut").selectOption({ label: "Fermées" });
  await expect(page.getByText("Aucune proposition.", { exact: true })).toBeVisible();
  await expect(queue(page)).toHaveCount(0);

  await filter(page, "Statut").selectOption({ label: "Toutes" });
  await expect(entry(page, "Revenu net · nordis-de")).toHaveCount(1);
  await expect(queue(page).getByRole("link").filter({ hasText: "Fusionnée" }).first()).toBeVisible();
  await page.reload();
  await expect(filter(page, "Statut")).toHaveValue("all");
});

test("[S-UI-104-04] des filtres sans résultat le disent, et le détail invite à choisir", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await page.goto(`${ws.root}/propositions`);
  await expect(queue(page).getByRole("link")).toHaveCount(5);
  await filter(page, "Domaine").selectOption({ label: "Marketing" });
  await expect(page.getByText("Aucune proposition ne correspond à ces filtres.")).toBeVisible();
  await expect(selection(page)).toContainText("Sélectionner une proposition dans la file.");
});

test("[S-UI-104-05] ouvrir une proposition au clic puis au clavier : détail, métadonnées, justification ; rechargement et retour arrière", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await page.goto(`${ws.root}/propositions`);
  await entry(page, "Revenu net · nordis-fr").click();
  await expect(entry(page, "Revenu net · nordis-fr")).toHaveAttribute("aria-current", "true");
  await expect(detailTitle(page)).toHaveText("Surcharge sur Revenu net — nordis-fr");

  // Au clavier : du lien FR au lien suivant de la file, puis Entrée.
  await entry(page, "Revenu net · nordis-fr").focus();
  const links = queue(page).getByRole("link");
  const order = await links.allTextContents();
  const target = order.findIndex((text) => text.includes("Revenu net · nordis-de"));
  const from = order.findIndex((text) => text.includes("Revenu net · nordis-fr"));
  for (let i = from; i < target; i += 1) await page.keyboard.press("Tab");
  for (let i = from; i > target; i -= 1) await page.keyboard.press("Shift+Tab");
  await expect(entry(page, "Revenu net · nordis-de")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(entry(page, "Revenu net · nordis-de")).toHaveAttribute("aria-current", "true");
  await expect(detailTitle(page)).toHaveText("Surcharge sur Revenu net — nordis-de");

  // Métadonnées (guide 10.4) et justification de l'auteur (maquette 10.4).
  const meta = selection(page).locator(".proposal-title");
  await expect(meta).toContainText("Proposée par Anna K.");
  await expect(meta).toContainText("Finance");
  await expect(meta.locator(".mono")).toHaveText(/^\S+$/); // la branche Git, en mono
  const why = selection(page).getByRole("region", { name: "Justification de l'auteur" });
  await expect(why).toContainText("En Allemagne, une commande expédiée est comptabilisée comme revenu");

  await page.reload();
  await expect(detailTitle(page)).toHaveText("Surcharge sur Revenu net — nordis-de");
  await page.goBack();
  await expect(detailTitle(page)).toHaveText("Surcharge sur Revenu net — nordis-fr");
});

test("[S-UI-104-06] « Voir la fiche » du détail ouvre la fiche du document, le retour arrière ramène à la proposition", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await page.goto(`${ws.root}/propositions?n=5`);
  await expect(detailTitle(page)).toHaveText("Surcharge sur Revenu net — nordis-de");
  await selection(page).getByRole("link", { name: "Voir la fiche" }).click();
  await expect(page).toHaveURL(`${ws.root}/fiche/revenu-net--nordis-de`);
  await expect(page.getByRole("heading", { level: 1 })).not.toHaveText(/Fiche introuvable|^Fiche$/);
  await page.goBack();
  await expect(detailTitle(page)).toHaveText("Surcharge sur Revenu net — nordis-de");
});

test("[S-UI-104-07] contributrice sur une proposition qu'elle ne peut pas relire : raison au focus clavier, clics sans effet", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  const sent = writes(page);
  await page.goto(`${ws.root}/propositions?n=3`);
  await expect(detailTitle(page)).toHaveText("Nouvelle version de Revenu net (v5)");
  const approve = selection(page).getByRole("button", { name: "Approuver (1 / 2)" });
  await expect(approve).toHaveAttribute("aria-disabled", "true");
  await expect(approve).toHaveAccessibleDescription(/Votre approbation ne compterait pas ici\. Comptes habilités : .*claire\.m/);

  // Au clavier : le bouton grisé reste focalisable et son infobulle s'affiche (ADR 0018).
  const ask = selection(page).getByRole("button", { name: "Demander des changements" });
  await ask.focus();
  await page.keyboard.press("Tab");
  await expect(approve).toBeFocused();
  await expect(page.getByRole("tooltip")).toBeVisible();
  await page.keyboard.press("Enter");
  await mouseClick(page, approve);
  await expect(page.getByRole("button", { name: "Approuver (1 / 2)" })).toBeVisible();

  // « Demander des changements » grisé aussi : aucun formulaire ne s'ouvre.
  await expect(ask).toHaveAttribute("aria-disabled", "true");
  await mouseClick(page, ask);
  await expect(page.getByRole("form", { name: "Demander des changements" })).toHaveCount(0);
  expect(sent).toEqual([]);
});

test("[S-UI-104-08] marc.d approuve depuis son poste : la proposition devient prête, il la fusionne, elle quitte la file", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await joinAs(request, CLAIRE, ws.remote);
  await joinAs(request, MARC, ws.remote);
  // Précondition : Claire M. a déjà approuvé la surcharge DE depuis son poste.
  expect((await request.post(`${CLAIRE}/api/workspaces/${ws.id}/proposals/5/reviews`, { data: { event: "approve" } })).ok()).toBe(true);
  await relay(page, MARC);
  await page.goto(`${ws.root}/propositions?n=5`);
  await expect(filter(page, "Domaine")).toHaveValue("mes-domaines"); // validateur Finance et Ventes

  await selection(page).getByRole("button", { name: "Approuver (1 / 2)" }).click();
  await expect(entry(page, "Revenu net · nordis-de")).toContainText("Validations : 2 / 2 (canonique requis) · prête à fusionner");
  await expect(selection(page).getByRole("button", { name: "Fusionner", exact: true })).toBeVisible();
  await expect(selection(page).getByRole("button", { name: "Demander des changements" })).toHaveCount(0);
  await expect(selection(page)).toContainText("Marc D. a approuvé");

  await page.reload(); // l'approbation est durable
  await expect(entry(page, "Revenu net · nordis-de")).toContainText("prête à fusionner");
  await selection(page).getByRole("button", { name: "Fusionner", exact: true }).click();
  await expect(page.getByText("Proposition n° 5 fusionnée")).toBeVisible();
  await expect(entry(page, "Revenu net · nordis-de")).toHaveCount(0);
  await page.reload();
  await expect(entry(page, "Revenu net · nordis-de")).toHaveCount(0);
});

test("[S-UI-104-09] julien.h, référent de l'espace : pas d'approbation de ses propres propositions, approbation d'une autre, fusion d'une prête", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await joinAs(request, JULIEN, ws.remote);
  await relay(page, JULIEN);
  await page.goto(`${ws.root}/propositions?n=3&domain=tous`);
  await expect(detailTitle(page)).toHaveText("Nouvelle version de Revenu net (v5)");
  const own = selection(page).getByRole("button", { name: "Approuver (1 / 2)" });
  await expect(own).toHaveAttribute("aria-disabled", "true");
  await own.hover();
  await expect(page.getByRole("tooltip")).toHaveText("Vous êtes l'auteur de cette proposition : un autre compte doit l'approuver.");

  // La surcharge DE d'Anna : le référent de l'espace est habilité.
  await entry(page, "Revenu net · nordis-de").click();
  await selection(page).getByRole("button", { name: "Approuver (0 / 2)" }).click();
  await expect(selection(page).getByRole("button", { name: "Approuver (1 / 2)" })).toBeVisible();
  await expect(entry(page, "Revenu net · nordis-de")).toContainText("Validations : 1 / 2");

  // Taux de service, approuvé par Sami B. : prêt, Julien le fusionne.
  await entry(page, "Taux de service · canonique v3").click();
  await selection(page).getByRole("button", { name: "Fusionner", exact: true }).click();
  await expect(page.getByText("Proposition n° 2 fusionnée")).toBeVisible();
  await expect(entry(page, "Taux de service")).toHaveCount(0);
  await filter(page, "Statut").selectOption({ label: "Fusionnées" });
  await expect(entry(page, "Taux de service · canonique v3")).toContainText("Fusionnée");
});

test("[S-UI-104-10] claire.m passe de « Mes domaines » à « Tous les domaines » puis à « Finance »", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await joinAs(request, CLAIRE, ws.remote);
  await relay(page, CLAIRE);
  await page.goto(`${ws.root}/propositions`);
  await expect(filter(page, "Domaine")).toHaveValue("mes-domaines");
  await expect(entry(page, "Taux de service")).toHaveCount(0);
  await filter(page, "Domaine").selectOption({ label: "Tous les domaines" });
  await expect(entry(page, "Taux de service · canonique v3")).toHaveCount(1);
  await expect(queue(page).getByRole("link")).toHaveCount(5);
  await filter(page, "Domaine").selectOption({ label: "Finance" });
  await expect(queue(page).getByRole("link")).toHaveCount(4);
  await expect(entry(page, "Taux de service")).toHaveCount(0);
});

test("[S-UI-104-11] diff : le détail des champs d'un écart se déplie et se replie", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await page.goto(`${ws.root}/propositions?n=5`);
  const diff = page.getByRole("region", { name: "Diff de la proposition" });
  const first = diff.getByRole("listitem").filter({ has: page.getByText("Détail des champs") }).first();
  const summary = first.getByText("Détail des champs");
  const fields = first.locator("details ul");
  await expect(fields).toBeHidden();
  await summary.click();
  await expect(fields).toBeVisible();
  await expect(fields.getByRole("listitem").first()).toContainText("→");
  await summary.click();
  await expect(fields).toBeHidden();
});

test("[S-UI-104-12] diff : défiler un graphe fait défiler l'autre (ADR 0018, défilement lié)", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await page.goto(`${ws.root}/propositions?n=5`);
  const left = page.getByRole("figure", { name: "Graphe : Canonique v4" });
  const right = page.getByRole("figure", { name: /^Graphe : Déclinaison nordis-de/ });
  await expect(right.locator(".graph-card").first()).toBeVisible();
  const overflow = await left.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow, "le graphe doit déborder de sa colonne pour défiler").toBeGreaterThan(20);
  await left.hover();
  await page.mouse.wheel(400, 0);
  await expect.poll(() => left.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  await expect.poll(() => right.evaluate((el) => el.scrollLeft)).toBe(await left.evaluate((el) => el.scrollLeft));
  await right.hover();
  await page.mouse.wheel(-2000, 0);
  await expect.poll(() => right.evaluate((el) => el.scrollLeft)).toBe(0);
  await expect.poll(() => left.evaluate((el) => el.scrollLeft)).toBe(0);
});

test("[S-UI-104-13] erreur du serveur sur la file : bandeau traduit, avec une action pour réessayer", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  let fail = true;
  await page.route("**/proposals/queue**", (route) =>
    fail ? route.fulfill({ status: 500, contentType: "text/plain", body: "Internal Server Error" }) : route.fallback());
  await page.goto(`${ws.root}/propositions`);
  const banner = page.getByRole("alert").filter({ has: page.locator("strong") }).first();
  await expect(banner).toBeVisible();
  await expect(banner).not.toContainText("Internal Server Error"); // message traduit, pas la réponse brute
  // ADR 0013 (états du serveur) : « Une erreur d'API s'affiche dans un bandeau, avec le message
  // traduit et une action. »
  const retry = banner.getByRole("button", { name: "Réessayer" });
  await expect(retry).toBeVisible();
  fail = false;
  await retry.click();
  await expect(queue(page).getByRole("link")).toHaveCount(5);
});

test("[S-UI-104-14] erreur du serveur sur le détail d'une proposition : l'écran le dit", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await page.route(/\/proposals\/3$/, (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ status: 500, contentType: "text/plain", body: "Internal Server Error" })
      : route.fallback());
  // n° 3, la v5 canonique : pas de bandeau « hors points déclarés » qui pourrait tenir lieu d'alerte.
  await page.goto(`${ws.root}/propositions?n=3`);
  await expect(detailTitle(page)).toHaveText("Nouvelle version de Revenu net (v5)");
  // ADR 0013 : une erreur d'API s'affiche dans un bandeau ; sans détail, l'écran n'a ni
  // actions ni justification, il ne doit pas rester muet.
  await expect(selection(page).getByRole("alert")).toBeVisible({ timeout: 10_000 });
});

test("[S-UI-104-15] hors ligne : changer de filtre affiche le bandeau du serveur injoignable, « Réessayer » rend la file", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await page.goto(`${ws.root}/propositions`);
  await expect(queue(page).getByRole("link")).toHaveCount(5);
  await page.route(`${API}/**`, (route) => route.abort("connectionrefused"));
  await filter(page, "Statut").selectOption({ label: "Fusionnées" });
  const banner = page.getByRole("alert").filter({ hasText: "Serveur local injoignable" });
  await expect(banner).toBeVisible();
  await expect(page.getByText("Chargement des propositions…")).toBeVisible();
  await page.unroute(`${API}/**`);
  await banner.getByRole("button", { name: "Réessayer" }).click();
  await expect(banner).toHaveCount(0);
  await expect(filter(page, "Statut")).toHaveValue("merged");
  await expect(queue(page).getByRole("link").first()).toContainText("Fusionnée");
});


test("[S-UI-104-21] filtrer par KPI puis auteur conserve les choix et les combine", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await page.goto(`${ws.root}/propositions`);
  await expect(queue(page).getByRole("link")).toHaveCount(5);
  await filter(page, "KPI").selectOption({ label: "Revenu net" });
  await expect(queue(page).getByRole("link")).toHaveCount(4);
  await filter(page, "Auteur").selectOption({ label: "Julien H." });
  await expect(queue(page).getByRole("link")).toHaveCount(1);
  await expect(entry(page, "Revenu net · canonique v5")).toBeVisible();
  await expect(page).toHaveURL(/kpi=revenu-net/);
  await expect(page).toHaveURL(/author=julien.h/);
  await page.reload();
  await expect(filter(page, "KPI")).toHaveValue("revenu-net");
  await expect(filter(page, "Auteur")).toHaveValue("julien.h");
  await expect(queue(page).getByRole("link")).toHaveCount(1);
  await page.goBack();
  await expect(filter(page, "Auteur")).toHaveValue("");
  await expect(queue(page).getByRole("link")).toHaveCount(4);
});

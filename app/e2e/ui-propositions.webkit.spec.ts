import { expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { API } from "./demo";
import { isolatedDemo, relay, test } from "./isolation";

// Écran 10.4 Propositions sous WebKit, le moteur de la vue Tauri sous macOS (règle 5 du lot
// ui-ecrans) : listes déroulantes, clavier, focus, infobulle, zones de texte, défilement lié.
// Mêmes sources que ui-propositions.spec.ts : maquette et guide 10.4, plan 0014, ADR 0018.

const CLAIRE = "http://127.0.0.1:8798";

async function joinAs(request: APIRequestContext, server: string, remote: string) {
  const joined = await request.post(`${server}/api/workspaces/join`, { data: { remote_url: remote } });
  expect(joined.status(), await joined.text()).toBe(201);
}

function writes(page: Page) {
  const sent: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() === "POST" && path.startsWith("/api/") && !path.endsWith("/sync/auto")) sent.push(path);
  });
  return sent;
}

async function mouseClick(page: Page, target: Locator) {
  const box = (await target.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/** Sous WebKit (Safari, vue Tauri sous macOS), Tab seul ne s'arrête que sur les champs de
 * saisie, sauf si l'accès clavier complet est activé dans le système : Option+Tab (Alt+Tab)
 * parcourt aussi les liens et les boutons. C'est le geste d'un utilisateur au clavier ici. */
const NEXT = "Alt+Tab";

/** Option+Tab jusqu'à `target` (au plus `max` fois). */
async function tabTo(page: Page, target: Locator, max = 40) {
  for (let i = 0; i < max; i += 1) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press(NEXT);
  }
  await expect(target).toBeFocused();
}

const queue = (page: Page) => page.getByRole("list", { name: "File des propositions" });
const entry = (page: Page, title: string) => queue(page).getByRole("link").filter({ hasText: title });
const selection = (page: Page) => page.getByRole("region", { name: "Proposition sélectionnée" });
const detailTitle = (page: Page) => selection(page).getByRole("heading", { level: 2 });

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("[S-UI-104-16] WebKit : les trois filtres se choisissent, l'adresse les garde, le retour arrière les défait", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await page.goto(`${ws.root}/propositions`);
  await expect(queue(page).getByRole("link")).toHaveCount(5);
  await page.getByRole("combobox", { name: "Domaine" }).selectOption({ label: "Supply chain" });
  await expect(queue(page).getByRole("link")).toHaveCount(1);
  await page.getByRole("combobox", { name: "Domaine" }).selectOption({ label: "Tous les domaines" });
  await page.getByRole("combobox", { name: "Entité" }).selectOption("nordis-de");
  await expect(queue(page).getByRole("link")).toHaveCount(1);
  await expect(detailTitle(page)).toHaveText("Surcharge sur Revenu net — nordis-de");
  await page.getByRole("combobox", { name: "Statut" }).selectOption({ label: "Fermées" });
  await expect(page.getByText("Aucune proposition.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Statut" })).toHaveValue("closed");
  await expect(page.getByRole("combobox", { name: "Entité" })).toHaveValue("nordis-de");
  await page.goBack();
  await expect(page.getByRole("combobox", { name: "Statut" })).toHaveValue("open");
  await expect(entry(page, "Revenu net · nordis-de")).toBeVisible();
});

test("[S-UI-104-17] WebKit : au clavier, du titre à un élément de la file, Entrée l'ouvre", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await page.goto(`${ws.root}/propositions`);
  await expect(page.getByRole("heading", { level: 1, name: "Propositions" })).toBeFocused();
  const fr = entry(page, "Revenu net · nordis-fr");
  await tabTo(page, fr);
  await page.keyboard.press("Enter");
  await expect(fr).toHaveAttribute("aria-current", "true");
  await expect(detailTitle(page)).toHaveText("Surcharge sur Revenu net — nordis-fr");
});

test("[S-UI-104-18] WebKit : bouton grisé atteint au clavier, infobulle visible, Entrée et clic sans effet", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  const sent = writes(page);
  await page.goto(`${ws.root}/propositions?n=3`);
  await expect(detailTitle(page)).toHaveText("Nouvelle version de Revenu net (v5)");
  const approve = selection(page).getByRole("button", { name: "Approuver (1 / 2)" });
  await expect(approve).toHaveAttribute("aria-disabled", "true");
  await tabTo(page, approve, 60);
  await expect(page.getByRole("tooltip")).toBeVisible();
  await expect(page.getByRole("tooltip")).toContainText("Votre approbation ne compterait pas ici.");
  await page.keyboard.press("Enter");
  await mouseClick(page, approve);
  await expect(page.getByRole("button", { name: "Approuver (1 / 2)" })).toBeVisible();
  expect(sent).toEqual([]);
});

test("[S-UI-104-19] WebKit : commenter et demander des changements au clavier", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await joinAs(request, CLAIRE, ws.remote);
  await relay(page, CLAIRE);
  await page.goto(`${ws.root}/propositions?n=5`);
  const thread = selection(page).getByRole("region", { name: "Commentaires" });
  await expect(thread.getByRole("listitem")).toHaveCount(1);

  const reply = thread.getByLabel("Répondre");
  await tabTo(page, reply, 80);
  await page.keyboard.type("Vu, à reprendre en comité.");
  await page.keyboard.press(NEXT);
  await expect(thread.getByRole("button", { name: "Envoyer", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(thread.getByRole("listitem")).toHaveCount(2);
  await expect(thread.getByRole("listitem").filter({ hasText: "Vu, à reprendre en comité." })).toContainText("Claire M.");
  await expect(reply).toHaveValue("");

  const ask = selection(page).getByRole("button", { name: "Demander des changements" });
  await ask.focus();
  await page.keyboard.press("Enter");
  const form = page.getByRole("form", { name: "Demander des changements" });
  const why = form.getByLabel(/Ce qui doit changer/);
  await expect(why).toBeFocused();
  await page.keyboard.type("Garder le fuseau Europe/Paris.");
  await page.keyboard.press(NEXT);
  await expect(form.getByRole("button", { name: "Envoyer la demande" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(form).toHaveCount(0);
  await expect(thread.getByRole("listitem").filter({ hasText: "Garder le fuseau Europe/Paris." })).toContainText("Claire M. demande des changements");
});

test("[S-UI-104-20] WebKit : détail des champs d'un écart au clavier, défilement lié des deux graphes", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await page.goto(`${ws.root}/propositions?n=5`);
  const diff = page.getByRole("region", { name: "Diff de la proposition" });
  const first = diff.getByRole("listitem").filter({ has: page.getByText("Détail des champs") }).first();
  const fields = first.locator("details ul");
  await first.getByText("Détail des champs").focus();
  await page.keyboard.press("Enter");
  await expect(fields).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(fields).toBeHidden();

  const left = page.getByRole("figure", { name: "Graphe : Canonique v4" });
  const right = page.getByRole("figure", { name: /^Graphe : Déclinaison nordis-de/ });
  await expect(right.locator(".graph-card").first()).toBeVisible();
  await left.hover();
  await page.mouse.wheel(400, 0);
  await expect.poll(() => left.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  await expect.poll(async () => (await right.evaluate((el) => el.scrollLeft)) === (await left.evaluate((el) => el.scrollLeft))).toBe(true);
});

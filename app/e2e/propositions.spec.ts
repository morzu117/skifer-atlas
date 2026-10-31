import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { API, ensureNordis, seriousViolations } from "./demo";

// Plan 0014 de bout en bout, sur les cinq propositions de démonstration
// (examples/propositions-nordis.py). Trois comptes, trois serveurs : anna.k (l'auteure de
// la surcharge DE, serveur par défaut), claire.m et marc.d, validateurs Finance.

const CLAIRE = "http://127.0.0.1:8798";
const MARC = "http://127.0.0.1:8797";
const QUEUE = "/#/w/groupe-nordis/propositions";
// Les cinq propositions du script ; l'éditeur (editor.spec.ts) peut en avoir ajouté une.
const SEEDED = [
  "Revenu net · nordis-de",
  "Revenu net · nordis-fr",
  "Revenu net · canonique v5",
  "Revenu net · nordis-es",
  "Taux de service · canonique v3",
];

/** Chaque validateur rejoint, depuis son poste, le même dépôt distant que anna.k. */
async function join(request: APIRequestContext, server: string, remote: string) {
  const listed = (await (await request.get(`${server}/api/workspaces`)).json()) as { id: string }[];
  if (listed.some((ws) => ws.id === "groupe-nordis")) return;
  const joined = await request.post(`${server}/api/workspaces/join`, { data: { remote_url: remote } });
  if (!joined.ok()) throw new Error(await joined.text());
}

test.beforeAll(async ({ request }) => {
  await ensureNordis(request);
  const [nordis] = ((await (await request.get(`${API}/api/workspaces`)).json()) as { id: string; git_remote: string }[]).filter(
    (ws) => ws.id === "groupe-nordis",
  );
  await join(request, CLAIRE, nordis.git_remote);
  await join(request, MARC, nordis.git_remote);
});

/** L'app parle au serveur de claire.m : ses requêtes sont relayées vers son port. */
async function asClaire(page: Page) {
  const posted: string[] = [];
  await page.route(`${API}/**`, async (route) => {
    const request = route.request();
    if (request.method() === "POST") posted.push(new URL(request.url()).pathname);
    const response = await route.fetch({ url: request.url().replace(API, CLAIRE) });
    await route.fulfill({ response });
  });
  return posted;
}

const queue = (page: Page) => page.getByRole("list", { name: "File des propositions" });
const entry = (page: Page, title: string) => queue(page).getByRole("link").filter({ hasText: title });
const selection = (page: Page) => page.getByRole("region", { name: "Proposition sélectionnée" });
const card = (page: Page, figure: string, id: string) =>
  page
    .getByRole("figure", { name: figure })
    .locator(".graph-card")
    .filter({ has: page.locator(".graph-card-id", { hasText: new RegExp(`^${id}$`) }) });

test("[S-0014-01] [S-0014-04] file de anna.k : badges, compteurs ; l'auteure ne peut pas approuver (critères 1 et 4)", async ({ page }) => {
  await page.goto(QUEUE);
  await expect(page.getByRole("heading", { level: 1, name: "Propositions" })).toBeFocused();
  await expect(page.getByRole("combobox", { name: "Domaine" })).toHaveValue("tous"); // anna.k ne valide aucun domaine
  for (const title of SEEDED) await expect(entry(page, title)).toHaveCount(1);

  const de = entry(page, "Revenu net · nordis-de");
  await expect(de.locator(".badge")).toHaveText("Hors points déclarés");
  await expect(de).toContainText("Surcharge · Finance · par Anna K.");
  await expect(de).toContainText("Validations : 0 / 2 (canonique requis)");
  await expect(entry(page, "Revenu net · nordis-es").locator(".badge")).toHaveText("From scratch");
  await expect(entry(page, "Revenu net · nordis-es")).toContainText("Validations : 1 / 2 (canonique requis)");
  await expect(entry(page, "Revenu net · canonique v5")).toContainText("Validations : 1 / 2");
  await expect(entry(page, "Taux de service · canonique v3")).toContainText("Validations : 1 / 1 · prête à fusionner");

  await de.click();
  await expect(de).toHaveAttribute("aria-current", "true");
  await expect(selection(page).getByRole("heading", { level: 2, name: "Surcharge sur Revenu net — nordis-de" })).toBeVisible();
  const approve = page.getByRole("button", { name: "Approuver (0 / 2)" });
  await expect(approve).toHaveAttribute("aria-disabled", "true");
  await approve.hover();
  await expect(page.getByRole("tooltip")).toHaveText("Vous êtes l'auteur de cette proposition : un autre compte doit l'approuver.");
  await expect(page.getByRole("tooltip")).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});

test("[S-0003-02] [S-0006-04] [S-0006-07] [S-0014-02] [S-0014-03] [S-0014-04] [S-0014-05] [S-0014-06] [S-0014-07] claire.m : Finance d'abord, diff de la surcharge DE, changements, approbation, fusion (critères 2 à 7)", async ({
  page,
  request,
}) => {
  const posted = await asClaire(page);
  await page.goto(QUEUE);

  // Critère 2 : « Mes domaines » par défaut, Supply hors de la file.
  await expect(page.getByRole("combobox", { name: "Domaine" })).toHaveValue("mes-domaines");
  for (const title of SEEDED.slice(0, 4)) await expect(entry(page, title)).toHaveCount(1);
  await expect(entry(page, "Taux de service")).toHaveCount(0);
  const before = await queue(page).getByRole("link").count();
  await entry(page, "Revenu net · nordis-de").click();
  await expect(entry(page, "Revenu net · nordis-de")).toHaveAttribute("aria-current", "true");

  // Critère 3 : bandeau, n02 en divergence critique, n03 surchargé sur un point déclaré.
  const banner = selection(page).getByRole("alert").filter({ hasText: "Surcharge hors des points de variation déclarés" });
  await expect(banner).toContainText("« Factures validées » (n02)");
  await expect(banner).toContainText("nordis-de et nordis-fr surchargent tous n02 hors des points déclarés");
  const proposed = "Graphe : Déclinaison nordis-de v4 (proposée)";
  await expect(card(page, proposed, "n02")).toContainText("Divergence critique");
  await expect(card(page, proposed, "n02")).toHaveCSS("border-top-color", "rgb(177, 59, 59)"); // --atlas-bad
  await expect(card(page, proposed, "n03")).toContainText("Normal");
  await expect(card(page, proposed, "n03")).toHaveCSS("border-top-style", "dashed");
  await expect(card(page, "Graphe : Canonique v4", "n02")).not.toContainText("Divergence critique");

  // Critère 7 : chaque écart est repris en texte, le fuseau horaire compris.
  const diff = page.getByRole("region", { name: "Diff de la proposition" });
  await expect(diff.locator(".diff-item")).toHaveCount(3);
  await expect(diff.locator(".diff-item").filter({ hasText: "timezone" })).toHaveCount(1);
  expect(await seriousViolations(page)).toEqual([]);

  // Critère 5 : pas de demande de changements sans commentaire.
  await page.getByRole("button", { name: "Demander des changements" }).click();
  const form = page.getByRole("form", { name: "Demander des changements" });
  await expect(form.getByLabel(/Ce qui doit changer/)).toBeFocused();
  await form.getByRole("button", { name: "Envoyer la demande" }).click();
  await expect(form.getByText("Expliquer ce qui doit changer : la demande part avec ce commentaire.")).toBeVisible();
  expect(posted).toEqual([]);
  await form.getByRole("button", { name: "Annuler" }).click();
  await expect(form).toHaveCount(0);

  // Critère 4 : l'approbation compte, la file et le bouton se relisent.
  await page.getByRole("button", { name: "Approuver (0 / 2)" }).click();
  await expect(page.getByRole("button", { name: "Approuver (1 / 2)" })).toBeVisible();
  await expect(entry(page, "Revenu net · nordis-de")).toContainText("Validations : 1 / 2 (canonique requis)");
  await expect(selection(page)).toContainText("Claire M. a approuvé");

  // marc.d approuve depuis son poste : la proposition est prête.
  const approved = await request.post(`${MARC}/api/workspaces/groupe-nordis/proposals/5/reviews`, { data: { event: "approve" } });
  expect(approved.ok()).toBe(true);
  await page.reload();
  await expect(entry(page, "Revenu net · nordis-de")).toContainText("Validations : 2 / 2 (canonique requis) · prête à fusionner");
  await expect(page.getByRole("button", { name: "Demander des changements" })).toHaveCount(0);

  // Critère 6 : fusion, la proposition quitte la file, la fiche passe en v4.
  await page.getByRole("button", { name: "Fusionner" }).click();
  await expect(page.getByText("Proposition n° 5 fusionnée")).toBeVisible();
  await expect(entry(page, "Revenu net · nordis-de")).toHaveCount(0);
  await expect(queue(page).getByRole("link")).toHaveCount(before - 1);
  await page.getByRole("status").filter({ hasText: "fusionnée" }).getByRole("link", { name: "Voir la fiche" }).click();
  await expect(page).toHaveURL(/#\/w\/groupe-nordis\/fiche\/revenu-net--nordis-de$/);
  await expect(page.getByText(/^v4 · validée le/)).toBeVisible();

  await page.goto(`${QUEUE}?status=merged`);
  await expect(entry(page, "Revenu net · nordis-de")).toHaveCount(1); // avec les points d'accès de la démonstration
  await expect(entry(page, "Revenu net · nordis-de")).toContainText("Fusionnée");
  await page.unrouteAll({ behavior: "ignoreErrors" }); // relevés de la coque encore en vol
});

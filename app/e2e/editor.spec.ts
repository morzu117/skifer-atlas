import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { API, ensureNordis, seriousViolations } from "./demo";
import { longKpi, type Raw } from "./graphe";
import type { APIRequestContext } from "@playwright/test";

// Plan 0013 de bout en bout, sur l'espace de démonstration : Revenu net reconstruit à la
// souris, puis l'édition d'une version, la vue YAML et le mode surcharge.

const EDITOR = `${API}/api/workspaces/groupe-nordis/editor`;
const FIXTURE = fileURLToPath(new URL("../../core/tests/fixtures/documents/revenu-net.yaml", import.meta.url));

test.beforeAll(async ({ request }) => {
  await ensureNordis(request);
});

const props = (page: Page) => page.getByRole("complementary", { name: "Propriétés" });
const bottom = (page: Page) => page.getByRole("region", { name: "Validation du document" });
const palette = (page: Page) => page.getByRole("complementary", { name: "Palette des nœuds" });
const canvasNode = (page: Page, id: string) => page.locator(`[data-node-id="${id}"]`);

async function add(page: Page, type: string, id: string) {
  await palette(page).getByRole("button", { name: type, exact: true }).click();
  await expect(props(page).getByText(id, { exact: true })).toBeVisible();
}

async function field(page: Page, label: RegExp | string, value: string) {
  await props(page).getByLabel(label).fill(value);
}

async function choose(page: Page, label: RegExp | string, value: string) {
  await props(page).getByLabel(label).selectOption(value);
}

const COLUMNS: [string, string, string?, string?][] = [
  ["facture_id", "string"],
  ["entite", "string"],
  ["statut", "string"],
  ["date_facture", "date", "Europe/Paris", "yyyy-MM-dd"],
  ["montant_ttc", "decimal"],
  ["montant_taxes", "decimal"],
  ["avoirs", "decimal"],
];

test("[S-0013-01] [S-0013-04] [S-0013-09] [S-0013-10] Revenu net reconstruit à la souris : YAML identique, soumission (critères 1, 4, 9, 10)", async ({ page, request }) => {
  test.setTimeout(120_000);
  const id = `revenu-net-e2e-${Date.now().toString(36)}`;
  await page.goto("/#/w/groupe-nordis/catalogue");
  await page.getByRole("link", { name: "Nouveau concept ou KPI" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Nouveau concept ou KPI" })).toBeFocused();
  await page.getByLabel(/^Libellé/).fill("Revenu net");
  await page.getByLabel(/^Identifiant/).fill("revenu-net");
  await page.getByLabel(/^Propriétaire/).fill("claire.m");
  await page.getByLabel(/^Domaine/).selectOption("finance");
  await page.getByRole("button", { name: "Créer et ouvrir l'éditeur" }).click();
  await expect(page.getByLabel(/^Identifiant/)).toHaveAttribute("aria-invalid", "true");
  await page.getByLabel(/^Identifiant/).fill(id);
  await page.getByRole("button", { name: "Créer et ouvrir l'éditeur" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Revenu net : v1 · brouillon" })).toBeVisible();

  // Propriétés du document.
  await field(page, "Description", "Chiffre d'affaires facturé, taxes déduites, net des avoirs, sur le calendrier fiscal de l'entité.");
  for (const [index, synonym] of ["CA net", "net revenue"].entries()) {
    await props(page).getByRole("button", { name: "Ajouter un synonyme" }).click();
    await field(page, `Synonyme ${index + 1}`, synonym);
  }
  await choose(page, /^Calendrier/, "fiscal-nordis@2026.1");
  await field(page, /^Fuseau horaire/, "Europe/Paris");
  await field(page, "Devise", "EUR");

  // n01 : la source et ses colonnes.
  await add(page, "Source", "n01");
  await field(page, "Libellé", "Factures");
  await choose(page, /^Plateforme/, "databricks");
  await field(page, /^Table/, "gold.finance.fact_facturation");
  await field(page, /^Propriétaire/, "claire.m");
  for (const [index, [name, type, timezone, format]] of COLUMNS.entries()) {
    await props(page).getByRole("button", { name: "Ajouter une colonne" }).click();
    await field(page, `Nom de la colonne ${index + 1}`, name);
    await choose(page, `Type de la colonne ${index + 1}`, type);
    if (timezone) await field(page, `Fuseau d'origine de la colonne ${index + 1}`, timezone);
    if (format) await field(page, `Format de la colonne ${index + 1}`, format);
  }

  // n02 : le filtre, relié à n01 par l'ajout depuis la palette ; nulls oubliés exprès.
  await add(page, "Filtre", "n02");
  await field(page, "Libellé", "Factures validées");
  await choose(page, /^Colonne requis/, "statut");
  await choose(page, /^Opérateur/, "equals");
  await field(page, /^Valeur/, "validée");

  await add(page, "Calcul de colonne", "n03");
  await field(page, "Libellé", "déduction des taxes");
  await field(page, "Note (pourquoi ce nœud)", "Chaque pays remplace ce calcul par sa propre formule, sans table de paramètres.");
  await field(page, /^Colonne produite/, "montant_ht");
  await field(page, /^Expression/, "montant_ttc - montant_taxes - avoirs");
  await choose(page, "Type de la colonne", "decimal");
  await props(page).getByRole("checkbox", { name: /Point de variation/ }).check();

  await add(page, "Opération temporelle", "n04");
  await field(page, "Libellé", "Mois fiscal");
  await choose(page, /^Opération/, "period");
  await choose(page, /^Colonne source/, "date_facture");
  await field(page, /^Colonne produite/, "mois_fiscal");
  await choose(page, /^Grain/, "month");
  await props(page).getByRole("checkbox", { name: /Point de variation/ }).check();

  await add(page, "Agrégation", "n05");
  await props(page).getByRole("button", { name: "Ajouter une mesure" }).click();
  await choose(page, "Colonne source de la mesure 1", "montant_ht");
  await field(page, "Colonne produite par la mesure 1", "revenu_net");
  await choose(page, "Fonction de la mesure 1", "sum");
  await props(page).getByRole("checkbox", { name: "mois_fiscal" }).check();
  await props(page).getByRole("checkbox", { name: "entite" }).check();
  await expect(page.getByText("schéma 1 · 5 nœuds · 4 arêtes")).toBeVisible();

  // Critère 4 : le filtre sans nulls bloque la soumission ; « Aller au nœud » le sélectionne.
  const problem = bottom(page).getByRole("listitem").filter({ hasText: "ERREUR" });
  await expect(problem).toHaveCount(1);
  await expect(problem).toContainText("n02");
  // aria-disabled : le bouton reste cliquable pour expliquer le blocage, Playwright l'ignore.
  await page.getByRole("button", { name: "Soumettre la proposition" }).click({ force: true });
  await expect(page.getByRole("alert")).toContainText("Soumission bloquée : 1 erreur à corriger");
  await problem.getByRole("button", { name: "Aller au nœud n02" }).click();
  await expect(props(page).getByRole("heading", { name: "Filtre" })).toBeVisible();
  await expect(canvasNode(page, "n02")).toHaveClass(/is-selected/);
  await props(page).getByRole("radio", { name: "exclues" }).check();
  await expect(bottom(page).getByText("Compilable Databricks, Snowflake")).toBeVisible();
  await expect(page.getByText(/Enregistré .* \(local\)/)).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);

  // Critère 9 : le brouillon survit au redémarrage de l'écran.
  await page.reload();
  await expect(page.getByText("schéma 1 · 5 nœuds · 4 arêtes")).toBeVisible();
  await expect(canvasNode(page, "n05")).toContainText("sortie du graphe");

  // Critère 1 : le YAML produit est celui de la fixture, à l'identifiant et la version près.
  const draft = (await (await request.get(`${EDITOR}/documents/${id}`)).json()).draft.document;
  const checked = await (await request.post(`${EDITOR}/check`, { data: { document: draft, node_id: null } })).json();
  const expected = readFileSync(FIXTURE, "utf-8").replace("id: revenu-net\n", `id: ${id}\n`).replace("version: 4\n", "version: 1\n");
  expect(checked.yaml).toBe(expected);

  // Critère 10 : la proposition part sur l'hébergeur local, le brouillon disparaît.
  await page.getByRole("button", { name: "Soumettre la proposition" }).click();
  const dialog = page.getByRole("dialog", { name: "Soumettre la proposition" });
  await expect(dialog.getByText("Nouvelle version")).toBeVisible();
  await dialog.getByLabel(/Justification/).fill("Revenu net reconstruit dans l'éditeur.");
  await dialog.getByRole("button", { name: "Soumettre" }).click();
  await expect(page.getByRole("heading", { name: /Proposition n° \d+ créée/ })).toBeVisible();
  const proposals = (await (await request.get(`${API}/api/workspaces/groupe-nordis/proposals`)).json()) as { document_id: string }[];
  expect(proposals.map((p) => p.document_id)).toContain(id);
  expect((await (await request.get(`${EDITOR}/documents/${id}`)).status())).toBe(404);
});

test("[S-0013-03] [S-0013-06] [S-0013-08] édition d'une version : cycle refusé, SQL par plateforme, YAML aller-retour (critères 3, 6, 8)", async ({ page, request }) => {
  await request.delete(`${EDITOR}/documents/revenu-net/draft`);
  await page.goto("/#/w/groupe-nordis/editeur?from=revenu-net");
  await expect(page.getByRole("heading", { level: 1, name: "Revenu net : v5 · brouillon" })).toBeVisible();
  await expect(bottom(page).getByText("Compilable Databricks, Snowflake")).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);

  // Critère 3 : une arête qui fermerait un cycle est refusée, avec le chemin.
  await page.getByRole("button", { name: "Ajouter une arête" }).click();
  await canvasNode(page, "n05").click();
  await canvasNode(page, "n02").click();
  await expect(page.getByRole("alert")).toHaveText(/Arête refusée : elle créerait un cycle n02 → n03 → n07 → n04 → n05 → n02\./);
  await expect(page.getByText("schéma 1 · 7 nœuds · 6 arêtes")).toBeVisible();

  // Critère 8 : SQL du nœud sélectionné, Databricks puis Snowflake.
  await page.getByRole("button", { name: "Sélection" }).click();
  await canvasNode(page, "n03").click();
  await bottom(page).getByRole("tab", { name: "SQL compilé" }).click();
  await expect(bottom(page).getByText("Étape n03 (CTE du SQL complet)")).toBeVisible();
  await expect(bottom(page).getByLabel("SQL databricks")).toContainText("montant_ht");
  await bottom(page).getByRole("radio", { name: "Snowflake" }).check();
  await expect(bottom(page).getByLabel("SQL snowflake")).toContainText("montant_ht");

  // Critère 6 : YAML plein écran, illisible bloque le retour, puis aller-retour exact.
  await page.getByRole("button", { name: "Éditer en YAML" }).click();
  const editor = page.getByRole("textbox", { name: "YAML de Revenu net" });
  await expect(editor).toContainText("schema_version: 1");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.insertText("\nlabel: [ouvert");
  await page.getByRole("button", { name: "Revenir au canevas" }).click();
  await expect(page.getByRole("alert")).toContainText("YAML illisible");
  await expect(editor).toBeVisible();

  const opened = await (await request.get(`${EDITOR}/documents/revenu-net`)).json();
  const current = await (await request.post(`${EDITOR}/check`, { data: { document: opened.document, node_id: null } })).json();
  const edited = (current.yaml as string).replace("label: Revenu net\n", "label: Revenu net (YAML)\n");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText(edited);
  await page.getByRole("button", { name: "Revenir au canevas" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Revenu net (YAML) : v5 · brouillon" })).toBeVisible();
  await expect(page.getByText(/Enregistré .* \(local\)/)).toBeVisible();
  const draft = (await (await request.get(`${EDITOR}/documents/revenu-net`)).json()).draft.document;
  const back = await (await request.post(`${EDITOR}/check`, { data: { document: draft, node_id: null } })).json();
  expect(back.yaml).toBe(edited);

  // L'aller-retour s'annule comme une opération.
  await page.getByRole("button", { name: "Annuler" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Revenu net : v5 · brouillon" })).toBeVisible();
  await request.delete(`${EDITOR}/documents/revenu-net/draft`);
});

test("[S-0013-07] mode surcharge : remplacer n02 signale la validation canonique (critère 7)", async ({ page, request }) => {
  await page.goto("/#/w/groupe-nordis/editeur?from=revenu-net--nordis-fr");
  await expect(page.getByRole("heading", { level: 1, name: /v3 · brouillon/ })).toBeVisible();
  await expect(palette(page).getByRole("button", { name: "Filtre", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Ajouter une arête" })).toBeDisabled();
  await canvasNode(page, "n02").click();
  await expect(props(page).getByLabel(/^Valeur/)).not.toBeEditable();
  await props(page).getByRole("button", { name: "Remplacer ce nœud" }).click();
  await expect(props(page).getByText("Hors points déclarés : la validation canonique s'appliquera")).toBeVisible();
  await expect(canvasNode(page, "n02")).toContainText("Surcharge");
  await field(page, /^Valeur/, "validée,expédiée");
  await choose(page, /^Opérateur/, "in");
  await field(page, /Justification de la surcharge/, "Expédiées comprises.");
  await expect(bottom(page).getByText("Compilable Databricks, Snowflake")).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
  await request.delete(`${EDITOR}/documents/revenu-net--nordis-fr/draft`);
});

async function isolatedDraft(request: APIRequestContext, count?: number) {
  const opened = await (await request.get(`${EDITOR}/documents/revenu-net`)).json() as { document: Raw };
  const document = count ? longKpi(opened.document, count) : opened.document;
  const id = `edition-${Date.now().toString(36)}`;
  (document.data_product as Record<string, unknown>).id = id;
  expect((await request.put(`${EDITOR}/documents/${id}/draft`, {
    data: { document, positions: {}, highest: count ?? 7, base_version: null },
  })).ok()).toBe(true);
  return { id, document };
}

test("[S-0013-02] Clés amont et colonne supprimée : problème sur la jointure", async ({ page, request }) => {
  const { id } = await isolatedDraft(request);
  try {
    await page.goto(`/#/w/groupe-nordis/editeur?from=${id}`);
    // La démonstration actuelle porte la jointure en n07 ; n04 est le mois fiscal.
    await canvasNode(page, "n07").click();
    const options = async (label: string) => props(page).getByLabel(label).locator("option").evaluateAll(
      elements => elements.map(e => (e as HTMLOptionElement).value).filter(Boolean));
    await expect.poll(() => options("Clé gauche 1")).toEqual([
      "facture_id", "commande_id", "entite", "statut", "date_facture", "montant_ttc", "montant_taxes", "avoirs", "montant_ht",
    ]);
    expect(await options("Clé droite 1")).toEqual(["date_jour", "date_comptable"]);
    await props(page).getByLabel("Clé droite 1").selectOption("date_jour");
    await canvasNode(page, "n06").click();
    await props(page).getByRole("button", { name: "Retirer la ligne 1 : Colonnes", exact: true }).click();
    const problem = bottom(page).getByRole("listitem").filter({ hasText: "date_jour" });
    await expect(problem.filter({ has: page.getByRole("button", { name: "Aller au nœud n07" }) })).toBeVisible();
  } finally {
    await page.goto("/");
    await request.delete(`${EDITOR}/documents/${id}/draft`);
  }
});

test("[S-0013-05] Vingt opérations : ajout, champ, connexion, suppression, annuler et rétablir", async ({ page, request }) => {
  const { id, document } = await isolatedDraft(request);
  const current = async () => (await (await request.get(`${EDITOR}/documents/${id}`)).json()).draft.document;
  try {
    await page.goto(`/#/w/groupe-nordis/editeur?from=${id}`);
    await expect(canvasNode(page, "n01")).toBeVisible();
    for (let i = 0; i < 5; i++) {
      const node = `n${String(8 + i).padStart(2, "0")}`;
      await canvasNode(page, "n01").click();
      await add(page, "Filtre", node);
      await field(page, "Libellé", `Filtre temporaire ${i}`);
      await page.getByRole("button", { name: "Ajouter une arête" }).click();
      await canvasNode(page, "n06").click();
      await canvasNode(page, node).click();
      await page.getByRole("button", { name: "Sélection", exact: true }).click();
      await canvasNode(page, node).click();
      await props(page).getByRole("button", { name: "Supprimer", exact: true }).click();
      await expect(canvasNode(page, node)).toHaveCount(0);
    }
    await expect.poll(current).toEqual(document);
    for (let i = 0; i < 20; i++) await page.getByRole("button", { name: "Annuler", exact: true }).click();
    await expect(page.getByRole("button", { name: "Annuler", exact: true })).toBeDisabled();
    await expect.poll(current).toEqual(document);
    for (let i = 0; i < 20; i++) await page.getByRole("button", { name: "Rétablir", exact: true }).click();
    await expect(page.getByRole("button", { name: "Rétablir", exact: true })).toBeDisabled();
    await expect.poll(current).toEqual(document);
  } finally {
    await page.goto("/");
    await request.delete(`${EDITOR}/documents/${id}/draft`);
  }
});

test("[S-0013-11] Cinquante nœuds : modifier un champ actualise la validation", async ({ page, request }) => {
  const { id } = await isolatedDraft(request, 50);
  try {
    await page.goto(`/#/w/groupe-nordis/editeur?from=${id}`);
    await expect(bottom(page).getByText("Compilable Databricks, Snowflake")).toBeVisible();
    // Au zoom d'ensemble, la chaîne déborde de la vue : premier calcul entièrement visible.
    const view = (await page.getByRole("region", { name: "Graphe" }).boundingBox())!;
    let target = null;
    for (const card of await page.getByRole("group", { name: /^Calcul de colonne n\d+$/ }).all()) {
      const box = await card.boundingBox();
      if (box && box.x >= view.x && box.y >= view.y && box.x + box.width <= view.x + view.width && box.y + box.height <= view.y + view.height) {
        target = card;
        break;
      }
    }
    expect(target, "aucun calcul visible au zoom d'ensemble").not.toBeNull();
    await target!.click();
    const start = Date.now();
    await field(page, /^Expression/, "colonne_absente + 1");
    await expect(bottom(page).getByRole("listitem").filter({ hasText: "colonne_absente" }).first()).toBeVisible();
    console.log(`[S-0013-11] validation de 50 nœuds après saisie : ${Date.now() - start} ms (temporisation et transport inclus)`);
    await field(page, /^Expression/, "montant_ttc - montant_taxes");
    await expect(bottom(page).getByText("Compilable Databricks, Snowflake")).toBeVisible();
  } finally {
    await page.goto("/");
    await request.delete(`${EDITOR}/documents/${id}/draft`);
  }
});

test("[S-0001-10] Une ancre ou un alias YAML empêche le retour au canevas", async ({ page, request }) => {
  const { id } = await isolatedDraft(request);
  try {
    await page.goto(`/#/w/groupe-nordis/editeur?from=${id}`);
    await page.getByRole("button", { name: "Éditer en YAML" }).click();
    const yaml = page.getByRole("textbox", { name: "YAML de Revenu net" });
    await yaml.click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.insertText("base: &b {a: 1}\nother: *b\n");
    await page.getByRole("button", { name: "Revenir au canevas" }).click();
    // L'avis reste générique ; la cause (ancre refusée, avec sa position) est dans les problèmes.
    await expect(page.getByRole("alert")).toHaveText("YAML illisible : corriger l'erreur signalée pour revenir au canevas.");
    await expect(bottom(page).getByText(/^Les ancres YAML \(&\) ne sont pas admises \(ligne 1, colonne 7\)$/)).toBeVisible();
    await expect(yaml).toBeVisible();
  } finally {
    await page.goto("/");
    await request.delete(`${EDITOR}/documents/${id}/draft`);
  }
});

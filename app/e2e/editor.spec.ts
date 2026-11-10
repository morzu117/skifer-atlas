import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";
import { API, seriousViolations } from "./demo";
import { git, isolatedDemo, python, test } from "./isolation";
import { longKpi, type Raw } from "./graphe";
import type { APIRequestContext } from "@playwright/test";

// Plan 0013 de bout en bout, une copie isolée par test : Revenu net reconstruit à la
// souris, puis l'édition d'une version, la vue YAML et le mode surcharge.

let ws: Awaited<ReturnType<typeof isolatedDemo>>;
let EDITOR: string;
const FIXTURE = fileURLToPath(new URL("../../core/tests/fixtures/documents/revenu-net.yaml", import.meta.url));
test.beforeEach(async ({ request }) => {
  ws = await isolatedDemo(request, API);
  EDITOR = `${ws.api}/editor`;
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

test("[S-0032-01] [S-0032-02] créer une déclinaison depuis la fiche, en surcharge ou avec un graphe indépendant", async ({ page, request }) => {
  python("import sys,yaml; from pathlib import Path; p=Path(sys.argv[1])/'atlas.yaml'; d=yaml.safe_load(p.read_text()); d['entities'] += ['nordis-it','nordis-pt']; p.write_text(yaml.safe_dump(d,allow_unicode=True,sort_keys=False))", ws.work);
  git(ws.work, "add", "atlas.yaml");
  git(ws.work, "commit", "-qm", "Deux entités pour créer des déclinaisons");
  git(ws.work, "push", "origin", "main");
  const synced = await request.post(`${ws.api}/sync`, { data: {} });
  expect(synced.ok(), await synced.text()).toBe(true);

  await page.goto(`${ws.root}/fiche/revenu-net?tab=declinaisons`);
  await page.getByRole("link", { name: "Créer une déclinaison" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Nouvelle déclinaison de revenu-net" })).toBeVisible();
  await page.getByLabel(/^Entité/).selectOption("nordis-it");
  await page.getByLabel(/^Justification/).fill("Règle italienne différente.");
  await page.getByRole("button", { name: "Créer et ouvrir l'éditeur" }).click();
  await expect(page).toHaveURL(/editeur\?from=revenu-net--nordis-it$/);
  await expect(page.getByRole("heading", { level: 1, name: /revenu-net · nordis-it : v1 · brouillon/ })).toBeVisible();
  const override = await (await request.get(`${ws.api}/editor/documents/revenu-net--nordis-it`)).json();
  expect(override.document).toMatchObject({ mode: "override", variant_of: { id: "revenu-net", version: 4 }, overrides: [] });

  await page.goto(`${ws.root}/fiche/revenu-net?tab=declinaisons`);
  await page.getByRole("link", { name: "Créer une déclinaison" }).click();
  await page.getByLabel(/^Entité/).selectOption("nordis-pt");
  await page.getByRole("radio", { name: "Graphe indépendant" }).check();
  await page.getByLabel(/^Justification/).fill("Système local différent.");
  await page.getByRole("button", { name: "Créer et ouvrir l'éditeur" }).click();
  await expect(page).toHaveURL(/editeur\?from=revenu-net--nordis-pt$/);
  await expect(page.getByRole("heading", { level: 1, name: /revenu-net · nordis-pt : v1 · brouillon/ })).toBeVisible();
  await palette(page).getByRole("button", { name: "Source", exact: true }).click();
  await expect(props(page).getByText("n01", { exact: true })).toBeVisible();
  await expect.poll(async () => {
    const state = await (await request.get(`${ws.api}/editor/documents/revenu-net--nordis-pt`)).json();
    return state.draft.document.graph.nodes.length;
  }).toBe(1);
  const independent = await (await request.get(`${ws.api}/editor/documents/revenu-net--nordis-pt`)).json();
  expect(independent.draft.document).toMatchObject({ mode: "from_scratch", graph: { nodes: [{ id: "n01", type: "source" }], output: "n01" } });
  expect(await seriousViolations(page)).toEqual([]);
});

test("[S-0032-01] la liste exclut les entités déjà déclinées ; un brouillon déjà commencé est signalé avec « Reprendre le brouillon » ; les refus du serveur sont nets", async ({ page, request }) => {
  python("import sys,yaml; from pathlib import Path; p=Path(sys.argv[1])/'atlas.yaml'; d=yaml.safe_load(p.read_text()); d['entities'] += ['nordis-it']; p.write_text(yaml.safe_dump(d,allow_unicode=True,sort_keys=False))", ws.work);
  git(ws.work, "add", "atlas.yaml");
  git(ws.work, "commit", "-qm", "Une entité pour créer une déclinaison");
  git(ws.work, "push", "origin", "main");
  expect((await request.post(`${ws.api}/sync`, { data: {} })).ok()).toBe(true);

  await page.goto(`${ws.root}/fiche/revenu-net?tab=declinaisons`);
  await page.getByRole("link", { name: "Créer une déclinaison" }).click();
  const entity = page.getByLabel(/^Entité/);
  // nordis-fr, nordis-de et nordis-es ont déjà leur déclinaison : seule nordis-it reste proposée.
  await expect(entity.locator("option")).toHaveText(["Choisir…", "nordis-it"]);

  // Premier brouillon, créé par l'écran.
  await page.getByLabel(/^Justification/).fill("Règle italienne différente.");
  await page.getByRole("button", { name: "Créer et ouvrir l'éditeur" }).click();
  await expect(page).toHaveURL(/editeur\?from=revenu-net--nordis-it$/);
  await expect(page.getByRole("heading", { level: 1, name: /revenu-net · nordis-it : v1 · brouillon/ })).toBeVisible();

  // Le brouillon local n'est pas encore une déclinaison du dépôt : le formulaire la propose, et refuse le doublon.
  await page.goto(`${ws.root}/fiche/revenu-net?tab=declinaisons`);
  await page.getByRole("link", { name: "Créer une déclinaison" }).click();
  await page.getByLabel(/^Justification/).fill("Seconde tentative.");
  await page.getByRole("button", { name: "Créer et ouvrir l'éditeur" }).click();
  await expect(page.getByLabel(/^Entité/)).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel(/^Entité/)).toHaveAccessibleDescription(/brouillon/i);
  await expect(page.getByRole("heading", { level: 1, name: "Nouvelle déclinaison de revenu-net" })).toBeVisible(); // le formulaire reste ouvert
  await page.getByRole("link", { name: "Reprendre le brouillon" }).click();
  await expect(page).toHaveURL(/editeur\?from=revenu-net--nordis-it$/);
  expect(await seriousViolations(page)).toEqual([]);

  // Refus du serveur pour une déclinaison existante et pour une entité inconnue.
  const base = { kpi_id: "revenu-net", mode: "override", owner: "claire.m", justification: "Essai" };
  const existing = await request.post(`${EDITOR}/variants`, { data: { ...base, entity: "nordis-fr" } });
  expect(existing.ok()).toBe(false);
  expect(await existing.json()).toMatchObject({ detail: { code: "document_exists" } });
  const unknown = await request.post(`${EDITOR}/variants`, { data: { ...base, entity: "nordis-xx" } });
  expect(unknown.ok()).toBe(false);
  expect(await unknown.json()).toMatchObject({ detail: { code: "invalid_entity" } });
});

test("[S-0032-01] un lecteur n'a pas l'action « Créer une déclinaison »", async ({ page }) => {
  await page.goto(`${ws.root}/fiche/revenu-net?tab=declinaisons`);
  await expect(page.getByRole("link", { name: "Créer une déclinaison" })).toBeVisible(); // témoin : contributrice
  await page.route(`${API}/api/workspaces/${ws.id}`, async (route) => {
    const response = await route.fetch();
    const found = (await response.json()) as object;
    await route.fulfill({ response, json: { ...found, role: "lecteur", role_label: "Lecteur" } });
  });
  await page.reload();
  await expect(page.getByRole("button", { name: /Déclinaisons/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Créer une déclinaison" })).toHaveCount(0);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("[S-0013-01] [S-0013-04] [S-0013-09] [S-0013-10] Revenu net reconstruit à la souris : YAML identique, soumission (critères 1, 4, 9, 10)", async ({ page, request }) => {
  test.setTimeout(120_000);
  const id = `revenu-net-e2e-${Date.now().toString(36)}`;
  await page.goto(`${ws.root}/catalogue`);
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
  const proposals = (await (await request.get(`${ws.api}/proposals`)).json()) as { document_id: string }[];
  expect(proposals.map((p) => p.document_id)).toContain(id);
  expect((await (await request.get(`${EDITOR}/documents/${id}`)).status())).toBe(404);
});

test("[S-0013-03] [S-0013-06] [S-0013-08] édition d'une version : cycle refusé, SQL par plateforme, YAML aller-retour (critères 3, 6, 8)", async ({ page, request }) => {
  await request.delete(`${EDITOR}/documents/revenu-net/draft`);
  await page.goto(`${ws.root}/editeur?from=revenu-net`);
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
  // Après l'analyse en échec, le bouton est `aria-disabled` : état stable atteint. Le clic reste utile pour
  // expliquer le blocage, d'où `force` (Playwright refuse sinon). Qu'il ne soit pas désactivé pendant la
  // frappe est vérifié par Vitest (S-0013-22), déterministe là où l'e2e courrait contre les 300 ms.
  await expect(page.getByRole("button", { name: "Revenir au canevas" })).toHaveAttribute("aria-disabled", "true");
  await page.getByRole("button", { name: "Revenir au canevas" }).click({ force: true });
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
  // Le texte saisi en YAML a déjà été enregistré (yaml_text) : on attend le document issu du retour au canevas.
  await expect.poll(async () => {
    const draft = (await (await request.get(`${EDITOR}/documents/revenu-net`)).json()).draft.document;
    return (await (await request.post(`${EDITOR}/check`, { data: { document: draft, node_id: null } })).json()).yaml;
  }).toBe(edited);

  // L'aller-retour s'annule comme une opération.
  await page.getByRole("button", { name: "Annuler" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Revenu net : v5 · brouillon" })).toBeVisible();
  await request.delete(`${EDITOR}/documents/revenu-net/draft`);
});

test("[S-0013-07] mode surcharge : remplacer n02 signale la validation canonique (critère 7)", async ({ page, request }) => {
  await page.goto(`${ws.root}/editeur?from=revenu-net--nordis-fr`);
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
    await page.goto(`${ws.root}/editeur?from=${id}`);
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
    await page.goto(`${ws.root}/editeur?from=${id}`);
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
    await page.goto(`${ws.root}/editeur?from=${id}`);
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
    await page.goto(`${ws.root}/editeur?from=${id}`);
    await page.getByRole("button", { name: "Éditer en YAML" }).click();
    const yaml = page.getByRole("textbox", { name: "YAML de Revenu net" });
    await yaml.click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.insertText("base: &b {a: 1}\nother: *b\n");
    // Analyse en échec : la cause est affichée et le bouton `aria-disabled` explique son blocage au clic (d'où `force`).
    await expect(bottom(page).getByText(/^Les ancres YAML \(&\) ne sont pas admises \(ligne 1, colonne 7\)$/)).toBeVisible();
    await page.getByRole("button", { name: "Revenir au canevas" }).click({ force: true });
    // L'avis reste générique ; la cause (ancre refusée, avec sa position) est dans les problèmes.
    await expect(page.getByRole("alert")).toHaveText("YAML illisible : corriger l'erreur signalée pour revenir au canevas.");
    await expect(bottom(page).getByText(/^Les ancres YAML \(&\) ne sont pas admises \(ligne 1, colonne 7\)$/)).toBeVisible();
    await expect(yaml).toBeVisible();
  } finally {
    await page.goto("/");
    await request.delete(`${EDITOR}/documents/${id}/draft`);
  }
});

// --- Suivi de la revue globale (#150), critères 12 à 16 du plan 0013 ---------------------------

const CHECK = "**/editor/check";
const unavailable = { status: 503, json: { detail: { code: "check_down", message: "Validation indisponible." } } };
const submitButton = (page: Page) => page.getByRole("button", { name: "Soumettre la proposition" });
const description = (page: Page) => props(page).getByLabel("Description");
const draftOf = async (request: APIRequestContext, id: string) =>
  (await (await request.get(`${EDITOR}/documents/${id}`)).json()).draft as { document: Raw; yaml_text?: string | null } | null;

/** Retient les réponses de `editor/check` jusqu'à l'appel de la fonction rendue. */
async function holdChecks(page: Page) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => { release = resolve; });
  await page.route(CHECK, async (route) => {
    await released;
    await route.continue().catch(() => undefined);
  });
  return release;
}

test("[S-0013-12] Après une modification, la soumission attend la validation de ce document ; la proposition en reprend le YAML", async ({ page, request }) => {
  const { id } = await isolatedDraft(request);
  const mark = "derniere-modification-e2e";
  try {
    await page.goto(`${ws.root}/editeur?from=${id}`);
    await expect(bottom(page).getByText("Compilable Databricks, Snowflake")).toBeVisible();
    await expect(submitButton(page)).not.toHaveAttribute("aria-disabled", "true");

    // Clic aussitôt après la modification, sans attendre la requête. Les réponses sont retenues : la validation
    // ne peut pas finir avant le clic, même sur un poste lent. Selon que la temporisation de 300 ms est écoulée,
    // le message dit « lancée » ou « en cours » (la phrase exacte « lancée » est vérifiée par Vitest) ; jamais « échoué ».
    const releaseFirst = await holdChecks(page);
    await field(page, "Description", "modification-immediate");
    await submitButton(page).click({ force: true });
    await expect(page.getByRole("alert")).toContainText(/Validation (lancée|en cours) : réessayer dans un instant\./);
    await expect(page.getByRole("alert")).not.toContainText("échoué");
    await expect(page.getByRole("dialog", { name: "Soumettre la proposition" })).toHaveCount(0);
    releaseFirst();
    await expect(bottom(page).getByText("Compilable Databricks, Snowflake")).toBeVisible();
    await expect(submitButton(page)).not.toHaveAttribute("aria-disabled", "true");
    await page.unroute(CHECK); // état propre pour l'étape suivante

    // La validation du document modifié est en route : l'ancienne ne suffit plus.
    const release = await holdChecks(page);
    const started = page.waitForRequest((r) => r.method() === "POST" && r.url() === `${ws.api}/editor/check`);
    await field(page, "Description", mark);
    await started; // la validation de ce document est en vol
    await expect(submitButton(page)).toHaveAttribute("aria-disabled", "true");
    await submitButton(page).click({ force: true });
    await expect(page.getByRole("alert")).toContainText("Validation en cours : réessayer dans un instant.");
    await expect(page.getByRole("dialog", { name: "Soumettre la proposition" })).toHaveCount(0);

    release();
    await expect(bottom(page).getByText("Compilable Databricks, Snowflake")).toBeVisible();
    await expect(submitButton(page)).not.toHaveAttribute("aria-disabled", "true");
    await submitButton(page).click();
    const dialog = page.getByRole("dialog", { name: "Soumettre la proposition" });
    await dialog.getByLabel(/Justification/).fill("Dernière modification incluse.");
    const posted = page.waitForRequest((r) => r.method() === "POST" && r.url() === `${ws.api}/proposals`);
    await dialog.getByRole("button", { name: "Soumettre" }).click();
    const body = JSON.parse((await posted).postData()!) as { document_yaml: string };
    expect(body.document_yaml).toContain(mark);
    await expect(page.getByRole("heading", { name: /Proposition n° \d+ créée/ })).toBeVisible();
    const proposals = (await (await request.get(`${ws.api}/proposals`)).json()) as { document_id: string }[];
    expect(proposals.map((p) => p.document_id)).toContain(id);
    expect(await seriousViolations(page)).toEqual([]);
  } finally {
    await request.delete(`${EDITOR}/documents/${id}/draft`);
  }
});

test("[S-0013-13] Une validation indisponible s'affiche, bloque la soumission, garde le brouillon et se relance au clic", async ({ page, request }) => {
  const { id } = await isolatedDraft(request);
  const mark = "modification-sans-validation";
  try {
    await page.goto(`${ws.root}/editeur?from=${id}`);
    await expect(bottom(page).getByText("Compilable Databricks, Snowflake")).toBeVisible();

    let checks = 0;
    let hold: Promise<void> | null = null;
    await page.route(CHECK, async (route) => {
      checks++;
      if (hold) await hold;
      await route.fulfill(unavailable).catch(() => undefined);
    });
    await field(page, "Description", mark);
    await expect(page.getByRole("alert")).toContainText("L'opération a échoué : Validation indisponible.");
    await expect(submitButton(page)).toHaveAttribute("aria-disabled", "true");
    expect(await seriousViolations(page)).toEqual([]);
    await expect.poll(async () => ((await draftOf(request, id))?.document.data_product as Raw | undefined)?.description).toBe(mark);

    // Un clic relance la validation, sans nouvelle modification, et l'annonce ; la requête est en vol.
    const failed = checks;
    let release!: () => void;
    hold = new Promise<void>((resolve) => { release = resolve; });
    await submitButton(page).click({ force: true });
    await expect(page.getByRole("alert")).toContainText("La validation a échoué : nouvelle tentative lancée.");
    await expect(page.getByRole("alert")).not.toContainText("Validation en cours");
    await expect.poll(() => checks).toBe(failed + 1);
    await expect(page.getByRole("dialog", { name: "Soumettre la proposition" })).toHaveCount(0);
    release();
    await expect(page.getByRole("alert")).toContainText("L'opération a échoué : Validation indisponible.");

    // La validation revient : un clic de plus suffit, le document n'a pas changé.
    hold = null;
    await page.unroute(CHECK);
    await submitButton(page).click({ force: true });
    await expect(bottom(page).getByText("Compilable Databricks, Snowflake")).toBeVisible();
    await expect(submitButton(page)).not.toHaveAttribute("aria-disabled", "true");
    await submitButton(page).click();
    await expect(page.getByRole("dialog", { name: "Soumettre la proposition" })).toBeVisible();
  } finally {
    await request.delete(`${EDITOR}/documents/${id}/draft`);
  }
});

test("[S-0013-14] Quitter l'éditeur juste après une modification, ou depuis la vue YAML, ne perd rien", async ({ page, request }) => {
  const { id } = await isolatedDraft(request);
  const mark = "modification-avant-depart";
  try {
    await page.goto(`${ws.root}/editeur?from=${id}`);
    await expect(bottom(page).getByText("Compilable Databricks, Snowflake")).toBeVisible();

    // Départ immédiat, avant le délai d'enregistrement.
    await field(page, "Description", mark);
    await page.getByRole("link", { name: "Catalogue" }).click();
    await expect(page).toHaveURL(/\/catalogue$/);
    await expect.poll(async () => ((await draftOf(request, id))?.document.data_product as Raw | undefined)?.description).toBe(mark);
    await page.goBack();
    await expect(description(page)).toHaveValue(mark);
    expect(await seriousViolations(page)).toEqual([]);

    // Départ depuis la vue YAML, avec un texte inachevé.
    await page.getByRole("button", { name: "Éditer en YAML" }).click();
    const yaml = page.getByRole("textbox", { name: "YAML de Revenu net" });
    await yaml.click();
    await page.keyboard.press("ControlOrMeta+Home"); // en tête : l'éditeur ne rend que les lignes visibles
    await page.keyboard.insertText("label: [ouvert\n");
    await page.getByRole("link", { name: "Catalogue" }).click();
    await expect(page).toHaveURL(/\/catalogue$/);
    await expect.poll(async () => (await draftOf(request, id))?.yaml_text).toContain("label: [ouvert");
    await page.goBack();
    await expect(page.getByRole("textbox", { name: "YAML de Revenu net" })).toContainText("label: [ouvert");
  } finally {
    await request.delete(`${EDITOR}/documents/${id}/draft`);
  }
});

test("[S-0013-15] « Repartir de la vN » demande confirmation, au clavier ; un échec de suppression garde la session", async ({ page, request }) => {
  const label = "Revenu net (brouillon repris)";
  const opened = await (await request.get(`${EDITOR}/documents/revenu-net`)).json() as { document: Raw; base_version: number; highest: number };
  const version = opened.base_version;
  expect((await request.put(`${EDITOR}/documents/revenu-net/draft`, {
    data: { document: { ...opened.document, label }, positions: {}, highest: opened.highest, base_version: version },
  })).ok()).toBe(true);
  const restart = page.getByRole("button", { name: `Repartir de la v${version}` });
  const confirmation = page.getByRole("alertdialog", { name: `Repartir de la v${version} ?` });
  const title = (text: string) => page.getByRole("heading", { level: 1, name: `${text} : v${version + 1} · brouillon` });
  try {
    await page.goto(`${ws.root}/editeur?from=revenu-net`);
    await expect(title(label)).toBeVisible();
    await expect(page.getByText("Brouillon local repris")).toBeVisible();

    // Le focus arrive sur « Annuler » ; Échap ferme sans rien supprimer.
    await restart.click();
    await expect(confirmation).toBeVisible();
    await expect(confirmation.getByRole("button", { name: "Annuler" })).toBeFocused();
    expect(await seriousViolations(page)).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(confirmation).toHaveCount(0);
    await expect(restart).toBeFocused();
    expect((await draftOf(request, "revenu-net"))?.document.label).toBe(label);

    // « Annuler » conserve aussi le brouillon.
    await restart.click();
    await confirmation.getByRole("button", { name: "Annuler" }).click();
    await expect(confirmation).toHaveCount(0);
    await expect(restart).toBeFocused();
    await expect(title(label)).toBeVisible();
    expect((await draftOf(request, "revenu-net"))?.document.label).toBe(label);

    // Une suppression qui échoue affiche l'erreur et garde la session.
    await page.route("**/editor/documents/revenu-net/draft", (route) =>
      route.request().method() === "DELETE"
        ? route.fulfill({ status: 500, json: { detail: { code: "delete_failed", message: "Suppression impossible." } } })
        : route.continue());
    await restart.click();
    await confirmation.getByRole("button", { name: "Supprimer le brouillon" }).click();
    await expect(page.getByRole("alert")).toContainText("L'opération a échoué : Suppression impossible.");
    await expect(confirmation).toHaveCount(0);
    await expect(title(label)).toBeVisible();
    await expect(restart).toBeVisible();
    expect((await draftOf(request, "revenu-net"))?.document.label).toBe(label);
    await page.unroute("**/editor/documents/revenu-net/draft");

    // Confirmer supprime le brouillon et revient à la version courante ; l'édition est gelée tant que la suppression dure.
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    await page.route("**/editor/documents/revenu-net/draft", async (route) => {
      if (route.request().method() !== "DELETE") return route.continue();
      await held;
      await route.continue().catch(() => undefined);
    });
    await restart.click();
    await confirmation.getByRole("button", { name: "Supprimer le brouillon" }).click();
    await expect(page.getByText("Reprise en cours : l'édition est suspendue.")).toBeVisible();
    await expect(page.locator('[aria-busy="true"]')).toBeVisible();
    await expect(confirmation.getByRole("button", { name: "Annuler" })).toBeDisabled();
    await expect(confirmation.getByRole("button", { name: "Supprimer le brouillon" })).toBeDisabled();
    await expect(submitButton(page)).toBeDisabled();
    await expect(page.getByRole("button", { name: "Éditer en YAML" })).toBeDisabled();
    release();
    await expect(title("Revenu net")).toBeVisible();
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    await expect(page.getByText("Reprise en cours")).toHaveCount(0);
    await expect(restart).toHaveCount(0);
    await expect.poll(() => draftOf(request, "revenu-net")).toBeNull();
  } finally {
    await request.delete(`${EDITOR}/documents/revenu-net/draft`);
  }
});

test("[S-0013-16] Une erreur à l'entrée ou à la sortie de la vue YAML s'affiche et laisse l'éditeur utilisable", async ({ page, request }) => {
  const { id } = await isolatedDraft(request);
  const enter = page.getByRole("button", { name: "Éditer en YAML" });
  const leave = page.getByRole("button", { name: "Revenir au canevas" });
  try {
    await page.goto(`${ws.root}/editeur?from=${id}`);
    await expect(bottom(page).getByText("Compilable Databricks, Snowflake")).toBeVisible();

    // Entrée : la validation est indisponible, l'éditeur reste sur le canevas.
    await page.route(CHECK, (route) => route.fulfill(unavailable));
    await enter.click();
    await expect(page.getByRole("alert")).toContainText("L'opération a échoué : Validation indisponible.");
    await expect(enter).toBeVisible();
    await page.unroute(CHECK);

    // Sortie : le serveur ne répond pas à l'analyse ; le texte reste, et le retour fonctionne ensuite.
    await enter.click();
    const yaml = page.getByRole("textbox", { name: "YAML de Revenu net" });
    await expect(yaml).toContainText("schema_version: 1");
    await page.route("**/editor/parse", (route) => route.abort("connectionrefused"));
    await leave.click();
    await expect(page.getByRole("alert").filter({ hasText: "Réessayez dans un instant." })).toBeVisible();
    await expect(yaml).toBeVisible();
    await page.unroute("**/editor/parse");
    await leave.click();
    await expect(enter).toBeVisible();
    await expect(page.getByText(/schéma 1 · 7 nœuds/)).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  } finally {
    await request.delete(`${EDITOR}/documents/${id}/draft`);
  }
});

test("[S-0013-14] pagehide enregistre aussitôt la modification en attente", async ({ page, request }) => {
  const { id } = await isolatedDraft(request);
  const mark = "modification-au-pagehide";
  const puts: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "PUT" && r.url().endsWith(`/editor/documents/${id}/draft`)) puts.push(r.postData() ?? "");
  });
  try {
    await page.goto(`${ws.root}/editeur?from=${id}`);
    await expect(bottom(page).getByText("Compilable Databricks, Snowflake")).toBeVisible();
    await field(page, "Description", mark);
    expect(puts).toHaveLength(0); // le délai d'enregistrement n'est pas écoulé
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
    await expect.poll(() => puts.some((body) => body.includes(mark))).toBe(true);
    await expect.poll(async () => ((await draftOf(request, id))?.document.data_product as Raw | undefined)?.description).toBe(mark);
  } finally {
    await request.delete(`${EDITOR}/documents/${id}/draft`);
  }
});

test("[S-0013-18] Un brouillon YAML illisible s'ouvre en vue YAML ; « Repartir » revient à la version sans réparer le texte", async ({ page, request }) => {
  const unreadable = "label: [ouvert";
  const opened = await (await request.get(`${EDITOR}/documents/revenu-net`)).json() as { document: Raw; base_version: number; highest: number };
  const version = opened.base_version;
  expect((await request.put(`${EDITOR}/documents/revenu-net/draft`, {
    data: { document: opened.document, positions: {}, highest: opened.highest, base_version: version, yaml_text: unreadable },
  })).ok()).toBe(true);
  const restart = page.getByRole("button", { name: `Repartir de la v${version}` });
  const confirmation = page.getByRole("alertdialog", { name: `Repartir de la v${version} ?` });
  const yaml = page.getByRole("textbox", { name: "YAML de Revenu net" });
  try {
    await page.goto(`${ws.root}/editeur?from=revenu-net`);
    await expect(yaml).toContainText(unreadable);
    await expect(page.getByText("Brouillon local repris")).toBeVisible();
    await expect(restart).toBeVisible();

    await restart.click();
    await expect(confirmation.getByRole("button", { name: "Annuler" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(confirmation).toHaveCount(0);
    await expect(restart).toBeFocused();
    await expect(yaml).toContainText(unreadable);

    await restart.click();
    await confirmation.getByRole("button", { name: "Annuler" }).click();
    await expect(restart).toBeFocused();
    expect((await draftOf(request, "revenu-net"))?.yaml_text).toBe(unreadable);

    await restart.click();
    await confirmation.getByRole("button", { name: "Supprimer le brouillon" }).click();
    await expect(page.getByRole("heading", { level: 1, name: `Revenu net : v${version + 1} · brouillon` })).toBeVisible();
    await expect(page.getByRole("region", { name: "Graphe" })).toBeVisible();
    await expect(yaml).toHaveCount(0);
    await expect(restart).toHaveCount(0);
    await expect.poll(() => draftOf(request, "revenu-net")).toBeNull();
    await expect(page.getByRole("button", { name: "Éditer en YAML" })).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  } finally {
    await request.delete(`${EDITOR}/documents/revenu-net/draft`);
  }
});

// --- Courses d'enregistrement du brouillon (critères 19, 21 et 22 du plan 0013) -------------------

/** Le document créé par le brouillon n'existe plus : le brouillon supprimé n'a pas été recréé. */
const draftGone = async (request: APIRequestContext, id: string) => {
  const response = await request.get(`${EDITOR}/documents/${id}`);
  return !response.ok() || (await response.json()).draft === null;
};

/** Retient la première écriture du brouillon `id` (PUT) jusqu'à `release`, puis la fait échouer ;
 * les suivantes passent. Relève toutes les méthodes vues, dans l'ordre d'arrivée. */
async function holdDraftWrites(page: Page, id: string) {
  const methods: string[] = [];
  let late = false;
  let release!: () => void;
  const released = new Promise<void>((resolve) => { release = resolve; });
  await page.route(`**/editor/documents/${id}/draft`, async (route) => {
    const method = route.request().method();
    methods.push(method);
    if (method !== "PUT" || late) return route.continue().catch(() => undefined);
    late = true;
    await released;
    await route.abort("failed").catch(() => undefined);
  });
  return { methods, release };
}

test("[S-0013-19] Une écriture du brouillon qui échoue tardivement ne recrée pas le brouillon après la soumission", async ({ page, request }) => {
  const { id } = await isolatedDraft(request);
  const mark = "modification-avant-soumission";
  try {
    await page.goto(`${ws.root}/editeur?from=${id}`);
    await expect(bottom(page).getByText("Compilable Databricks, Snowflake")).toBeVisible();
    const writes = await holdDraftWrites(page, id);
    await field(page, "Description", mark);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
    await expect.poll(() => writes.methods).toEqual(["PUT"]); // l'écriture est lancée, sa réponse retenue

    await expect(bottom(page).getByText("Compilable Databricks, Snowflake")).toBeVisible();
    await expect(submitButton(page)).not.toHaveAttribute("aria-disabled", "true");
    await submitButton(page).click();
    const dialog = page.getByRole("dialog", { name: "Soumettre la proposition" });
    await dialog.getByLabel(/Justification/).fill("Soumise pendant une écriture du brouillon.");
    await dialog.getByRole("button", { name: "Soumettre" }).click();
    await expect(page.getByRole("heading", { name: /Proposition n° \d+ créée/ })).toBeVisible();
    // La suppression du brouillon attend la fin de l'écriture déjà lancée.
    expect(writes.methods).toEqual(["PUT"]);

    writes.release();
    await expect.poll(() => writes.methods).toEqual(["PUT", "DELETE"]);
    await expect.poll(() => draftGone(request, id)).toBe(true);
    // Rien ne recrée le brouillon ensuite, ni Ctrl/Cmd+Z, ni un nouveau départ de page.
    await page.keyboard.press("ControlOrMeta+Z");
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
    await page.waitForTimeout(1200); // plus que le délai d'enregistrement (800 ms)
    expect(writes.methods).toEqual(["PUT", "DELETE"]);
    expect(await draftGone(request, id)).toBe(true);
    expect(await seriousViolations(page)).toEqual([]);
  } finally {
    await request.delete(`${EDITOR}/documents/${id}/draft`);
  }
});

test("[S-0013-19] Une écriture du brouillon qui échoue tardivement ne recrée pas le brouillon après « Repartir de la vN », et la session reste modifiable", async ({ page, request }) => {
  const label = "Revenu net (brouillon repris)";
  const opened = await (await request.get(`${EDITOR}/documents/revenu-net`)).json() as { document: Raw; base_version: number; highest: number };
  const version = opened.base_version;
  expect((await request.put(`${EDITOR}/documents/revenu-net/draft`, {
    data: { document: { ...opened.document, label }, positions: {}, highest: opened.highest, base_version: version },
  })).ok()).toBe(true);
  try {
    await page.goto(`${ws.root}/editeur?from=revenu-net`);
    await expect(page.getByRole("heading", { level: 1, name: `${label} : v${version + 1} · brouillon` })).toBeVisible();
    await expect(bottom(page).getByText("Compilable Databricks, Snowflake")).toBeVisible();
    const writes = await holdDraftWrites(page, "revenu-net");
    await field(page, "Description", "modification-avant-repartir");
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
    await expect.poll(() => writes.methods).toEqual(["PUT"]);

    await page.getByRole("button", { name: `Repartir de la v${version}` }).click();
    await page.getByRole("alertdialog", { name: `Repartir de la v${version} ?` }).getByRole("button", { name: "Supprimer le brouillon" }).click();
    await expect(page.getByText("Reprise en cours : l'édition est suspendue.")).toBeVisible();
    expect(writes.methods).toEqual(["PUT"]); // la suppression attend l'écriture

    writes.release();
    await expect.poll(() => writes.methods).toEqual(["PUT", "DELETE"]);
    await expect(page.getByRole("heading", { level: 1, name: `Revenu net : v${version + 1} · brouillon` })).toBeVisible();
    await expect(page.getByText("Reprise en cours")).toHaveCount(0);
    await expect.poll(() => draftOf(request, "revenu-net")).toBeNull();
    // Aucune autre écriture n'est partie, et la session est de nouveau modifiable.
    await page.waitForTimeout(1200);
    expect(writes.methods).toEqual(["PUT", "DELETE"]);
    await field(page, "Description", "apres-repartir");
    await expect(description(page)).toHaveValue("apres-repartir");
    await expect.poll(async () => ((await draftOf(request, "revenu-net"))?.document.data_product as Raw | undefined)?.description).toBe("apres-repartir");
  } finally {
    await request.delete(`${EDITOR}/documents/revenu-net/draft`);
  }
});

test("[S-0013-21] keepalive seulement sous 60 Kio, mesuré en octets UTF-8", async ({ page, request }) => {
  const { id } = await isolatedDraft(request);
  // Le navigateur n'expose pas `keepalive` à Playwright : l'appel à fetch est relevé dans la page.
  await page.addInitScript(() => {
    const seen: { keepalive: boolean | undefined; bytes: number }[] = [];
    (window as unknown as { draftWrites: typeof seen }).draftWrites = seen;
    const original = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (init?.method === "PUT" && String(input).endsWith("/draft")) {
        seen.push({ keepalive: init.keepalive, bytes: new TextEncoder().encode(String(init.body)).byteLength });
      }
      return original(input, init);
    };
  });
  const writes = () => page.evaluate(() => (window as unknown as { draftWrites: { keepalive: boolean | undefined; bytes: number }[] }).draftWrites);
  try {
    await page.goto(`${ws.root}/editeur?from=${id}`);
    await expect(bottom(page).getByText("Compilable Databricks, Snowflake")).toBeVisible();

    // Un petit brouillon quitté aussitôt : keepalive.
    await field(page, "Description", "petite-modification");
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
    await expect.poll(async () => (await writes()).length).toBe(1);
    const [small] = await writes();
    expect(small.bytes).toBeLessThan(60 * 1024);
    expect(small.keepalive).toBe(true);

    // 31 000 « é » : moins de 60 000 caractères, plus de 60 Kio en UTF-8 : pas de keepalive.
    await page.getByRole("button", { name: "Éditer en YAML" }).click();
    const yaml = page.getByRole("textbox", { name: "YAML de Revenu net" });
    await yaml.click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.insertText("é".repeat(31_000));
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
    await expect.poll(async () => (await writes()).length).toBeGreaterThan(1);
    const large = (await writes()).filter((write) => write.bytes > 60 * 1024);
    expect(large.length).toBeGreaterThan(0);
    for (const write of large) expect(write.keepalive).toBe(false);
  } finally {
    await request.delete(`${EDITOR}/documents/${id}/draft`);
  }
});

test("[S-0013-22] Saisir du YAML ne désactive pas « Revenir au canevas », et une saisie arrivée pendant l'analyse garde la vue YAML", async ({ page, request }) => {
  const { id } = await isolatedDraft(request);
  try {
    await page.goto(`${ws.root}/editeur?from=${id}`);
    await expect(bottom(page).getByText("Compilable Databricks, Snowflake")).toBeVisible();
    await page.getByRole("button", { name: "Éditer en YAML" }).click();
    const yaml = page.getByRole("textbox", { name: "YAML de Revenu net" });
    await expect(yaml).toContainText("schema_version: 1");
    const leave = page.getByRole("button", { name: "Revenir au canevas" });

    // Les analyses sont retenues : la frappe ne peut pas être « rattrapée » par un résultat.
    let release!: () => void;
    const released = new Promise<void>((resolve) => { release = resolve; });
    let parses = 0;
    await page.route("**/editor/parse", async (route) => {
      parses += 1;
      await released;
      await route.continue().catch(() => undefined);
    });
    await yaml.click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.insertText("label: première saisie\n");
    await expect(leave).not.toHaveAttribute("aria-disabled", "true");
    await leave.click(); // sans `force` : le bouton n'est pas bloqué
    await expect.poll(() => parses).toBeGreaterThanOrEqual(1);
    await yaml.click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.insertText("label: deuxième saisie\n");
    release();

    await expect(page.getByRole("alert")).toContainText("Le YAML a changé pendant l'analyse");
    await expect(yaml).toBeVisible();
    await expect(yaml).toContainText("label: deuxième saisie");
    await expect(yaml).not.toContainText("première saisie");
    await expect(page.getByRole("button", { name: "Éditer en YAML" })).toHaveCount(0);
    expect(await seriousViolations(page)).toEqual([]);
  } finally {
    await page.goto("/");
    await request.delete(`${EDITOR}/documents/${id}/draft`);
  }
});

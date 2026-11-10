import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { API, seriousViolations } from "./demo";
import { git, isolatedDemo, relay, test } from "./isolation";

// Plan 0013 de bout en bout, côté création : un test par parcours, chacun sur un espace isolé
// (copie du dépôt de démonstration, retirée à la fin). Ils couvrent le formulaire « Nouveau
// concept ou KPI », chaque type de nœud jusqu'au SQL compilé et au YAML, la sémantique d'un
// KPI, le concept puis le KPI qui s'y rattache, les erreurs de construction, le brouillon
// qu'on quitte et reprend, puis la soumission jusqu'au catalogue et à la fiche.
// Les comptes : anna.k (contributrice, serveur principal), claire.m et marc.d (validateurs
// Finance), julien.h (référent de l'espace : seul habilité sur le domaine Marketing).

const FORMAT = "De 2 à 64 caractères : minuscules, chiffres et tirets, en commençant par une lettre ou un chiffre, sans double tiret.";
const CLAIRE = "http://127.0.0.1:8798";
const MARC = "http://127.0.0.1:8797";
const JULIEN = "http://127.0.0.1:8795";

type Ws = Awaited<ReturnType<typeof isolatedDemo>>;
type GraphNode = Record<string, unknown> & { id: string; type: string };
type Draft = Record<string, unknown> & { graph?: { nodes: GraphNode[]; output: string }; semantics?: Record<string, unknown> };

let ws: Ws;
test.beforeEach(async ({ request }) => {
  ws = await isolatedDemo(request, API);
});

const props = (page: Page) => page.getByRole("complementary", { name: "Propriétés" });
const bottom = (page: Page) => page.getByRole("region", { name: "Validation du document" });
const palette = (page: Page) => page.getByRole("complementary", { name: "Palette des nœuds" });
const canvasNode = (page: Page, id: string) => page.locator(`[data-node-id="${id}"]`);
const compilable = (page: Page) => bottom(page).getByText("Compilable Databricks, Snowflake");
const errors = (page: Page) => bottom(page).getByRole("listitem").filter({ hasText: "ERREUR" });

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

/** Un clic sur le fond du canevas : plus de nœud sélectionné, le panneau montre le document. */
async function deselect(page: Page) {
  await page.locator(".react-flow__pane").click({ position: { x: 8, y: 8 } });
  await expect(props(page).getByText("Aucun nœud sélectionné : propriétés du document.")).toBeVisible();
}

async function tick(page: Page, name: string) {
  await props(page).getByRole("checkbox", { name, exact: true }).check();
}

async function radio(page: Page, name: string | RegExp) {
  await props(page).getByRole("radio", { name, exact: typeof name === "string" }).check();
}

type Column = [name: string, type: string, timezone?: string, format?: string];

async function addSource(page: Page, id: string, spec: { table: string; owner: string; label?: string; columns: Column[]; concept?: string }) {
  await add(page, "Source", id);
  if (spec.label) await field(page, "Libellé", spec.label);
  await choose(page, /^Plateforme/, "databricks");
  await field(page, /^Table/, spec.table);
  await field(page, /^Propriétaire/, spec.owner);
  for (const [index, [name, type, timezone, format]] of spec.columns.entries()) {
    await props(page).getByRole("button", { name: "Ajouter une colonne" }).click();
    await field(page, `Nom de la colonne ${index + 1}`, name);
    await choose(page, `Type de la colonne ${index + 1}`, type);
    if (timezone) await field(page, `Fuseau d'origine de la colonne ${index + 1}`, timezone);
    if (format) await field(page, `Format de la colonne ${index + 1}`, format);
  }
  if (spec.concept) await field(page, "Concept rattaché", spec.concept);
}

/** Les propriétés du document (aucun nœud sélectionné) : calendrier et fuseau d'un KPI. */
async function semantics(page: Page, calendar = "civil", timezone = "Europe/Paris") {
  await choose(page, /^Calendrier/, calendar);
  await field(page, /^Fuseau horaire/, timezone);
}

/** Le formulaire « Nouveau concept ou KPI », depuis le catalogue. */
async function createDocument(page: Page, space: Ws, spec: { kind?: "kpi" | "concept"; label: string; id: string; domain: string; owner?: string }) {
  await page.goto(`${space.root}/catalogue`);
  await page.getByRole("link", { name: "Nouveau concept ou KPI" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Nouveau concept ou KPI" })).toBeFocused();
  await page.getByRole("radio", { name: spec.kind === "concept" ? "Concept" : "KPI", exact: true }).check();
  await page.getByLabel(/^Libellé/).fill(spec.label);
  await page.getByLabel(/^Identifiant/).fill(spec.id);
  if (spec.owner) await page.getByLabel(/^Propriétaire/).fill(spec.owner);
  await page.getByLabel(/^Domaine/).selectOption(spec.domain);
  await page.getByRole("button", { name: "Créer et ouvrir l'éditeur" }).click();
  await expect(page.getByRole("heading", { level: 1, name: `${spec.label} : v1 · brouillon` })).toBeVisible();
}

const editorOf = (space: Ws, server = API) => `${server}/api/workspaces/${space.id}/editor`;

/** Le document du brouillon local, tel que le serveur l'a enregistré. */
async function draftOf(request: APIRequestContext, editor: string, id: string): Promise<Draft> {
  const state = await (await request.get(`${editor}/documents/${id}`)).json();
  return state.draft.document as Draft;
}

/** Le YAML canonique que le serveur écrirait pour le brouillon. */
async function yamlOf(request: APIRequestContext, editor: string, id: string): Promise<string> {
  const document = await draftOf(request, editor, id);
  return (await (await request.post(`${editor}/check`, { data: { document, node_id: null } })).json()).yaml as string;
}

/** Le brouillon relu quand l'enregistrement local a eu lieu, pas avant. */
async function savedGraph(page: Page, request: APIRequestContext, editor: string, id: string, nodes: number) {
  await expect(page.getByText(/Enregistré .* \(local\)/)).toBeVisible();
  await expect.poll(async () => (await draftOf(request, editor, id)).graph?.nodes.length).toBe(nodes);
  return (await draftOf(request, editor, id)).graph!;
}

/** Le YAML d'un nœud, dans l'onglet « YAML du nœud » du panneau de propriétés. */
async function nodeYaml(page: Page, id: string) {
  await canvasNode(page, id).click();
  await props(page).getByRole("tab", { name: "YAML du nœud" }).click();
  const yaml = props(page).getByLabel(`YAML de ${id}`);
  await expect(yaml).toBeVisible();
  const text = (await yaml.textContent()) ?? "";
  await props(page).getByRole("tab", { name: "Propriétés" }).click();
  return text;
}

async function submit(page: Page, justification: string): Promise<number> {
  await page.getByRole("button", { name: "Soumettre la proposition" }).click();
  const dialog = page.getByRole("dialog", { name: "Soumettre la proposition" });
  await dialog.getByLabel(/Justification/).fill(justification);
  await dialog.getByRole("button", { name: "Soumettre" }).click();
  const created = page.getByRole("heading", { name: /Proposition n° \d+ créée/ });
  await expect(created).toBeVisible();
  return Number((await created.textContent())!.match(/n° (\d+)/)![1]);
}

/** Un compte rejoint, depuis son poste, le même dépôt distant que anna.k. */
async function join(request: APIRequestContext, server: string, space: Ws) {
  const listed = (await (await request.get(`${server}/api/workspaces`)).json()) as { id: string }[];
  if (!listed.some((item) => item.id === space.id)) {
    const joined = await request.post(`${server}/api/workspaces/join`, { data: { remote_url: space.remote } });
    expect(joined.ok(), await joined.text()).toBe(true);
  }
  const synced = await request.post(`${server}/api/workspaces/${space.id}/sync`, { data: {} });
  expect(synced.ok(), await synced.text()).toBe(true);
}

/** Le référent seul habilité fusionne sa proposition, sans revue. */
async function mergeWithoutReview(page: Page, space: Ws, number: number) {
  await page.goto(`${space.root}/propositions?domain=tous&n=${number}`);
  await expect(page.getByText("Fusionnée sans revue : aucun autre compte habilité")).toBeVisible();
  await page.getByRole("button", { name: "Fusionner", exact: true }).click();
  await expect(page.getByText(`Proposition n° ${number} fusionnée`)).toBeVisible();
}

const catalogueRow = (page: Page, label: string) => page.getByRole("table", { name: "Concepts et KPI" }).getByRole("row", { name: new RegExp(label) });

test("[S-0013-24] formulaire Nouveau concept ou KPI : refus lisibles, identifiant déduit, doublon, annulation, création d'un concept (critère 24)", async ({ page, request }) => {
  await page.goto(`${ws.root}/catalogue`);
  await page.getByRole("link", { name: "Nouveau concept ou KPI" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Nouveau concept ou KPI" })).toBeFocused();
  const label = page.getByLabel(/^Libellé/);
  const identifier = page.getByLabel(/^Identifiant/);
  const owner = page.getByLabel(/^Propriétaire/);
  const domain = page.getByLabel(/^Domaine/);
  const create = page.getByRole("button", { name: "Créer et ouvrir l'éditeur" });
  await expect(owner).toHaveValue("anna.k");
  await expect(page.getByRole("radio", { name: "KPI", exact: true })).toBeChecked();

  // Formulaire vide : le libellé et l'identifiant sont refusés, chacun avec son message.
  await create.click();
  await expect(page.getByText("Donner un libellé.")).toBeVisible();
  await expect(page.getByText(FORMAT)).toBeVisible();
  await expect(label).toHaveAttribute("aria-invalid", "true");
  await expect(identifier).toHaveAttribute("aria-invalid", "true");

  // Domaine non choisi, propriétaire vide.
  await domain.selectOption("");
  await owner.fill("   ");
  await create.click();
  await expect(page.getByText("Choisir un domaine.")).toBeVisible();
  await expect(page.getByText("Indiquer le propriétaire.")).toBeVisible();
  await expect(owner).toHaveAttribute("aria-invalid", "true");
  expect(await seriousViolations(page)).toEqual([]);

  // L'identifiant se déduit du libellé (sans accent) tant qu'on ne l'a pas modifié.
  await label.fill("Taux de conversion été");
  await expect(identifier).toHaveValue("taux-de-conversion-ete");

  // Un identifiant saisi hors du format est refusé.
  await identifier.fill("Taux_Conversion");
  await domain.selectOption("finance");
  await owner.fill("anna.k");
  await create.click();
  await expect(page.getByText(FORMAT)).toBeVisible();
  await expect(identifier).toHaveAttribute("aria-invalid", "true");

  // Un identifiant déjà pris dans l'espace est refusé par le serveur, sur le champ.
  await identifier.fill("revenu-net");
  await create.click();
  await expect(page.getByText(/« revenu-net » existe déjà dans l'espace/)).toBeVisible();
  await expect(identifier).toHaveAttribute("aria-invalid", "true");

  // Un identifiant d'une lettre passe le format du formulaire mais le serveur le refuse
  // (deux caractères au moins) : le refus doit se lire sur le champ, comme les autres.
  await identifier.fill("a");
  await create.click();
  await expect(identifier, "un identifiant d'un caractère est refusé sur le champ Identifiant").toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText(FORMAT)).toBeVisible();
  await identifier.fill("a".repeat(65));
  await create.click();
  await expect(identifier, "un identifiant de 65 caractères est refusé sur le champ Identifiant").toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("heading", { level: 1, name: "Nouveau concept ou KPI" })).toBeVisible();

  // Un double tiret est réservé aux déclinaisons (kpi--entité) : refusé sur le champ, avec le format.
  await identifier.fill("ab--cd");
  await create.click();
  await expect(identifier, "un identifiant contenant deux tirets de suite est refusé sur le champ Identifiant").toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText(FORMAT)).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Nouveau concept ou KPI" })).toBeVisible();

  // Annulation : le lien « Catalogue » quitte le formulaire sans rien créer.
  await page.locator("a.editor-back").click();
  await expect(page).toHaveURL(new RegExp(`#/w/${ws.id}/catalogue$`));
  for (const id of ["taux-de-conversion-ete", "taux_conversion", "a", "a".repeat(65), "ab--cd"]) {
    expect((await request.get(`${editorOf(ws)}/documents/${id}`)).status()).toBe(404);
  }

  // Un concept : le même formulaire, le type « Concept » ; le brouillon naît à la v1.
  await createDocument(page, ws, { kind: "concept", label: "Taux de conversion été", id: "taux-de-conversion-ete", domain: "finance" });
  expect(await seriousViolations(page)).toEqual([]);
  const draft = await draftOf(request, editorOf(ws), "taux-de-conversion-ete");
  expect(draft).toMatchObject({ kind: "concept", label: "Taux de conversion été", data_product: { id: "taux-de-conversion-ete", version: 1, owner: "anna.k", domain: "finance" } });
});

test("[S-0013-25] sémantique d'un KPI : calendrier civil puis fiscal, fuseau, devise, synonymes ; fiche après fusion par le référent seul (critère 25)", async ({ page, request }) => {
  test.setTimeout(180_000);
  await join(request, JULIEN, ws);
  await relay(page, JULIEN);
  const editor = editorOf(ws, JULIEN);
  const id = "visites-par-mois";
  await createDocument(page, ws, { label: "Visites par mois", id, domain: "marketing" });
  await expect(page.getByLabel(/^Propriétaire/)).toHaveValue("julien.h");

  await field(page, "Description", "Visites du site, comptées par mois du calendrier de l'entité.");
  for (const [index, synonym] of ["trafic mensuel", "monthly visits"].entries()) {
    await props(page).getByRole("button", { name: "Ajouter un synonyme" }).click();
    await field(page, `Synonyme ${index + 1}`, synonym);
  }
  await field(page, "Devise", "EUR");

  // Calendrier civil d'abord : le brouillon le range comme `{key: civil}`, sans version.
  await semantics(page, "civil", "Europe/Paris");
  await expect.poll(async () => (await draftOf(request, editor, id)).semantics).toMatchObject({ calendar: { key: "civil" }, timezone: "Europe/Paris", currency: "EUR" });

  await addSource(page, "n01", {
    table: "gold.marketing.fact_visites",
    owner: "julien.h",
    label: "Visites",
    columns: [["visite_id", "string"], ["canal", "string"], ["jour_visite", "date", "Europe/Paris", "yyyy-MM-dd"]],
  });
  await add(page, "Opération temporelle", "n02");
  await choose(page, /^Opération/, "period");
  await choose(page, /^Colonne source/, "jour_visite");
  await field(page, /^Colonne produite/, "mois");
  await choose(page, /^Grain/, "month");
  await add(page, "Agrégation", "n03");
  await props(page).getByRole("button", { name: "Ajouter une mesure" }).click();
  await choose(page, "Colonne source de la mesure 1", "*");
  await field(page, "Colonne produite par la mesure 1", "visites");
  await choose(page, "Fonction de la mesure 1", "count");
  await tick(page, "mois");
  await tick(page, "canal");
  await expect(compilable(page)).toBeVisible();
  await expect(errors(page)).toHaveCount(0);

  // Puis le calendrier fiscal de l'espace : même graphe, toujours compilable.
  await deselect(page);
  await choose(page, /^Calendrier/, "fiscal-nordis@2026.1");
  await expect.poll(async () => (await draftOf(request, editor, id)).semantics).toMatchObject({ calendar: { key: "fiscal-nordis", version: "2026.1" } });
  await expect(compilable(page)).toBeVisible();

  // Un fuseau ou une devise invalides bloquent le schéma, et se corrigent.
  await field(page, /^Fuseau horaire/, "Mars/Phobos");
  await expect(bottom(page).getByText("Schéma invalide")).toBeVisible();
  await expect(errors(page).first()).toBeVisible();
  await field(page, /^Fuseau horaire/, "Europe/Paris");
  await field(page, "Devise", "euro");
  await expect(bottom(page).getByText("Schéma invalide")).toBeVisible();
  await field(page, "Devise", "EUR");
  await expect(bottom(page).getByText("Schéma valide")).toBeVisible();
  await expect(compilable(page)).toBeVisible();

  const yaml = await yamlOf(request, editor, id);
  expect(yaml).toContain("synonyms: [trafic mensuel, monthly visits]");
  expect(yaml).toContain("calendar: {key: fiscal-nordis, version: '2026.1'}");
  expect(yaml).toContain("timezone: Europe/Paris");
  expect(yaml).toContain("currency: EUR");
  expect(await seriousViolations(page)).toEqual([]);

  // Soumission : julien.h est le seul compte habilité sur Marketing, la proposition se fusionne sans revue.
  const number = await submit(page, "Visites par mois, sur le calendrier fiscal.");
  await mergeWithoutReview(page, ws, number);
  expect(git(ws.remote, "show", `main:kpis/${id}.yaml`)).toContain("domain: marketing");

  await page.goto(`${ws.root}/catalogue`);
  await expect(catalogueRow(page, "Visites par mois")).toContainText("Marketing");
  await page.getByRole("table", { name: "Concepts et KPI" }).getByRole("link", { name: "Visites par mois" }).click();
  await expect(page).toHaveURL(new RegExp(`#/w/${ws.id}/fiche/${id}$`));
  await expect(page.getByRole("heading", { level: 1, name: "Visites par mois" })).toBeVisible();
  await expect(page.getByText("Synonymes : trafic mensuel, monthly visits")).toBeVisible();
  const fact = (term: string) => page.locator("dl.facts > div").filter({ has: page.getByRole("term").filter({ hasText: term }) });
  await expect(fact("Calendrier")).toContainText("fiscal-nordis 2026.1");
  await expect(fact("Fuseau d'évaluation")).toContainText("Europe/Paris");
  await expect(fact("Devise")).toContainText("EUR");
  expect(await seriousViolations(page)).toEqual([]);
});

test("[S-0013-26] types de nœud sur des lignes : source, filtre (colonne puis expression), dédoublonnage, calcul, agrégation, YAML et SQL (critère 26)", async ({ page, request }) => {
  test.setTimeout(180_000);
  const editor = editorOf(ws);
  const id = "factures-nettes";
  await createDocument(page, ws, { label: "Factures nettes", id, domain: "finance" });
  await semantics(page);

  await addSource(page, "n01", {
    table: "gold.finance.fact_facturation",
    owner: "anna.k",
    label: "Factures",
    columns: [
      ["facture_id", "string"], ["entite", "string"], ["statut", "string"],
      ["date_facture", "date", "Europe/Paris", "yyyy-MM-dd"], ["montant_ttc", "decimal"], ["montant_taxes", "decimal"],
    ],
  });

  await add(page, "Filtre", "n02");
  await field(page, "Libellé", "Factures validées");
  await choose(page, /^Colonne requis/, "statut");
  await choose(page, /^Opérateur/, "equals");
  await field(page, /^Valeur/, "validée");
  await radio(page, "exclues");

  await add(page, "Filtre", "n03");
  await field(page, "Libellé", "Montant positif");
  await radio(page, "Expression SQL");
  await props(page).getByRole("textbox", { name: /^Expression/ }).fill("montant_ttc > 0");
  await radio(page, "gardées");

  await add(page, "Dédoublonnage", "n04");
  await field(page, "Libellé", "Une ligne par facture");
  await tick(page, "facture_id");
  await props(page).getByRole("button", { name: "Ajouter un critère" }).click();
  await choose(page, "Colonne du critère 1", "date_facture");
  await choose(page, "Sens du critère 1", "desc");

  await add(page, "Calcul de colonne", "n05");
  await field(page, "Libellé", "Montant hors taxes");
  await field(page, /^Colonne produite/, "montant_ht");
  await field(page, /^Expression/, "montant_ttc - montant_taxes");
  await choose(page, "Type de la colonne", "decimal");

  await add(page, "Agrégation", "n06");
  for (const [index, [source, target, fn]] of [["montant_ht", "revenu_ht", "sum"], ["*", "nb_factures", "count"]].entries()) {
    await props(page).getByRole("button", { name: "Ajouter une mesure" }).click();
    await choose(page, `Colonne source de la mesure ${index + 1}`, source);
    await field(page, `Colonne produite par la mesure ${index + 1}`, target);
    await choose(page, `Fonction de la mesure ${index + 1}`, fn);
  }
  await tick(page, "entite");

  await expect(page.getByText("schéma 1 · 6 nœuds · 5 arêtes")).toBeVisible();
  await expect(errors(page)).toHaveCount(0);
  await expect(compilable(page)).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);

  const graph = await savedGraph(page, request, editor, id, 6);
  expect(graph.output).toBe("n06");
  expect(graph.nodes).toMatchObject([
    { id: "n01", type: "source", platform: "databricks", table: "gold.finance.fact_facturation", owner: "anna.k" },
    { id: "n02", type: "filter", inputs: ["n01"], condition: "statut:equals:validée", nulls: "drop" },
    { id: "n03", type: "filter", inputs: ["n02"], condition: { expr: "montant_ttc > 0" }, nulls: "keep" },
    { id: "n04", type: "deduplicate", inputs: ["n03"], keys: ["facture_id"], keep: { order_by: [["date_facture", "desc"]] } },
    { id: "n05", type: "compute", inputs: ["n04"], column: "montant_ht", expr: "montant_ttc - montant_taxes", column_type: "decimal" },
    { id: "n06", type: "aggregate", inputs: ["n05"], group_by: ["entite"], measures: [["montant_ht", "revenu_ht", "sum"], ["*", "nb_factures", "count"]] },
  ]);
  const yaml = await yamlOf(request, editor, id);
  for (const type of ["source", "filter", "deduplicate", "compute", "aggregate"]) expect(yaml).toContain(`type: ${type}`);
  expect(yaml).toContain("condition: statut:equals:validée");
  expect(yaml).toContain("output: n06");
  expect(await nodeYaml(page, "n04")).toContain("order_by");

  // Le SQL de chaque plateforme est produit pour le graphe entier.
  await bottom(page).getByRole("tab", { name: "SQL compilé" }).click();
  await expect(bottom(page).getByLabel("SQL databricks")).toContainText("montant_ht");
  await bottom(page).getByRole("radio", { name: "Snowflake" }).check();
  await expect(bottom(page).getByLabel("SQL snowflake")).toContainText("montant_ht");
});

test("[S-0013-27] types de nœud temporels : conversion en date, changement de fuseau, découpage en périodes, fenêtre glissante (critère 27)", async ({ page, request }) => {
  test.setTimeout(180_000);
  const editor = editorOf(ws);
  const id = "visites-glissantes";
  await createDocument(page, ws, { label: "Visites glissantes", id, domain: "finance" });
  await semantics(page);

  await addSource(page, "n01", {
    table: "gold.finance.fact_visites",
    owner: "anna.k",
    columns: [["visite_id", "string"], ["jour", "string"], ["horodatage", "timestamp", "UTC", "yyyy-MM-dd HH:mm:ss"], ["montant", "decimal"]],
  });

  await add(page, "Opération temporelle", "n02");
  await choose(page, /^Opération/, "to_date");
  await choose(page, /^Colonne source/, "jour");
  await field(page, /^Colonne produite/, "date_jour");
  await field(page, /^Fuseau d'évaluation/, "Europe/Paris");
  await field(page, /^Format$/, "yyyy-MM-dd");

  await add(page, "Opération temporelle", "n03");
  await choose(page, /^Opération/, "convert_timezone");
  await choose(page, /^Colonne source/, "horodatage");
  await field(page, /^Colonne produite/, "horodatage_paris");
  await field(page, /^Fuseau cible/, "Europe/Paris");

  await add(page, "Opération temporelle", "n04");
  await choose(page, /^Opération/, "period");
  await choose(page, /^Colonne source/, "date_jour");
  await field(page, /^Colonne produite/, "mois");
  await choose(page, /^Grain/, "month");

  await add(page, "Opération temporelle", "n05");
  await choose(page, /^Opération/, "window");
  await choose(page, /^Colonne source/, "montant");
  await field(page, /^Colonne produite/, "montant_glissant");
  await choose(page, /^Fonction/, "sum");
  await field(page, /^Fenêtre/, "ROWS BETWEEN 2 PRECEDING AND CURRENT ROW");
  await props(page).getByRole("button", { name: "Ajouter un critère" }).click();
  await choose(page, "Colonne du critère 1", "horodatage_paris");
  await choose(page, "Sens du critère 1", "asc");

  await add(page, "Agrégation", "n06");
  await props(page).getByRole("button", { name: "Ajouter une mesure" }).click();
  await choose(page, "Colonne source de la mesure 1", "montant_glissant");
  await field(page, "Colonne produite par la mesure 1", "total_glissant");
  await choose(page, "Fonction de la mesure 1", "max");
  await tick(page, "mois");

  await expect(page.getByText("schéma 1 · 6 nœuds · 5 arêtes")).toBeVisible();
  await expect(errors(page)).toHaveCount(0);
  await expect(compilable(page)).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);

  const graph = await savedGraph(page, request, editor, id, 6);
  expect(graph.nodes).toMatchObject([
    { id: "n01", type: "source" },
    { id: "n02", type: "temporal", operation: "to_date", column: "jour", target: "date_jour", timezone: "Europe/Paris", format: "yyyy-MM-dd" },
    { id: "n03", type: "temporal", operation: "convert_timezone", column: "horodatage", target: "horodatage_paris", to: "Europe/Paris" },
    { id: "n04", type: "temporal", operation: "period", column: "date_jour", target: "mois", grain: "month" },
    { id: "n05", type: "temporal", operation: "window", column: "montant", target: "montant_glissant", function: "sum", frame: "ROWS BETWEEN 2 PRECEDING AND CURRENT ROW", order_by: [["horodatage_paris", "asc"]] },
    { id: "n06", type: "aggregate", group_by: ["mois"], measures: [["montant_glissant", "total_glissant", "max"]] },
  ]);
  const yaml = await yamlOf(request, editor, id);
  for (const operation of ["to_date", "convert_timezone", "period", "window"]) expect(yaml).toContain(`operation: ${operation}`);

  // L'aide du champ Fenêtre donne un cadre SQL valide ; un cadre illisible (« 3 rows preceding »)
  // s'annonce comme une erreur du nœud, sans faire échouer le serveur.
  await canvasNode(page, "n05").click();
  await expect(props(page).getByText("Ex. ROWS BETWEEN 2 PRECEDING AND CURRENT ROW")).toBeVisible();
  await field(page, /^Fenêtre/, "3 rows preceding");
  await expect(errors(page).filter({ hasText: "n05" }), "un cadre de fenêtre illisible est une erreur de validation").toHaveCount(1);
  await expect(page.getByRole("alert").filter({ hasText: "Serveur local injoignable" })).toHaveCount(0);
  await field(page, /^Fenêtre/, "ROWS BETWEEN 2 PRECEDING AND CURRENT ROW");
  await expect(errors(page)).toHaveCount(0);
  await expect(compilable(page)).toBeVisible();
});

test("[S-0013-28] type de nœud jointure : entrées gauche et droite, clés, cardinalité, contournement justifié (critère 28)", async ({ page, request }) => {
  test.setTimeout(180_000);
  const editor = editorOf(ws);
  const id = "ventes-par-segment";
  await createDocument(page, ws, { label: "Ventes par segment", id, domain: "finance" });
  await semantics(page);

  await addSource(page, "n01", {
    table: "gold.ventes.fact_ventes",
    owner: "anna.k",
    label: "Ventes",
    columns: [["vente_id", "string"], ["client_id", "string"], ["montant", "decimal"]],
  });
  await addSource(page, "n02", { table: "gold.ventes.dim_client", owner: "anna.k", label: "Clients", columns: [["client_id", "string"], ["segment", "string"]] });

  // Le nœud n01 sélectionné, la jointure s'y relie par la gauche et devient la sortie.
  await canvasNode(page, "n01").click();
  await add(page, "Jointure", "n03");
  await props(page).getByRole("tab", { name: "Entrées" }).click();
  await expect(props(page).getByLabel(/^Entrée gauche/)).toHaveValue("n01");
  await choose(page, /^Entrée droite/, "n02");
  await props(page).getByRole("tab", { name: "Propriétés" }).click();
  await choose(page, /^Type de jointure/, "inner");
  await props(page).getByRole("button", { name: "Ajouter une paire de clés" }).click();
  await choose(page, "Clé gauche 1", "client_id");
  await choose(page, "Clé droite 1", "client_id");
  await radio(page, "N:1");
  await radio(page, "requis");

  await add(page, "Agrégation", "n04");
  await props(page).getByRole("button", { name: "Ajouter une mesure" }).click();
  await choose(page, "Colonne source de la mesure 1", "montant");
  await field(page, "Colonne produite par la mesure 1", "ca");
  await choose(page, "Fonction de la mesure 1", "sum");
  await tick(page, "segment");

  await expect(page.getByText("schéma 1 · 4 nœuds · 3 arêtes")).toBeVisible();
  await expect(errors(page)).toHaveCount(0);
  await expect(compilable(page)).toBeVisible();
  const graph = await savedGraph(page, request, editor, id, 4);
  expect(graph.output).toBe("n04");
  expect(graph.nodes[2]).toMatchObject({ id: "n03", type: "join", inputs: { left: "n01", right: "n02" }, how: "inner", keys: [["client_id", "client_id"]], cardinality: "N:1", check: "required" });
  const joinYaml = await nodeYaml(page, "n03");
  expect(joinYaml).toContain("inputs: {left: n01, right: n02}");
  expect(joinYaml).toContain("cardinality: N:1");

  // Contourner le contrôle de cardinalité exige une raison : l'erreur se voit, puis le contournement s'annonce.
  await canvasNode(page, "n03").click();
  await radio(page, "contourné");
  await expect(errors(page).first()).toBeVisible();
  await field(page, /^Raison du contournement/, "Les clients sont dédoublonnés en amont, par la plateforme.");
  await expect(errors(page)).toHaveCount(0);
  await expect(bottom(page).getByRole("listitem").filter({ hasText: "INFO" }).filter({ hasText: "Contrôle de cardinalité contourné" })).toBeVisible();
  await expect(compilable(page)).toBeVisible();
  await expect.poll(async () => (await draftOf(request, editor, id)).graph!.nodes[2]).toMatchObject({ check: "bypass", bypass_reason: "Les clients sont dédoublonnés en amont, par la plateforme." });
});

test("[S-0013-29] type de nœud union : entrées ordonnées, correspondance des colonnes, mode sans doublons (critère 29)", async ({ page, request }) => {
  test.setTimeout(180_000);
  const editor = editorOf(ws);
  const id = "commandes-toutes-voies";
  await createDocument(page, ws, { label: "Commandes toutes voies", id, domain: "finance" });
  await semantics(page);

  await addSource(page, "n01", { table: "gold.ventes.commandes", owner: "anna.k", label: "Magasins", columns: [["commande_id", "string"], ["canal", "string"], ["montant", "decimal"]] });
  await addSource(page, "n02", { table: "gold.ventes.commandes_web", owner: "anna.k", label: "Web", columns: [["id", "string"], ["canal_web", "string"], ["montant_web", "decimal"]] });

  await canvasNode(page, "n01").click();
  await add(page, "Union", "n03");
  await props(page).getByRole("tab", { name: "Entrées" }).click();
  await props(page).getByRole("button", { name: "Ajouter une entrée" }).click();
  await expect(props(page).getByLabel("Entrée 2")).toHaveValue("n02");
  await props(page).getByRole("tab", { name: "Propriétés" }).click();
  await radio(page, /\(all\)/);
  const rows: [string, string, string][] = [["commande_id", "commande_id", "id"], ["canal", "canal", "canal_web"], ["montant", "montant", "montant_web"]];
  for (const [index, [name, first, second]] of rows.entries()) {
    await props(page).getByRole("button", { name: "Ajouter une colonne" }).click();
    await field(page, `Colonne produite ${index + 1}`, name);
    await choose(page, `Colonne de n01 pour la ligne ${index + 1}`, first);
    await choose(page, `Colonne de n02 pour la ligne ${index + 1}`, second);
  }

  await add(page, "Agrégation", "n04");
  await props(page).getByRole("button", { name: "Ajouter une mesure" }).click();
  await choose(page, "Colonne source de la mesure 1", "montant");
  await field(page, "Colonne produite par la mesure 1", "ca");
  await choose(page, "Fonction de la mesure 1", "sum");
  await tick(page, "canal");

  await expect(page.getByText("schéma 1 · 4 nœuds · 3 arêtes")).toBeVisible();
  await expect(errors(page)).toHaveCount(0);
  await expect(compilable(page)).toBeVisible();
  const graph = await savedGraph(page, request, editor, id, 4);
  expect(graph.output).toBe("n04");
  expect(graph.nodes[2]).toMatchObject({
    id: "n03",
    type: "union",
    inputs: ["n01", "n02"],
    mode: "all",
    columns: [
      { name: "commande_id", from: { n01: "commande_id", n02: "id" } },
      { name: "canal", from: { n01: "canal", n02: "canal_web" } },
      { name: "montant", from: { n01: "montant", n02: "montant_web" } },
    ],
  });

  // Sans doublons, puis l'ordre des entrées s'inverse : le YAML suit.
  await canvasNode(page, "n03").click();
  await radio(page, /\(distinct\)/);
  await props(page).getByRole("tab", { name: "Entrées" }).click();
  await props(page).getByRole("button", { name: "Descendre l'entrée n01" }).click();
  await expect.poll(async () => (await draftOf(request, editor, id)).graph!.nodes[2]).toMatchObject({ mode: "distinct", inputs: ["n02", "n01"] });
  await expect(compilable(page)).toBeVisible();
  const yaml = await yamlOf(request, editor, id);
  expect(yaml).toContain("mode: distinct");
  expect(yaml).toContain("inputs: [n02, n01]");
});

test("[S-0013-30] types de nœud référence à un KPI et opération entre métriques ; version introuvable signalée puis corrigée (critère 30)", async ({ page, request }) => {
  test.setTimeout(180_000);
  const editor = editorOf(ws);
  const id = "revenu-net-en-milliers";
  await createDocument(page, ws, { label: "Revenu net en milliers", id, domain: "finance" });
  await semantics(page);

  await add(page, "Référence à un KPI", "n01");
  await choose(page, /^KPI référencé/, "revenu-net");
  await field(page, /^Version/, "4");
  await add(page, "Opération entre métriques", "n02");
  await props(page).getByRole("button", { name: "Ajouter une métrique" }).click();
  await field(page, "Nom de la métrique 1", "revenu_net_milliers");
  await field(page, "Expression de la métrique 1", "revenu_net / 1000");
  await radio(page, /agréger puis calculer/);

  await expect(page.getByText("schéma 1 · 2 nœuds · 1 arête")).toBeVisible();
  await expect(errors(page)).toHaveCount(0);
  await expect(compilable(page)).toBeVisible();
  const graph = await savedGraph(page, request, editor, id, 2);
  expect(graph.output).toBe("n02");
  expect(graph.nodes).toMatchObject([
    { id: "n01", type: "kpi_ref", kpi: "revenu-net", version: 4 },
    { id: "n02", type: "metric_op", inputs: ["n01"], metrics: [{ name: "revenu_net_milliers", expr: "revenu_net / 1000" }], order: "aggregate_first" },
  ]);
  expect(await yamlOf(request, editor, id)).toContain("kpi: revenu-net");

  // Une version qui n'existe pas : l'erreur nomme le KPI, mène au nœud, et disparaît une fois corrigée.
  await canvasNode(page, "n01").click();
  await field(page, /^Version/, "99");
  const unknown = errors(page).filter({ hasText: "introuvable" });
  await expect(unknown).toHaveCount(1);
  await expect(unknown).toContainText("revenu-net");
  await expect(unknown).toContainText("n01");
  await canvasNode(page, "n02").click();
  await unknown.getByRole("button", { name: "Aller au nœud n01" }).click();
  await expect(canvasNode(page, "n01")).toHaveClass(/is-selected/);
  await field(page, /^Version/, "4");
  await expect(errors(page)).toHaveCount(0);
  await expect(compilable(page)).toBeVisible();
});

test("[S-0013-31] concept puis KPI : le concept fusionné se référence depuis une source, la fiche du KPI le liste (critère 31)", async ({ page, request }) => {
  test.setTimeout(240_000);
  await join(request, JULIEN, ws);
  await relay(page, JULIEN);
  const editor = editorOf(ws, JULIEN);

  // Le concept : une entité, sa clé, ses attributs ; il se passe de graphe.
  await createDocument(page, ws, { kind: "concept", label: "Visiteur", id: "visiteur", domain: "marketing" });
  await field(page, "Description", "Personne qui a ouvert au moins une session sur le site.");
  await props(page).getByRole("button", { name: "Déclarer l'entité" }).click();
  for (const [index, [name, type]] of [["visiteur_id", "string"], ["canal", "string"]].entries()) {
    await props(page).getByRole("button", { name: "Ajouter un attribut" }).click();
    await field(page, `Nom de l'attribut ${index + 1}`, name);
    await choose(page, `Type de l'attribut ${index + 1}`, type);
  }
  await tick(page, "visiteur_id");
  await expect(errors(page)).toHaveCount(0);
  await expect(bottom(page).getByText("Schéma valide")).toBeVisible();
  // Un concept sans graphe est un document valide : il n'est pas « non compilable ».
  await expect.soft(bottom(page).getByText("Non compilable"), "un concept valide sans graphe n'est pas signalé non compilable").toHaveCount(0);
  await expect.poll(async () => (await draftOf(request, editor, "visiteur")).entity).toMatchObject({ key: ["visiteur_id"], attributes: [{ name: "visiteur_id", type: "string" }, { name: "canal", type: "string" }] });
  expect(await seriousViolations(page)).toEqual([]);

  const concept = await submit(page, "Le visiteur du site, clé et attributs.");
  await mergeWithoutReview(page, ws, concept);
  await page.goto(`${ws.root}/catalogue`);
  await expect(catalogueRow(page, "Visiteur")).toContainText("Marketing");
  await page.goto(`${ws.root}/fiche/visiteur`);
  await expect(page.getByRole("heading", { level: 1, name: "Visiteur" })).toBeVisible();
  await expect(page.getByText("visiteur_id", { exact: true }).first()).toBeVisible();

  // Le KPI : sa source se rattache au concept fusionné.
  const id = "sessions-par-canal";
  await createDocument(page, ws, { label: "Sessions par canal", id, domain: "marketing" });
  await semantics(page);
  await addSource(page, "n01", {
    table: "gold.marketing.fact_sessions",
    owner: "julien.h",
    columns: [["session_id", "string"], ["visiteur_id", "string"], ["canal", "string"]],
    concept: "visiteur-inconnu",
  });
  await add(page, "Agrégation", "n02");
  await props(page).getByRole("button", { name: "Ajouter une mesure" }).click();
  await choose(page, "Colonne source de la mesure 1", "*");
  await field(page, "Colonne produite par la mesure 1", "sessions");
  await choose(page, "Fonction de la mesure 1", "count");
  await tick(page, "canal");

  // Un concept qui n'existe pas dans l'espace est une erreur de validation : elle nomme le concept, bloque la soumission.
  const unknown = errors(page).filter({ hasText: "visiteur-inconnu" });
  await expect(unknown).toHaveCount(1);
  await expect(unknown).toContainText("n01");
  await page.getByRole("button", { name: "Soumettre la proposition" }).click({ force: true });
  await expect(page.getByRole("alert")).toContainText(/Soumission bloquée : \d+ erreurs? à corriger/);
  await canvasNode(page, "n01").click();
  await field(page, "Concept rattaché", "visiteur");
  await expect(errors(page)).toHaveCount(0);
  await expect(compilable(page)).toBeVisible();
  await expect.poll(async () => (await draftOf(request, editor, id)).graph!.nodes[0]).toMatchObject({ type: "source", concept: "visiteur" });
  expect(await nodeYaml(page, "n01")).toContain("concept: visiteur");

  const kpi = await submit(page, "Sessions par canal, rattachées au concept Visiteur.");
  await mergeWithoutReview(page, ws, kpi);
  await page.goto(`${ws.root}/fiche/${id}?tab=dependances`);
  await expect(page.getByRole("heading", { level: 1, name: "Sessions par canal" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Références" }).getByRole("link", { name: "Visiteur" })).toBeVisible();
  await page.goto(`${ws.root}/fiche/visiteur?tab=dependances`);
  await expect(page.getByRole("region", { name: "Référencé par" }).getByRole("link", { name: "Sessions par canal" })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});

test("[S-0013-32] erreurs de construction : un découpage en périodes sur une colonne sans fuseau est signalé, mène au nœud, bloque la soumission, puis se corrige (critère 32)", async ({ page, request }) => {
  test.setTimeout(180_000);
  const editor = editorOf(ws);
  const id = "ventes-par-jour";
  await createDocument(page, ws, { label: "Ventes par jour", id, domain: "finance" });
  await semantics(page);

  await addSource(page, "n01", {
    table: "gold.ventes.fact_ventes",
    owner: "anna.k",
    columns: [["vente_id", "string"], ["passee_le", "timestamp", "UTC", "yyyy-MM-dd HH:mm:ss"], ["montant", "decimal"]],
  });
  await add(page, "Opération temporelle", "n02");
  await choose(page, /^Opération/, "period");
  await choose(page, /^Colonne source/, "passee_le");
  await field(page, /^Colonne produite/, "jour");
  await choose(page, /^Grain/, "day");
  await add(page, "Agrégation", "n03");
  await props(page).getByRole("button", { name: "Ajouter une mesure" }).click();
  await choose(page, "Colonne source de la mesure 1", "montant");
  await field(page, "Colonne produite par la mesure 1", "ca");
  await choose(page, "Fonction de la mesure 1", "sum");
  await tick(page, "jour");

  // L'erreur est lisible, rattachée à n02, et bloque la soumission.
  const problem = errors(page).filter({ hasText: "fuseau explicite" });
  await expect(problem).toHaveCount(1);
  await expect(problem).toContainText("n02");
  await expect(bottom(page).getByText("Non compilable")).toBeVisible();
  await page.getByRole("button", { name: "Soumettre la proposition" }).click({ force: true });
  await expect(page.getByRole("alert")).toContainText(/Soumission bloquée : \d+ erreurs? à corriger/);
  await canvasNode(page, "n03").click();
  await problem.getByRole("button", { name: "Aller au nœud n02" }).click();
  await expect(props(page).getByRole("heading", { name: "Opération temporelle" })).toBeVisible();
  await expect(canvasNode(page, "n02")).toHaveClass(/is-selected/);
  expect(await seriousViolations(page)).toEqual([]);

  // Correction : un changement de fuseau en amont, puis n02 lit la colonne convertie.
  await canvasNode(page, "n01").click();
  await add(page, "Opération temporelle", "n04");
  await choose(page, /^Opération/, "convert_timezone");
  await choose(page, /^Colonne source/, "passee_le");
  await field(page, /^Colonne produite/, "passee_locale");
  await field(page, /^Fuseau cible/, "Europe/Paris");
  await canvasNode(page, "n02").click();
  await props(page).getByRole("tab", { name: "Entrées" }).click();
  await props(page).getByRole("combobox", { name: /^Entrée/ }).selectOption("n04");
  await props(page).getByRole("tab", { name: "Propriétés" }).click();
  await choose(page, /^Colonne source/, "passee_locale");

  await expect(errors(page)).toHaveCount(0);
  await expect(compilable(page)).toBeVisible();
  const graph = await savedGraph(page, request, editor, id, 4);
  expect(graph.nodes[1]).toMatchObject({ id: "n02", inputs: ["n04"], column: "passee_locale" });
  expect(graph.output).toBe("n03");

  // La soumission n'est plus bloquée : la boîte de dialogue s'ouvre.
  await page.getByRole("button", { name: "Soumettre la proposition" }).click();
  await expect(page.getByRole("dialog", { name: "Soumettre la proposition" })).toBeVisible();
});

test("[S-0013-33] brouillon de création : on quitte l'éditeur, on le reprend (lien du refus, catalogue), rien n'est perdu ; recréer le même identifiant est refusé (critère 33)", async ({ page, request }) => {
  test.setTimeout(180_000);
  const editor = editorOf(ws);
  const id = "stock-moyen";
  await createDocument(page, ws, { label: "Stock moyen", id, domain: "finance" });
  await semantics(page, "civil", "Europe/Paris");
  await field(page, "Devise", "EUR");
  await addSource(page, "n01", { table: "gold.supply.fact_stock", owner: "anna.k", label: "Stock", columns: [["entrepot", "string"], ["quantite", "decimal"]] });
  await expect(page.getByText(/Enregistré .* \(local\)/)).toBeVisible();
  await expect.poll(async () => (await draftOf(request, editor, id)).graph?.nodes.length).toBe(1);
  // Un brouillon qu'on vient de créer n'est pas « repris » : pas de bannière de reprise.
  // Assertion « soft » : si elle échoue, la suite du parcours tourne quand même.
  await expect.soft(page.getByText("Brouillon local repris"), "la bannière de reprise ne s'affiche pas sur un brouillon qu'on vient de créer").toHaveCount(0);

  // On quitte par le lien « Catalogue » : le brouillon reste sur le poste.
  await page.locator("a.editor-back").click();
  await expect(page).toHaveURL(new RegExp(`#/w/${ws.id}/catalogue$`));
  await expect(page.getByRole("heading", { level: 1, name: "Catalogue" })).toBeVisible();
  await expect(catalogueRow(page, "Stock moyen")).toHaveCount(0);

  // Recréer le même identifiant est refusé, avec le renvoi vers le brouillon existant.
  await page.getByRole("link", { name: "Nouveau concept ou KPI" }).click();
  await page.getByLabel(/^Libellé/).fill("Stock moyen");
  await page.getByLabel(/^Domaine/).selectOption("finance");
  await page.getByRole("button", { name: "Créer et ouvrir l'éditeur" }).click();
  await expect(page.getByText(/Un brouillon local de « stock-moyen » existe déjà : le reprendre ou l.abandonner dans « Mes brouillons » du catalogue/)).toBeVisible();
  await expect(page.getByLabel(/^Identifiant/)).toHaveAttribute("aria-invalid", "true");

  // Le refus propose de reprendre le brouillon : il se rouvre tel qu'on l'a laissé.
  await page.getByRole("link", { name: "Reprendre le brouillon" }).click();
  await expect(page).toHaveURL(new RegExp(`#/w/${ws.id}/editeur\\?from=${id}$`));
  await expect(page.getByRole("heading", { level: 1, name: "Stock moyen : v1 · brouillon" })).toBeVisible();
  await expect(canvasNode(page, "n01")).toBeVisible();
  // Reprendre un brouillon local l'annonce : bannière avec la date d'enregistrement.
  await expect(page.getByText("Brouillon local repris")).toBeVisible();
  await expect(page.getByText(/Enregistré .* sur ce poste/)).toBeVisible();
  await expect(page.getByText("schéma 1 · 1 nœud · 0 arête")).toBeVisible();
  await canvasNode(page, "n01").click();
  await expect(props(page).getByLabel(/^Table/)).toHaveValue("gold.supply.fact_stock");
  await expect(props(page).getByLabel("Nom de la colonne 2")).toHaveValue("quantite");
  await deselect(page);
  await expect(props(page).getByLabel(/^Calendrier/)).toHaveValue("civil");
  await expect(props(page).getByLabel("Devise")).toHaveValue("EUR");

  // Un rechargement de la page garde aussi tout.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Stock moyen : v1 · brouillon" })).toBeVisible();
  await expect(canvasNode(page, "n01")).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);

  // Le catalogue liste les brouillons de création : reprendre rouvre l'éditeur, abandonner supprime le brouillon.
  await page.locator("a.editor-back").click();
  const drafts = page.getByRole("region", { name: "Mes brouillons" });
  const mine = () => drafts.getByRole("listitem").filter({ hasText: "Stock moyen" });
  await expect(mine()).toHaveCount(1);
  await expect(mine().getByRole("button", { name: /Abandonner/ })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
  await mine().getByRole("link", { name: /Reprendre/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Stock moyen : v1 · brouillon" })).toBeVisible();
  await expect(canvasNode(page, "n01")).toBeVisible();

  await page.locator("a.editor-back").click();

  // Un brouillon illisible (type inconnu) est listé aussi : on ne peut que l'abandonner.
  const orphan = await request.put(`${editor}/documents/orphelin/draft`, { data: { document: { kind: "inconnu" }, positions: {}, highest: 0, base_version: null } });
  expect(orphan.ok()).toBe(true);
  await page.reload();
  const broken = drafts.getByRole("listitem").filter({ hasText: "orphelin" });
  await expect(broken).toHaveCount(1);
  await expect(broken.getByRole("link", { name: /Reprendre/ })).toHaveCount(0);
  await expect(broken.getByRole("button", { name: /Abandonner/ })).toBeVisible();

  // Abandon d'un brouillon : confirmation modale, au clavier. Le focus part sur « Annuler ».
  const confirm = page.getByRole("alertdialog", { name: "Abandonner le brouillon ?" });
  const trigger = mine().getByRole("button", { name: /Abandonner/ });
  await trigger.click();
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText("Le brouillon local « Stock moyen » sera supprimé.");
  await expect(confirm.getByRole("button", { name: "Annuler" })).toBeFocused();
  // Tab reste dans la boîte : Annuler, Abandonner, puis retour à Annuler (et Maj+Tab dans l'autre sens).
  await page.keyboard.press("Tab");
  await expect(confirm.getByRole("button", { name: "Abandonner" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(confirm.getByRole("button", { name: "Annuler" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(confirm.getByRole("button", { name: "Abandonner" })).toBeFocused();
  // Échap annule : le brouillon reste, le focus revient sur le bouton qui a ouvert la boîte.
  await page.keyboard.press("Escape");
  await expect(confirm).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(mine()).toHaveCount(1);
  expect((await request.get(`${editor}/documents/${id}`)).status()).toBe(200);
  // Le bouton « Annuler » annule aussi.
  await trigger.click();
  await confirm.getByRole("button", { name: "Annuler" }).click();
  await expect(confirm).toHaveCount(0);
  await expect(mine()).toHaveCount(1);

  // Le dessin du graphe (positions) est gardé avec le brouillon.
  const positionsOf = async () => Object.keys((await (await request.get(`${editor}/documents/${id}`)).json()).positions ?? {});
  expect(await positionsOf()).toContain("n01");

  // Confirmer supprime le brouillon, sans le laisser côté serveur ; le focus passe au brouillon voisin.
  await trigger.click();
  await confirm.getByRole("button", { name: "Abandonner" }).click();
  await expect(mine()).toHaveCount(0);
  await expect(broken).toHaveCount(1);
  await expect(broken.getByRole("button", { name: /Abandonner/ }), "le focus passe au brouillon restant").toBeFocused();
  expect((await request.get(`${editor}/documents/${id}`)).status()).toBe(404);

  // Dernier brouillon : le focus revient sur le titre de la page, la section disparaît.
  await broken.getByRole("button", { name: /Abandonner/ }).click();
  await confirm.getByRole("button", { name: "Abandonner" }).click();
  await expect(drafts).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "Catalogue" })).toBeFocused();

  // L'identifiant est de nouveau libre, et le dessin de l'ancien brouillon a disparu avec lui.
  await createDocument(page, ws, { label: "Stock moyen", id, domain: "finance" });
  expect(await positionsOf()).toEqual([]);
});

test("[S-0013-34] soumission d'un nouveau KPI revue par d'autres comptes : l'auteure ne peut pas approuver, deux validateurs, fusion, catalogue et fiche (critère 34)", async ({ page, request }) => {
  test.setTimeout(240_000);
  const id = "chiffre-affaires-annuel";
  const label = "Chiffre d'affaires annuel";
  await createDocument(page, ws, { label, id, domain: "finance" });
  await semantics(page, "civil", "Europe/Paris");
  await addSource(page, "n01", {
    table: "gold.finance.fact_facturation",
    owner: "anna.k",
    label: "Factures",
    columns: [["entite", "string"], ["montant_ttc", "decimal"]],
  });
  await add(page, "Agrégation", "n02");
  await props(page).getByRole("button", { name: "Ajouter une mesure" }).click();
  await choose(page, "Colonne source de la mesure 1", "montant_ttc");
  await field(page, "Colonne produite par la mesure 1", "chiffre_affaires");
  await choose(page, "Fonction de la mesure 1", "sum");
  await tick(page, "entite");
  await expect(compilable(page)).toBeVisible();
  await expect(errors(page)).toHaveCount(0);

  const number = await submit(page, "Premier chiffre d'affaires annuel de Finance.");
  expect((await request.get(`${editorOf(ws)}/documents/${id}`)).status()).toBe(404);

  // Côté auteure : deux validations requises, aucune n'est la sienne.
  await page.goto(`${ws.root}/propositions?domain=tous&n=${number}`);
  const entry = page.getByRole("list", { name: "File des propositions" }).getByRole("link").filter({ hasText: label });
  await expect(entry).toHaveAttribute("aria-current", "true");
  await expect(entry).toContainText("Validations : 0 / 2");
  await expect(page.getByRole("heading", { level: 2, name: `Nouveau document : ${label}` })).toBeVisible();
  const approve = page.getByRole("button", { name: "Approuver (0 / 2)" });
  await expect(approve).toHaveAttribute("aria-disabled", "true");
  await approve.hover();
  await expect(page.getByRole("tooltip")).toHaveText("Vous êtes l'auteur de cette proposition : un autre compte doit l'approuver.");
  expect(await seriousViolations(page)).toEqual([]);

  // claire.m et marc.d, validateurs Finance, approuvent depuis leur poste.
  for (const server of [CLAIRE, MARC]) {
    await join(request, server, ws);
    const approved = await request.post(`${server}/api/workspaces/${ws.id}/proposals/${number}/reviews`, { data: { event: "approve" } });
    expect(approved.ok(), await approved.text()).toBe(true);
  }
  await page.reload();
  await expect(entry).toContainText("Validations : 2 / 2");
  await expect(entry).toContainText("prête à fusionner");
  await page.getByRole("button", { name: "Fusionner", exact: true }).click();
  await expect(page.getByText(`Proposition n° ${number} fusionnée`)).toBeVisible();
  expect(git(ws.remote, "ls-tree", "-r", "--name-only", "main").split("\n")).toContain(`kpis/${id}.yaml`);
  expect(git(ws.remote, "show", `main:kpis/${id}.yaml`)).toContain("domain: finance");
  // La soumission supprime le brouillon mais garde le dessin du graphe : il est encore là après la fusion.
  const reopened = await (await request.get(`${editorOf(ws)}/documents/${id}`)).json();
  expect(Object.keys(reopened.positions ?? {}), "le dessin du graphe est gardé à la soumission").toEqual(expect.arrayContaining(["n01", "n02"]));

  // Catalogue, puis fiche : le KPI y est, version 1, validé.
  await page.getByRole("navigation", { name: "Navigation de l'espace" }).getByRole("link", { name: "Catalogue" }).click();
  await expect(catalogueRow(page, label)).toContainText("Finance");
  expect(await seriousViolations(page)).toEqual([]);
  await page.getByRole("table", { name: "Concepts et KPI" }).getByRole("link", { name: label }).click();
  await expect(page).toHaveURL(new RegExp(`#/w/${ws.id}/fiche/${id}$`));
  await expect(page.getByRole("heading", { level: 1, name: label })).toBeVisible();
  await expect(page.getByText(/^v1 · validée le/)).toBeVisible();
  await expect(page.getByText("Validateurs : 2 requis (canonique)")).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});

test("[S-0013-23] proposition créée mais brouillon non supprimé : avis non bloquant, liens accessibles, aucune nouvelle sauvegarde (critère 23)", async ({ page }) => {
  test.setTimeout(120_000);
  let refused = 0;
  const saved: string[] = [];
  await page.route("**/editor/documents/*/draft", async (route) => {
    if (route.request().method() === "DELETE") {
      refused += 1;
      await route.fulfill({ status: 500, json: { code: "internal", message: "Suppression impossible." } });
    } else {
      await route.continue();
    }
  });

  await page.goto(`${ws.root}/editeur?from=revenu-net`);
  await expect(page.getByRole("heading", { level: 1, name: "Revenu net : v5 · brouillon" })).toBeVisible();
  await field(page, "Description", "Description modifiée avant une suppression de brouillon refusée.");
  await expect(compilable(page)).toBeVisible();
  await expect(page.getByText(/Enregistré .* \(local\)/)).toBeVisible();
  page.on("request", (request) => {
    if (request.method() === "PUT" && request.url().endsWith("/draft")) saved.push(request.url());
  });

  const number = await submit(page, "Description de Revenu net précisée.");
  await expect(page.getByText("La proposition est créée, mais le brouillon local n'a pas pu être supprimé.")).toBeVisible();
  expect(refused).toBeGreaterThan(0);
  await expect(page.getByRole("link", { name: "Voir les propositions" })).toHaveAttribute("href", `#/w/${ws.id}/propositions`);
  await expect(page.getByRole("link", { name: "Retour à la fiche" })).toHaveAttribute("href", `#/w/${ws.id}/fiche/revenu-net`);
  expect(await seriousViolations(page)).toEqual([]);

  // Aucune sauvegarde n'est repartie après la soumission, même en laissant passer le délai d'enregistrement.
  await page.waitForTimeout(1500);
  expect(saved).toEqual([]);

  await page.getByRole("link", { name: "Voir les propositions" }).click();
  await expect(page).toHaveURL(new RegExp(`#/w/${ws.id}/propositions`));
  await expect(page.getByRole("list", { name: "File des propositions" }).getByRole("link").filter({ hasText: "Revenu net" }).first()).toBeVisible();
  expect(number).toBeGreaterThan(0);
});

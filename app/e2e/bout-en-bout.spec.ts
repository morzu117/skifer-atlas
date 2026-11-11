import { cellByColumn } from "./table";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { API, demoRemote, FAKE_DATABRICKS, seriousViolations, SNOWFLAKE_KEY, SNOWFLAKE_PASSPHRASE } from "./demo";
import { AUTH_API, git, isolatedDemo, python, relay, test, trackWorkspace } from "./isolation";

// Plan 0035 : parcours transverses, ceux qu'une personne fait d'un écran à l'autre et à
// plusieurs comptes. Les specs par écran vérifient chaque écran ; ici, un fil d'histoire
// traverse la création, la revue, la fusion et la relecture, et chaque étape se contrôle
// deux fois : ce que la personne voit, et ce que le dépôt contient vraiment.
//
// Un compte = un serveur Atlas, comme un poste par personne (playwright.config.ts) :
// anna.k sur le serveur principal, claire.m et marc.d sur les leurs. Une page de plus dans le
// même contexte, dont les appels sont relayés vers le serveur du compte, joue ce compte.
// Chaque test a ses espaces et ses dépôts nus, retirés à la fin (isolation.ts) ; aucun ne
// dépend d'un autre ni de l'ordre d'exécution.

const CLAIRE = "http://127.0.0.1:8798";
const MARC = "http://127.0.0.1:8797";

/** Un identifiant unique par test. */
const unique = () => crypto.randomUUID().slice(0, 8);

/** Dépôt nu vide, tel que l'hébergeur le propose à la création. */
function bareRepository(path: string) {
  mkdirSync(dirname(path), { recursive: true });
  execFileSync("git", ["init", "--bare", "--quiet", "--initial-branch=main", path]);
}

/** Une page qui parle au serveur d'un autre compte. */
async function accountPage(context: BrowserContext, server: string) {
  const page = await context.newPage();
  await relay(page, server);
  return page;
}

/** Le compte dont le serveur est `server` rejoint l'espace publié sur `remote`. */
async function joinAs(request: APIRequestContext, server: string, remote: string) {
  const joined = await request.post(`${server}/api/workspaces/join`, { data: { remote_url: remote } });
  expect(joined.status(), await joined.text()).toBe(201);
}

const nav = (page: Page) => page.getByRole("navigation", { name: "Navigation de l'espace" });
const props = (page: Page) => page.getByRole("complementary", { name: "Propriétés" });
const palette = (page: Page) => page.getByRole("complementary", { name: "Palette des nœuds" });
const bottom = (page: Page) => page.getByRole("region", { name: "Validation du document" });
const canvasNode = (page: Page, id: string) => page.locator(`[data-node-id="${id}"]`);
const table = (page: Page) => page.getByRole("table", { name: "Concepts et KPI" });
const catalogRow = (page: Page, label: string) => table(page).getByRole("row").filter({ has: page.getByRole("link", { name: label, exact: true }) });
const queue = (page: Page) => page.getByRole("list", { name: "File des propositions" });
const queueEntry = (page: Page, title: string) => queue(page).getByRole("link").filter({ hasText: title });
const selection = (page: Page) => page.getByRole("region", { name: "Proposition sélectionnée" });
const save = (page: Page) => page.getByRole("button", { name: /^Enregistrer et/ });
const repository = (page: Page) => page.getByRole("region", { name: "Dépôt Git de l'espace" });

/** Le contenu d'un fichier sur la branche principale du dépôt distant. */
const onMain = (remote: string, path: string) => git(remote, "show", `main:${path}`);
const filesOnMain = (remote: string) => git(remote, "ls-tree", "-r", "--name-only", "main").split("\n");
const lastMessage = (remote: string) => git(remote, "log", "-1", "--format=%B", "main");

/** Ni jeton d'accès ni jeton de rafraîchissement dans la page ou son stockage. */
async function expectNoSecret(page: Page) {
  const seen = await page.evaluate(() => [document.documentElement.outerHTML, JSON.stringify(localStorage), JSON.stringify(sessionStorage)].join("\n"));
  expect(seen).not.toMatch(/at-secret|rt-secret/);
}

/** Clique, puis termine l'OAuth dans la fenêtre ouverte comme dans le navigateur du système. */
async function authorizeIn(page: Page, click: () => Promise<void>) {
  const popup = page.waitForEvent("popup");
  await click();
  const window = await popup;
  await expect(window.getByText(/Connexion réussie/)).toBeVisible();
  await window.close();
}

/** Un KPI minimal et compilable : une source, une agrégation, le calendrier civil. */
async function buildMinimalKpi(page: Page, source: string, description?: string) {
  if (description) await props(page).getByLabel("Description").fill(description);
  await props(page).getByLabel(/^Calendrier/).selectOption("civil");
  await props(page).getByLabel(/^Fuseau horaire/).fill("Europe/Paris");

  await palette(page).getByRole("button", { name: "Source", exact: true }).click();
  await expect(props(page).getByText("n01", { exact: true })).toBeVisible();
  await props(page).getByLabel("Libellé").fill("Factures");
  await props(page).getByLabel(/^Plateforme/).selectOption("databricks");
  await props(page).getByLabel(/^Table/).fill(source);
  await props(page).getByLabel(/^Propriétaire/).fill("anna.k");
  for (const [index, [name, type]] of [["entite", "string"], ["montant_ttc", "decimal"]].entries()) {
    await props(page).getByRole("button", { name: "Ajouter une colonne" }).click();
    await props(page).getByLabel(`Nom de la colonne ${index + 1}`).fill(name);
    await props(page).getByLabel(`Type de la colonne ${index + 1}`).selectOption(type);
  }

  await palette(page).getByRole("button", { name: "Agrégation", exact: true }).click();
  await expect(props(page).getByText("n02", { exact: true })).toBeVisible();
  await props(page).getByRole("button", { name: "Ajouter une mesure" }).click();
  await props(page).getByLabel("Colonne source de la mesure 1").selectOption("montant_ttc");
  await props(page).getByLabel("Colonne produite par la mesure 1").fill("montant_total");
  await props(page).getByLabel("Fonction de la mesure 1").selectOption("sum");
  await props(page).getByRole("checkbox", { name: "entite" }).check();
  await expect(page.getByText("schéma 1 · 2 nœuds · 1 arête")).toBeVisible();
  await expect(bottom(page).getByText("Compilable Databricks, Snowflake")).toBeVisible();
  await expect(bottom(page).getByRole("listitem").filter({ hasText: "ERREUR" })).toHaveCount(0);
}

/** « Soumettre la proposition » depuis l'éditeur ; rend le numéro de la proposition créée. */
async function submitDraft(page: Page, justification: string): Promise<number> {
  await expect(bottom(page).getByText("Compilable Databricks, Snowflake")).toBeVisible();
  await page.getByRole("button", { name: "Soumettre la proposition" }).click();
  const dialog = page.getByRole("dialog", { name: "Soumettre la proposition" });
  await dialog.getByLabel(/Justification/).fill(justification);
  await dialog.getByRole("button", { name: "Soumettre", exact: true }).click();
  const created = page.getByRole("heading", { name: /Proposition n° \d+ créée/ });
  await expect(created).toBeVisible();
  return Number((await created.textContent())!.match(/n° (\d+)/)![1]);
}

/** Catalogue → « Nouveau concept ou KPI » → éditeur → proposition : le premier trajet d'un contributeur. */
async function proposeKpi(page: Page, root: string, kpi: { id: string; label: string; domain: string; source: string; description?: string }, justification: string) {
  await page.goto(`${root}/catalogue`);
  await page.getByRole("link", { name: "Nouveau concept ou KPI" }).click();
  await page.getByLabel(/^Libellé/).fill(kpi.label);
  await page.getByLabel(/^Identifiant/).fill(kpi.id);
  await page.getByLabel(/^Domaine/).selectOption(kpi.domain);
  await page.getByRole("button", { name: "Créer et ouvrir l'éditeur" }).click();
  await expect(page.getByRole("heading", { level: 1, name: `${kpi.label} : v1 · brouillon` })).toBeVisible();
  await buildMinimalKpi(page, kpi.source, kpi.description);
  expect(await seriousViolations(page)).toEqual([]);
  return submitDraft(page, justification);
}

/** Fiche de Revenu net → « Proposer une modification » : le libellé du filtre n02 change, rien d'autre. */
async function proposeLabelChange(page: Page, root: string, label: string, justification: string) {
  await page.goto(`${root}/fiche/revenu-net`);
  await page.getByRole("link", { name: "Proposer une modification" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Revenu net : v5 · brouillon" })).toBeVisible();
  await canvasNode(page, "n02").click();
  await props(page).getByLabel("Libellé").fill(label);
  expect(await seriousViolations(page)).toEqual([]);
  return submitDraft(page, justification);
}

/** La proposition `n` ouverte dans la file de ce compte. */
async function openProposal(page: Page, root: string, n: number) {
  const url = `${root}/propositions?n=${n}&status=open&domain=tous`;
  const same = page.url().endsWith(url.replace(/^\/?/, ""));
  await page.goto(url);
  if (same) await page.reload(); // même adresse : la navigation par fragment ne relit rien
  await expect(selection(page)).toBeVisible();
}

/** Ce compte approuve la proposition `n` depuis son écran des propositions. */
async function approve(page: Page, root: string, n: number, who: string) {
  await openProposal(page, root, n);
  await page.getByRole("button", { name: /^Approuver \(\d+ \/ \d+\)$/ }).click();
  await expect(selection(page)).toContainText(`${who} a approuvé`);
}

/** Corrige une proposition en poussant un commit sur sa branche, comme le ferait son auteur :
 * l'écran n'a pas de route de révision (plan 0006, « Reste à faire »). */
async function correctKpi(ws: { api: string; work: string }, request: APIRequestContext, n: number, id: string, description: string) {
  const branch = ((await (await request.get(`${ws.api}/proposals/${n}`)).json()) as { branch: string }).branch;
  git(ws.work, "fetch", "origin", branch);
  git(ws.work, "checkout", "-b", `correction-${n}`, "FETCH_HEAD");
  python(`import sys,yaml
from pathlib import Path
p=Path(sys.argv[1])/'kpis'/(sys.argv[2]+'.yaml'); d=yaml.safe_load(p.read_text())
d['data_product']['description']=sys.argv[3]
p.write_text(yaml.safe_dump(d,allow_unicode=True,sort_keys=False))`, ws.work, id, description);
  git(ws.work, "add", "-A");
  git(ws.work, "commit", "-qm", "Définition précisée après la revue");
  git(ws.work, "push", "origin", `HEAD:${branch}`);
}

// --- 01 : mettre une équipe en place -------------------------------------------------------

test("[S-0035-01] une équipe s'installe : espace neuf, dépôt, domaine et membres, point d'accès, premier KPI relu à deux", async ({ page, request, context }) => {
  test.setTimeout(300_000);
  const id = `perrault-${unique()}`;
  const name = `Perrault ${id}`;
  const root = mkdtempSync(join(tmpdir(), "atlas-parcours-"));
  trackWorkspace(id, root);
  const remote = join(root, "perrault.git");
  bareRepository(remote);
  const kpi = { id: "chiffre-affaires", label: "Chiffre d'affaires", domain: "finance", source: "gold.finance.fact_facturation" };
  const base = `/#/w/${id}`;

  // Anna crée l'espace de sa société, puis le rattache à un dépôt vide.
  await page.goto("/#/");
  await page.getByRole("button", { name: "Créer un espace" }).click();
  const creation = page.getByRole("dialog", { name: "Créer un espace" });
  await creation.getByLabel(/^Nom/).fill(name);
  await creation.getByLabel(/^Identifiant/).fill(id);
  await creation.getByLabel("Entités").fill("perrault-fr, perrault-it");
  await creation.getByRole("button", { name: "Créer l'espace" }).click();
  await expect(page).toHaveURL(new RegExp(`#/w/${id}/catalogue$`));
  await nav(page).getByRole("link", { name: "Administration" }).click();
  const attachment = page.getByRole("group", { name: "Rattacher un dépôt distant" });
  await attachment.getByLabel(/^Adresse du dépôt vide/).fill(remote);
  await attachment.getByRole("button", { name: "Rattacher le dépôt" }).click();
  await expect(repository(page).getByText(`Dépôt rattaché : l'espace est publié sur ${remote}, sous le compte anna.k.`)).toBeVisible();
  expect(git(remote, "log", "--format=%s", "main")).toBe(`Création de l'espace ${name}`);

  // Un domaine Finance, une référente de domaine, un validateur, deux validations pour le canonique, Databricks.
  await page.getByRole("button", { name: "Domaine", exact: true }).click();
  const domain = page.getByRole("group", { name: "Nouveau domaine" });
  await domain.getByRole("textbox", { name: /Libellé/ }).fill("Finance");
  await domain.getByRole("button", { name: "Ajouter le domaine" }).click();
  for (const member of [
    { name: "Claire M.", account: "claire.m", role: "referent" },
    { name: "Marc D.", account: "marc.d", role: "validateur" },
  ]) {
    await page.getByRole("button", { name: "Inviter", exact: true }).click();
    const form = page.getByRole("group", { name: "Nouveau membre" });
    await form.getByLabel(/^Nom/).fill(member.name);
    await form.getByLabel(/^Compte sur l'hébergeur Git/).fill(member.account);
    await form.getByRole("combobox", { name: "Rôle" }).selectOption(member.role);
    await form.getByRole("checkbox", { name: "Finance" }).check();
    await form.getByRole("button", { name: "Ajouter le membre" }).click();
  }
  await page.getByRole("spinbutton", { name: "Canonique (min 1)" }).fill("2");
  await page.getByRole("checkbox", { name: "Databricks" }).check();
  expect(await seriousViolations(page)).toEqual([]);
  await expect(save(page)).toHaveText("Enregistrer et fusionner"); // Anna reste la seule référente de l'espace
  await save(page).click();
  await expect(page.getByText(/Paramètres enregistrés : proposition n° \d+ fusionnée sans revue\./)).toBeVisible();
  const governance = onMain(remote, "governance.yaml");
  expect(governance).toContain("id: finance");
  expect(governance).toContain("claire.m");
  expect(governance).toContain("marc.d");
  expect(governance).toContain("- databricks");

  // Le point d'accès Databricks : créé, authentifié, testé, proposé puis fusionné (seule référente, sans revue).
  await nav(page).getByRole("link", { name: "Connexions" }).click();
  await page.getByRole("button", { name: "Ajouter un point d'accès" }).click();
  const panel = page.getByRole("complementary", { name: "Nouveau point d'accès" });
  await panel.getByRole("textbox", { name: "Identifiant" }).fill("dbx-perrault");
  await panel.getByRole("textbox", { name: "Hôte" }).fill(FAKE_DATABRICKS);
  await panel.getByRole("textbox", { name: "SQL warehouse" }).fill("abc123");
  await panel.getByRole("textbox", { name: "Schéma" }).fill("gold.finance");
  await authorizeIn(page, () => panel.getByRole("button", { name: "S'authentifier avec OAuth" }).click());
  await panel.getByRole("button", { name: "Tester la connexion" }).click();
  await expect(panel.getByText(/^Connexion OK · \d+ ms$/)).toBeVisible();
  await panel.getByRole("textbox", { name: "Justification" }).fill("Point d'accès de Perrault France.");
  await panel.getByRole("button", { name: "Proposer le point d'accès" }).click();
  await expect(panel.getByText(/^Proposition n° \d+ ouverte\./)).toBeVisible();
  await expectNoSecret(page);
  await panel.getByRole("link", { name: "Voir la proposition" }).click();
  await expect(page.getByText("Fusionnée sans revue : aucun autre compte habilité")).toBeVisible();
  await page.getByRole("button", { name: "Fusionner", exact: true }).click();
  await expect(page.getByText(/Proposition n° \d+ fusionnée/)).toBeVisible();
  expect(git(remote, "grep", "dbx-perrault", "main")).toContain("dbx-perrault");
  expect(lastMessage(remote)).toContain("Atlas-Review: none (no other eligible approver)");

  // Claire et Marc rejoignent le dépôt depuis leur poste : leurs rôles viennent de la gouvernance publiée.
  await joinAs(request, CLAIRE, remote);
  await joinAs(request, MARC, remote);
  expect(await (await request.get(`${CLAIRE}/api/workspaces/${id}`)).json()).toMatchObject({ account: "claire.m", role: "referent", space_referent: false });
  expect(await (await request.get(`${MARC}/api/workspaces/${id}`)).json()).toMatchObject({ account: "marc.d", role: "validateur" });

  // Le premier KPI de l'équipe : Anna le propose, Claire et Marc le relisent chacun chez eux, Anna le fusionne.
  const claire = await accountPage(context, CLAIRE);
  const marc = await accountPage(context, MARC);
  const number = await proposeKpi(page, base, kpi, "Premier KPI de l'espace Perrault.");
  await claire.goto(`${base}/catalogue`);
  await expect(nav(claire).getByRole("link", { name: /Propositions/ })).toContainText("en attente de votre revue");
  await openProposal(claire, base, number);
  await expect(selection(claire)).toContainText("Proposée par");
  expect(await seriousViolations(claire)).toEqual([]);
  await approve(claire, base, number, "Claire M.");
  await approve(marc, base, number, "Marc D.");

  await page.goto(`${base}/propositions?n=${number}&status=open&domain=tous`);
  await expect(queueEntry(page, kpi.label)).toContainText(/Validations : 2 \/ 2 · prête à fusionner/);
  expect(await seriousViolations(page)).toEqual([]);
  await page.getByRole("button", { name: "Fusionner", exact: true }).click();
  await expect(page.getByText(`Proposition n° ${number} fusionnée`)).toBeVisible();

  // Dans le dépôt : le fichier du KPI, la trace des deux revues, le tag de version.
  expect(filesOnMain(remote)).toEqual(expect.arrayContaining(["atlas.yaml", "governance.yaml", `kpis/${kpi.id}.yaml`]));
  expect(onMain(remote, `kpis/${kpi.id}.yaml`)).toContain("domain: finance");
  expect(lastMessage(remote)).toContain(`Atlas-Proposal: #${number}`);
  expect(lastMessage(remote)).toContain("Atlas-Review: approved by claire.m, marc.d");
  await expect.poll(() => git(remote, "tag", "--list", `doc/${kpi.id}/v1`)).toBe(`doc/${kpi.id}/v1`);

  // Et à l'écran d'Anna : le catalogue, puis la fiche.
  await nav(page).getByRole("link", { name: "Catalogue" }).click();
  await expect(catalogRow(page, kpi.label)).toContainText("Finance");
  await catalogRow(page, kpi.label).getByRole("link", { name: kpi.label }).click();
  await expect(page).toHaveURL(new RegExp(`#/w/${id}/fiche/${kpi.id}$`));
  await expect(page.getByRole("heading", { level: 1, name: kpi.label })).toBeVisible();
  await expect(page.getByText(/^v1 · validée le/)).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});

// --- 02 : la vie d'une proposition, de la demande de changements à la fusion --------------

test("[S-0035-02] un KPI est relu à deux : changements demandés, réponse, correction, nouvelle approbation, fusion par la référente", async ({ page, request, context }) => {
  test.setTimeout(300_000);
  const ws = await isolatedDemo(request, API);
  await joinAs(request, CLAIRE, ws.remote);
  await joinAs(request, MARC, ws.remote);
  const claire = await accountPage(context, CLAIRE);
  const marc = await accountPage(context, MARC);
  const kpi = { id: "taux-de-recouvrement", label: "Taux de recouvrement", domain: "finance", source: "gold.finance.fact_encaissement" };
  const before = git(ws.remote, "rev-parse", "main");

  // Anna, contributrice, propose un nouveau KPI de la Finance.
  const n = await proposeKpi(page, ws.root, { ...kpi, description: "Encaissements rapportés aux factures." }, "Suivre le recouvrement par entité.");
  expect(git(ws.remote, "branch", "--list", "prop/*")).toContain("prop/");
  expect(git(ws.remote, "rev-parse", "main")).toBe(before); // une proposition n'écrit jamais sur la branche principale

  // Claire demande des changements, en disant lesquels.
  await openProposal(claire, ws.root, n);
  await expect(claire.getByRole("button", { name: "Approuver (0 / 2)" })).toBeVisible();
  await claire.getByRole("button", { name: "Demander des changements" }).click();
  const form = claire.getByRole("form", { name: "Demander des changements" });
  await form.getByLabel(/Ce qui doit changer/).fill("Préciser la définition : encaissé rapporté au facturé, taxes comprises.");
  await form.getByRole("button", { name: "Envoyer la demande" }).click();
  await expect(selection(claire)).toContainText("Claire M. demande des changements");
  await expect(selection(claire)).toContainText("Changements demandés par claire.m.");

  // Anna le voit dans sa file, répond dans le fil, puis corrige la définition sur la branche.
  await openProposal(page, ws.root, n);
  await expect(selection(page)).toContainText("Changements demandés par claire.m.");
  await expect(selection(page)).toContainText("Préciser la définition : encaissé rapporté au facturé");
  expect(await seriousViolations(page)).toEqual([]);
  await page.getByLabel("Répondre").fill("Bien vu, la définition est précisée dans une nouvelle version.");
  await page.getByRole("button", { name: "Envoyer", exact: true }).click();
  await expect(selection(page)).toContainText("Anna K.");
  await expect(selection(page)).toContainText("la définition est précisée dans une nouvelle version");
  const corrected = "Encaissements du mois rapportés aux factures émises, taxes comprises.";
  await correctKpi(ws, request, n, kpi.id, corrected);

  // Marc approuve la nouvelle version : 1 sur 2, et la demande de Claire bloque toujours la fusion.
  await approve(marc, ws.root, n, "Marc D.");
  await page.reload();
  await expect(queueEntry(page, kpi.label)).toContainText(/Validations : 1 \/ 2/);
  await expect(selection(page)).toContainText("Changements demandés par claire.m.");
  const refused = await request.post(`${ws.api}/proposals/${n}/merge`);
  expect(refused.status()).toBe(409);
  expect(await refused.json()).toMatchObject({ detail: { code: "not_ready" } });
  expect(git(ws.remote, "rev-parse", "main")).toBe(before);

  // Claire relit la nouvelle version et l'approuve : sa demande est remplacée, la proposition est prête, elle la fusionne.
  await openProposal(claire, ws.root, n);
  await claire.getByRole("button", { name: "Approuver (1 / 2)" }).click();
  await expect(selection(claire)).toContainText("Claire M. a approuvé");
  await expect(selection(claire)).not.toContainText("Changements demandés par claire.m.");
  expect(await seriousViolations(claire)).toEqual([]);
  await claire.getByRole("button", { name: "Fusionner", exact: true }).click();
  await expect(claire.getByText(`Proposition n° ${n} fusionnée`)).toBeVisible();

  // Le dépôt a la version corrigée, la trace des deux revues et le tag.
  expect(onMain(ws.remote, `kpis/${kpi.id}.yaml`)).toContain(corrected);
  expect(lastMessage(ws.remote)).toContain(`Atlas-Proposal: #${n}`);
  expect(lastMessage(ws.remote)).toContain("Atlas-Review: approved by claire.m, marc.d");
  await expect.poll(() => git(ws.remote, "tag", "--list", `doc/${kpi.id}/v1`)).toBe(`doc/${kpi.id}/v1`);

  // Chez Claire, qui a fusionné, le catalogue et la fiche montrent la v1.
  await claire.goto(`${ws.root}/catalogue`);
  await expect((await cellByColumn(catalogRow(claire, kpi.label), claire.getByRole("table", { name: "Concepts et KPI" }), "Version"))).toHaveText("v1");
  await claire.goto(`${ws.root}/fiche/${kpi.id}`);
  await expect(claire.getByRole("heading", { level: 1, name: kpi.label })).toBeVisible();
  await expect(claire.getByText(/^v1 · validée le/)).toBeVisible();
  await expect(claire.getByText(corrected)).toBeVisible();
  expect(await seriousViolations(claire)).toEqual([]);

  // Dans la file d'Anna, la proposition a quitté les ouvertes et figure parmi les fusionnées.
  await page.goto(`${ws.root}/propositions?status=merged`);
  await expect(queueEntry(page, kpi.label)).toContainText("Fusionnée");
});

// --- 03 : faire évoluer un KPI qui en alimente d'autres -----------------------------------

test("[S-0035-03] Revenu net passe de v4 à v5 : proposition, deux revues, fusion, versions, dépendants intacts", async ({ page, request, context }) => {
  test.setTimeout(240_000);
  const ws = await isolatedDemo(request, API);
  await joinAs(request, CLAIRE, ws.remote);
  await joinAs(request, MARC, ws.remote);
  const claire = await accountPage(context, CLAIRE);
  const marc = await accountPage(context, MARC);
  const label = "Factures validées hors brouillons";
  const before = git(ws.remote, "rev-parse", "main");

  // Anna ne touche que le libellé du filtre n02 : la fiche annonce déjà qu'un dépendant en subit les suites.
  await page.goto(`${ws.root}/fiche/revenu-net`);
  await expect(page.getByText("Une nouvelle version touchera 2 documents.")).toBeVisible();
  const n = await proposeLabelChange(page, ws.root, label, "Le filtre n02 écarte aussi les brouillons : le dire dans son libellé.");

  // La proposition d'Anna est la seconde « canonique v5 » de la file (la première est celle de julien.h).
  await page.goto(`${ws.root}/propositions?n=${n}&status=open&domain=tous`);
  const mine = queueEntry(page, "Revenu net · canonique v5").filter({ hasText: "par Anna K." });
  await expect(mine).toHaveCount(1);
  await expect(mine).toContainText(/Validations : 0 \/ 2/);
  await expect(selection(page).getByRole("region", { name: "Diff de la proposition" }).locator(".diff-item")).toHaveCount(1);
  await expect(selection(page)).toContainText("Sans effet");
  expect(await seriousViolations(page)).toEqual([]);

  // Marc puis Claire approuvent ; Claire fusionne.
  await approve(marc, ws.root, n, "Marc D.");
  await approve(claire, ws.root, n, "Claire M.");
  await claire.getByRole("button", { name: "Fusionner", exact: true }).click();
  await expect(claire.getByText(`Proposition n° ${n} fusionnée`)).toBeVisible();

  // Le dépôt : v5 sur le canonique, le tag, la trace des revues, et les KPI qui s'appuient sur lui n'ont pas bougé.
  const revenue = onMain(ws.remote, "kpis/revenu-net.yaml");
  expect(revenue).toContain("version: 5");
  expect(revenue).toContain(label);
  await expect.poll(() => git(ws.remote, "tag", "--list", "doc/revenu-net/v5")).toBe("doc/revenu-net/v5");
  expect(lastMessage(ws.remote)).toContain("Atlas-Review: approved by claire.m, marc.d");
  expect(git(ws.remote, "diff", "--stat", before, "main", "--", "kpis/marge-brute.yaml", "kpis/panier-moyen.yaml", "variants")).toBe("");

  // Chez Claire : catalogue (v5 pour Revenu net, les autres inchangés), versions, écart v4 → v5, dépendants.
  await claire.goto(`${ws.root}/catalogue`);
  await expect((await cellByColumn(catalogRow(claire, "Revenu net"), claire.getByRole("table", { name: "Concepts et KPI" }), "Version"))).toHaveText("v5");
  await expect((await cellByColumn(catalogRow(claire, "Marge brute"), claire.getByRole("table", { name: "Concepts et KPI" }), "Version"))).toHaveText("v2");
  await expect((await cellByColumn(catalogRow(claire, "Revenu net"), claire.getByRole("table", { name: "Concepts et KPI" }), "Déclinaisons"))).toHaveText("3"); // les déclinaisons suivent le canonique
  expect(await seriousViolations(claire)).toEqual([]);
  await claire.goto(`${ws.root}/fiche/revenu-net?tab=versions&base=4&other=5`);
  const tabs = claire.getByRole("navigation", { name: "Onglets de la fiche" });
  await expect(tabs.getByRole("button", { name: "Versions 5" })).toBeVisible();
  await expect(claire.getByRole("table").getByRole("row")).toHaveCount(6);
  await expect(claire.getByRole("table").getByRole("row").nth(1)).toContainText("v5 · courante");
  await expect(claire.locator(".diff-item")).toHaveCount(1);
  await expect(claire.locator(".diff-item")).toContainText("Sans effet");
  await expect(claire.getByRole("figure", { name: "Graphe de la version 5" }).locator(".graph-card").filter({ hasText: label })).toBeVisible();
  expect(await seriousViolations(claire)).toEqual([]);
  await claire.goto(`${ws.root}/fiche/revenu-net?tab=dependances`);
  const by = claire.getByRole("region", { name: "Référencé par" });
  await expect(by.getByRole("link", { name: "Panier moyen" })).toBeVisible();
  await expect(by.getByRole("link", { name: "Marge brute" })).toBeVisible();
  expect(await seriousViolations(claire)).toEqual([]);
});

// --- 04 : une règle locale, une déclinaison hors points déclarés ---------------------------

test("[S-0035-04] une filiale veut sa règle : déclinaison nordis-it en surcharge, validation canonique, fusion, fiche", async ({ page, request, context }) => {
  test.setTimeout(300_000);
  const ws = await isolatedDemo(request, API);
  await joinAs(request, CLAIRE, ws.remote);
  await joinAs(request, MARC, ws.remote);
  const claire = await accountPage(context, CLAIRE);
  const marc = await accountPage(context, MARC);

  // La filiale italienne rejoint le groupe : l'entité est ajoutée à l'espace dans le dépôt (comme le ferait le référent).
  python("import sys,yaml; from pathlib import Path; p=Path(sys.argv[1])/'atlas.yaml'; d=yaml.safe_load(p.read_text()); d['entities'] += ['nordis-it']; p.write_text(yaml.safe_dump(d,allow_unicode=True,sort_keys=False))", ws.work);
  git(ws.work, "add", "atlas.yaml");
  git(ws.work, "commit", "-qm", "Entité nordis-it");
  git(ws.work, "push", "origin", "main");
  for (const server of [API, CLAIRE, MARC]) {
    const synced = await request.post(`${server}/api/workspaces/${ws.id}/sync`, { data: {} });
    expect(synced.ok(), await synced.text()).toBe(true);
  }

  // Anna crée la déclinaison depuis la fiche de Revenu net, puis remplace le filtre n02 (hors points déclarés).
  await page.goto(`${ws.root}/fiche/revenu-net?tab=declinaisons`);
  await page.getByRole("link", { name: "Créer une déclinaison" }).click();
  await page.getByLabel(/^Entité/).selectOption("nordis-it");
  await page.getByLabel(/^Justification/).fill("Règle italienne différente : les commandes expédiées comptent.");
  await page.getByRole("button", { name: "Créer et ouvrir l'éditeur" }).click();
  await expect(page).toHaveURL(/editeur\?from=revenu-net--nordis-it$/);
  await expect(page.getByRole("heading", { level: 1, name: /revenu-net · nordis-it : v1 · brouillon/ })).toBeVisible();
  await canvasNode(page, "n02").click();
  await props(page).getByRole("button", { name: "Remplacer ce nœud" }).click();
  await expect(props(page).getByText("Hors points déclarés : la validation canonique s'appliquera")).toBeVisible();
  await props(page).getByLabel(/^Valeur/).fill("validée,expédiée");
  await props(page).getByLabel(/^Opérateur/).selectOption("in");
  await props(page).getByLabel(/Justification de la surcharge/).fill("Les commandes expédiées comptent en revenu en Italie.");
  expect(await seriousViolations(page)).toEqual([]);

  // Le récapitulatif annonce la validation canonique avant l'envoi.
  await expect(bottom(page).getByText("Compilable Databricks, Snowflake")).toBeVisible();
  await page.getByRole("button", { name: "Soumettre la proposition" }).click();
  const dialog = page.getByRole("dialog", { name: "Soumettre la proposition" });
  await expect(dialog.getByText("Hors points déclarés : la validation canonique s'appliquera")).toBeVisible();
  await expect(dialog.getByText("Validations requises")).toBeVisible();
  await dialog.getByLabel(/Justification/).fill("Nordis Italie compte les commandes expédiées.");
  await dialog.getByRole("button", { name: "Soumettre", exact: true }).click();
  const created = page.getByRole("heading", { name: /Proposition n° \d+ créée/ });
  await expect(created).toBeVisible();
  const n = Number((await created.textContent())!.match(/n° (\d+)/)![1]);

  // Dans la file : surcharge hors points déclarés, deux validations exigées ; une seule ne suffit pas.
  await page.goto(`${ws.root}/propositions?n=${n}&status=open&domain=tous`);
  const entry = queueEntry(page, "Revenu net · nordis-it");
  await expect(entry.locator(".badge")).toHaveText("Hors points déclarés");
  await expect(entry).toContainText("Validations : 0 / 2 (canonique requis)");
  await approve(marc, ws.root, n, "Marc D.");
  await page.reload();
  await expect(entry).toContainText("Validations : 1 / 2 (canonique requis)");
  await expect(page.getByRole("button", { name: "Fusionner", exact: true })).toHaveCount(0);
  const early = await request.post(`${ws.api}/proposals/${n}/merge`);
  expect(early.status()).toBe(409);
  expect(git(ws.remote, "ls-tree", "-r", "--name-only", "main")).not.toContain("nordis-it");

  // Claire apporte la seconde validation et fusionne.
  await approve(claire, ws.root, n, "Claire M.");
  await claire.getByRole("button", { name: "Fusionner", exact: true }).click();
  await expect(claire.getByText(`Proposition n° ${n} fusionnée`)).toBeVisible();

  // Le dépôt a la déclinaison, la surcharge et la trace des deux revues.
  const variant = onMain(ws.remote, "variants/revenu-net/nordis-it.yaml");
  expect(variant).toContain("node: n02");
  expect(variant).toContain("validée,expédiée");
  expect(lastMessage(ws.remote)).toContain("Atlas-Review: approved by claire.m, marc.d");

  // La fiche de Revenu net, chez Claire : quatre déclinaisons, la nouvelle en surcharge ; son diff au canonique la montre.
  await claire.goto(`${ws.root}/fiche/revenu-net?tab=declinaisons`);
  await expect(claire.getByRole("navigation", { name: "Onglets de la fiche" }).getByRole("button", { name: "Déclinaisons 4" })).toBeVisible();
  await expect(claire.getByRole("row").filter({ hasText: "nordis-it" })).toContainText("Surcharge");
  expect(await seriousViolations(claire)).toEqual([]);
  await claire.goto(`${ws.root}/fiche/revenu-net--nordis-it?diff=canonique`);
  await expect(claire.locator(".diff-item").first()).toBeVisible();
  await expect(claire.getByRole("figure", { name: /Graphe : Déclinaison nordis-it/ }).locator(".graph-card").filter({ hasText: "n02" })).toBeVisible();
  expect(await seriousViolations(claire)).toEqual([]);
});

// --- 05 : connecter ses plateformes, puis comparer les entités ------------------------------

test("[S-0035-05] une analyste se connecte aux trois plateformes puis compare Revenu net : matrice, détail, nœud divergent, catalogue et historique", async ({ page, request }) => {
  test.setTimeout(240_000);
  const ws = await isolatedDemo(request, API);

  // Mes connexions : OAuth Databricks, SSO Snowflake, paire de clés Snowflake ; chacune est testée.
  await page.goto(`${ws.root}/connexions`);
  const points = page.getByRole("table", { name: "Points d'accès de l'espace" });
  const fr = points.getByRole("row").filter({ hasText: "gold.finance" });
  const de = points.getByRole("row").filter({ hasText: "FIN_GOLD.PUBLIC" });
  const es = points.getByRole("row").filter({ hasText: "VENTAS.GOLD" });
  await expect(fr).toContainText("Jamais connecté");
  await authorizeIn(page, () => fr.getByRole("button", { name: "Se connecter à Databricks · dbx-fr" }).click());
  await expect(fr.getByRole("cell", { name: /^Connecté ?· ?session OAuth$/ })).toBeVisible();
  await fr.getByRole("button", { name: "Tester Databricks · dbx-fr" }).click();
  await expect(fr.getByText(/^Connexion OK · \d+ ms$/)).toBeVisible();
  await de.getByRole("button", { name: "Se connecter à Snowflake · snow-de" }).click();
  await de.getByLabel("Identifiant Snowflake").fill("anna@nordis.example");
  await de.getByRole("button", { name: "Ouvrir le SSO" }).click();
  await expect(de.getByRole("cell", { name: /^Connecté ?· ?session SSO$/ })).toBeVisible();
  await es.getByRole("button", { name: "Se connecter à Snowflake · snow-es" }).click();
  await es.getByLabel("Identifiant Snowflake").fill("svc_es");
  await es.getByLabel("Fichier de clé privée").fill(SNOWFLAKE_KEY);
  await es.getByLabel("Passphrase (si la clé est chiffrée)").fill(SNOWFLAKE_PASSPHRASE);
  await es.getByRole("button", { name: "Ranger dans le coffre" }).click();
  await expect(es.getByRole("cell", { name: /^Connecté ?· ?paire de clés$/ })).toBeVisible();
  await expectNoSecret(page);
  expect(await seriousViolations(page)).toEqual([]);
  // L'état de chaque connexion vient du coffre du serveur, pas seulement de l'écran.
  const listed = (await (await request.get(`${ws.api}/connections`)).json()) as unknown;
  expect(JSON.stringify(listed)).toMatch(/dbx-fr/);

  // Le catalogue n'a encore jamais comparé Revenu net.
  await page.goto(`${ws.root}/catalogue`);
  await expect((await cellByColumn(catalogRow(page, "Revenu net"), page.getByRole("table", { name: "Concepts et KPI" }), "Convergence"))).toHaveText("Jamais comparé");

  // La comparaison des trois entités : progression par plateforme, puis la matrice.
  await page.goto(`${ws.root}/comparaison`);
  await expect(page.getByRole("combobox", { name: "KPI" })).toHaveValue("revenu-net");
  const launched = page.waitForResponse((r) => r.url().endsWith("/comparisons") && r.request().method() === "POST");
  await page.getByRole("button", { name: /Lancer la comparaison|Relancer/ }).click();
  expect((await launched).status()).toBe(202); // la progression par plateforme est vérifiée en S-0009-01 : le calcul local est trop rapide pour l'attendre ici
  await expect(page.getByRole("button", { name: "Relancer" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("link", { name: "Revenu net × nordis-de : 94 % de validation, écart max 6,1 %" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Revenu net × nordis-fr : 100 % de validation/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Revenu net × nordis-es : 75 % de validation, écart max 2,9 %" })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);

  // Le détail allemand : septembre 2026 est hors tolérance, et le nœud divergent ouvre le diff au canonique.
  await page.getByRole("link", { name: /Revenu net × nordis-de : 94 %/ }).click();
  const detail = page.getByRole("region", { name: /Détail · Revenu net · nordis-de · par Mois fiscal × Entité/ });
  await expect(detail.getByRole("row", { name: /Sept\. 2026 DE/ })).toContainText("+6,1 % hors tolérance");
  expect(await seriousViolations(page)).toEqual([]);
  await detail.getByRole("link", { name: "Nœud divergent : n02 · Factures validées" }).click();
  await expect(page).toHaveURL(new RegExp(`#/w/${ws.id}/fiche/revenu-net--nordis-de\\?diff=canonique&node=n02$`));
  await expect(page.getByText(/Nœud sélectionné : n02/)).toBeVisible();
  await expect(page.getByRole("figure", { name: /Graphe : Déclinaison nordis-de/ }).locator(".graph-card.is-selected")).toContainText("Factures validées");

  // Le catalogue a retenu la comparaison, l'historique aussi.
  await page.goto(`${ws.root}/catalogue`);
  await expect((await cellByColumn(catalogRow(page, "Revenu net"), page.getByRole("table", { name: "Concepts et KPI" }), "Convergence"))).toHaveText(/^\d+ divergences?$/);
  await (await cellByColumn(catalogRow(page, "Revenu net"), page.getByRole("table", { name: "Concepts et KPI" }), "Domaine")).click();
  await expect(page.getByRole("complementary", { name: "Revenu net" })).toContainText(/Dernière comparaison\s*\d+ % · à l'instant/);
  expect(await seriousViolations(page)).toEqual([]);
  await page.goto(`${ws.root}/comparaison`);
  await page.getByRole("region", { name: "Dernières comparaisons" }).getByRole("link", { name: "Tout voir" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Historique des comparaisons" })).toBeVisible();
  const rows = page.getByRole("table").getByRole("row");
  await expect(rows.nth(1)).toContainText("anna.k");
  await expect(rows.nth(1)).toContainText("nordis-de 94 % · nordis-es 75 % · nordis-fr 100 %");
  expect(await seriousViolations(page)).toEqual([]);
});

// --- 06 : la session OAuth expire, la comparaison attend la reconnexion ---------------------

test("[S-0035-06] une session Databricks expirée : « Session expirée », comparaison bloquée, reconnexion, lancement repris", async ({ page, request }) => {
  test.setTimeout(180_000);
  const ws = await isolatedDemo(request, AUTH_API);
  await relay(page, AUTH_API);
  const row = page.getByRole("row").filter({ hasText: "gold.finance" });
  const configure = async (data = {}) => expect((await request.post(`${FAKE_DATABRICKS}/__test__/configure`, { data })).ok()).toBe(true);
  const posted: string[] = [];
  page.on("request", (r) => { if (r.method() === "POST" && r.url().endsWith("/comparisons")) posted.push(r.url()); });

  try {
    // Le faux Databricks rend des jetons déjà périmés, impossibles à rafraîchir.
    await configure({ expires_in: 0, refuse_refresh: true });
    await page.goto(`${ws.root}/connexions`);
    await authorizeIn(page, () => row.getByRole("button", { name: "Se connecter à Databricks · dbx-fr" }).click());
    await expect(row).toContainText("Session expirée");
    await expect(row.getByRole("button", { name: "Reconnecter Databricks · dbx-fr" })).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);

    // La comparaison de la déclinaison FR le dit avant tout lancement, et rien ne part.
    const previewed = page.waitForResponse((r) => r.url().endsWith("/comparisons/preview")
      && (JSON.parse(r.request().postData() ?? "{}") as { variants?: string[] }).variants?.join() === "nordis-fr");
    await page.goto(`${ws.root}/comparaison`);
    await page.getByRole("checkbox", { name: /nordis-es/ }).uncheck();
    await page.getByRole("checkbox", { name: /nordis-de/ }).uncheck();
    await previewed;
    await expect(page.getByText("Connexion requise", { exact: true })).toBeVisible();
    const launch = page.getByRole("button", { name: /Lancer la comparaison|Relancer/ });
    await expect(launch).toHaveAttribute("aria-disabled", "true");
    await launch.click({ force: true });
    expect(posted).toEqual([]);
    expect(await seriousViolations(page)).toEqual([]);

    // Le compte se reconnecte avec des jetons valides : le lancement mémorisé reprend tout seul.
    await configure();
    const resumed = page.waitForResponse((r) => r.url().endsWith("/comparisons") && r.request().method() === "POST" && r.status() === 202);
    await authorizeIn(page, () => page.getByRole("button", { name: "Se connecter à dbx-fr" }).click());
    const { id } = (await (await resumed).json()) as { id: number };
    expect(id).toBeGreaterThan(0);
    await expect(page.getByRole("button", { name: "Se connecter à dbx-fr" })).toHaveCount(0);
    expect(posted).toHaveLength(1);

    // Et Mes connexions ne parle plus de session expirée. Le faux ne calcule pas le SQL : seule la reprise est le contrat.
    await page.goto(`${ws.root}/connexions`);
    await expect(row.getByRole("cell", { name: /^Connecté ?· ?session OAuth$/ })).toBeVisible();
    await expect(row).not.toContainText("Session expirée");
    await expectNoSecret(page);
    expect(await seriousViolations(page)).toEqual([]);
  } finally {
    await configure();
  }
});

// --- 07 : deux fusions qui n'aboutissent pas, puis une qui passe -----------------------------

test("[S-0035-07] fusions contrariées : base avancée par une autre proposition, branche protégée, puis fusion réussie", async ({ page, request, context }) => {
  test.setTimeout(300_000);
  const ws = await isolatedDemo(request, API);
  await joinAs(request, CLAIRE, ws.remote);
  await joinAs(request, MARC, ws.remote);
  const claire = await accountPage(context, CLAIRE);
  const marc = await accountPage(context, MARC);

  // Anna propose une v5 de Revenu net, en même temps que la v5 de julien.h (déjà ouverte, approuvée par Marc).
  const mine = await proposeLabelChange(page, ws.root, "Factures validées, brouillons exclus", "Préciser le filtre n02.");
  await approve(claire, ws.root, 3, "Claire M."); // la v5 de julien.h : 2 sur 2 avec Marc
  await claire.getByRole("button", { name: "Fusionner", exact: true }).click();
  await expect(claire.getByText("Proposition n° 3 fusionnée")).toBeVisible();
  expect(onMain(ws.remote, "kpis/revenu-net.yaml")).toContain("version: 5");
  const afterOther = git(ws.remote, "rev-parse", "main");

  // La proposition d'Anna est approuvée à son tour, mais sa base (v4) n'est plus la version courante.
  await approve(marc, ws.root, mine, "Marc D.");
  await approve(claire, ws.root, mine, "Claire M.");
  await page.goto(`${ws.root}/propositions?n=${mine}&status=open&domain=tous`);
  await expect(queueEntry(page, "Revenu net · canonique v5").filter({ hasText: "par Anna K." })).toContainText(/Validations : 2 \/ 2 · prête à fusionner/);
  const stale = page.waitForResponse((r) => r.url().endsWith(`/proposals/${mine}/merge`) && r.request().method() === "POST");
  await page.getByRole("button", { name: "Fusionner", exact: true }).click();
  expect((await stale).status()).toBe(409);
  expect(await (await stale).json()).toMatchObject({ detail: { code: "stale_base" } });
  const staleAlert = page.getByRole("alert").filter({ hasText: "La version de départ a changé" });
  await expect(staleAlert).toContainText("« revenu-net » a changé depuis la proposition"); // le message précis du serveur
  expect(git(ws.remote, "rev-parse", "main")).toBe(afterOther); // rien n'a été fusionné
  await expect(queueEntry(page, "Revenu net · canonique v5").filter({ hasText: "par Anna K." })).toHaveCount(1); // elle reste ouverte
  expect(await seriousViolations(page)).toEqual([]);

  // Le dépôt refuse ensuite toute écriture sur la branche principale (branche protégée).
  const hook = join(ws.remote, "hooks/pre-receive");
  writeFileSync(hook, '#!/bin/sh\nwhile read old new ref; do\n case "$ref" in refs/heads/main) exit 1;; esac\ndone\nexit 0\n');
  chmodSync(hook, 0o755);
  await page.goto(`${ws.root}/propositions?status=open&domain=tous`);
  await queueEntry(page, "Taux de service · canonique v3").click();
  await expect(queueEntry(page, "Taux de service · canonique v3")).toContainText("Validations : 1 / 1 · prête à fusionner");
  await page.getByRole("button", { name: "Fusionner", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Le dépôt a refusé la fusion" })).toBeVisible();
  expect(git(ws.remote, "rev-parse", "main")).toBe(afterOther);
  expect(onMain(ws.remote, "kpis/taux-de-service.yaml")).toContain("version: 2");
  await expect(queueEntry(page, "Taux de service · canonique v3")).toHaveCount(1);
  expect(await seriousViolations(page)).toEqual([]);

  // Le blocage levé, la même fusion passe, sans autre geste que de réessayer.
  writeFileSync(hook, "#!/bin/sh\nexit 0\n");
  await page.getByRole("button", { name: "Fusionner", exact: true }).click();
  await expect(page.getByText("Proposition n° 2 fusionnée")).toBeVisible();
  expect(onMain(ws.remote, "kpis/taux-de-service.yaml")).toContain("version: 3");
  expect(lastMessage(ws.remote)).toContain("Atlas-Proposal: #2");
  await expect.poll(() => git(ws.remote, "tag", "--list", "doc/taux-de-service/v3")).toBe("doc/taux-de-service/v3");
});

// --- 08 : le dépôt distant disparaît le temps d'une proposition ------------------------------

test("[S-0035-08] hors ligne puis retour : lecture et brouillon intacts, envoi refusé sans rien créer, renvoi réussi", async ({ page, request }) => {
  test.setTimeout(240_000);
  const ws = await isolatedDemo(request, API);
  const away = `${ws.remote}.injoignable`;
  const description = "Chiffre d'affaires net, précisé hors ligne.";
  const branches = () => git(existsSync(ws.remote) ? ws.remote : away, "branch", "--list", "prop/*").split("\n").filter(Boolean).length;
  const seeded = branches();

  await page.goto(`${ws.root}/fiche/revenu-net`);
  await expect(page.getByRole("heading", { level: 1, name: "Revenu net" })).toBeVisible();

  renameSync(ws.remote, away);
  try {
    // Sans le dépôt, on lit toujours : la fiche, puis le catalogue, depuis la copie locale.
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Revenu net" })).toBeVisible();
    await page.goto(`${ws.root}/catalogue`);
    await expect((await cellByColumn(catalogRow(page, "Revenu net"), page.getByRole("table", { name: "Concepts et KPI" }), "Version"))).toHaveText("v4");

    // On écrit toujours aussi : la modification se garde en brouillon local.
    await page.goto(`${ws.root}/fiche/revenu-net`);
    await page.getByRole("link", { name: "Proposer une modification" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Revenu net : v5 · brouillon" })).toBeVisible();
    await props(page).getByLabel("Description").fill(description);
    await expect(page.getByText(/Enregistré .* \(local\)/)).toBeVisible();

    // L'envoi échoue en le disant, et ne crée rien.
    await expect(bottom(page).getByText("Compilable Databricks, Snowflake")).toBeVisible();
    await page.getByRole("button", { name: "Soumettre la proposition" }).click();
    const dialog = page.getByRole("dialog", { name: "Soumettre la proposition" });
    await dialog.getByLabel(/Justification/).fill("Description plus précise.");
    await dialog.getByRole("button", { name: "Soumettre", exact: true }).click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("heading", { name: /Proposition n° \d+ créée/ })).toHaveCount(0);
    expect(branches()).toBe(seeded);
    expect(await seriousViolations(page)).toEqual([]);
    await dialog.getByRole("button", { name: "Annuler" }).click();

    // La file des propositions le dit aussi, au lieu de rester vide.
    await page.goto(`${ws.root}/propositions`);
    const queueAlert = page.getByRole("main").getByRole("alert").first();
    await expect(queueAlert).toContainText("Le dépôt est inaccessible");
    await expect(queueAlert).toContainText("Vérifiez le réseau ou votre accès au dépôt, puis réessayez.");
  } finally {
    renameSync(away, ws.remote);
  }

  // Le dépôt est de retour : la file se relit, le brouillon est intact, le même envoi réussit.
  await page.reload(); // la page est déjà sur la file : une navigation par fragment ne relirait rien
  await expect(queue(page).getByRole("link")).toHaveCount(5);
  await page.goto(`${ws.root}/editeur?from=revenu-net`);
  await expect(page.getByRole("heading", { level: 1, name: "Revenu net : v5 · brouillon" })).toBeVisible();
  await expect(props(page).getByLabel("Description")).toHaveValue(description);
  const n = await submitDraft(page, "Description plus précise.");
  expect(branches()).toBe(seeded + 1);
  await page.getByRole("link", { name: "Voir les propositions" }).click();
  await expect(queueEntry(page, "Revenu net · canonique v5").filter({ hasText: "par Anna K." })).toHaveCount(1);
  expect(n).toBeGreaterThan(5);
});

// --- 09 : deux espaces sur le même poste, rien ne passe de l'un à l'autre --------------------

test("[S-0035-09] deux espaces, deux rôles : filtre, connexions, brouillon, revues et droits restent propres à chacun", async ({ page, request }) => {
  test.setTimeout(240_000);
  const suffix = unique();
  const names = { a: `Alpha ${suffix}`, b: `Bêta ${suffix}` };

  /** Un espace de démonstration à part, nommé, et rejoint par ce poste. `tweak` modifie son dépôt avant. */
  async function space(name: string, tweak: (work: string) => void = () => undefined) {
    const remote = demoRemote();
    const work = mkdtempSync(join(tmpdir(), "atlas-parcours-"));
    const id = `scenario-${crypto.randomUUID()}`;
    trackWorkspace(id, work, dirname(remote));
    git(work, "clone", remote, ".");
    python("import sys,yaml; from pathlib import Path; p=Path(sys.argv[1])/'atlas.yaml'; d=yaml.safe_load(p.read_text()); d['id']=sys.argv[2]; d['name']=sys.argv[3]; p.write_text(yaml.safe_dump(d,allow_unicode=True,sort_keys=False))", work, id, name);
    tweak(work);
    git(work, "add", "-A");
    git(work, "commit", "-qm", `Espace ${name}`);
    git(work, "push", "origin", "main");
    await joinAs(request, API, remote);
    return { id, remote, api: `${API}/api/workspaces/${id}`, root: `/#/w/${id}` };
  }
  const a = await space(names.a);
  // Dans le second espace, Anna n'est que lectrice.
  const b = await space(names.b, (work) => python("import sys,yaml; from pathlib import Path; p=Path(sys.argv[1])/'governance.yaml'; d=yaml.safe_load(p.read_text()); [m.update(roles=[{'role':'lecteur'}]) for m in d['members'] if m['account']=='anna.k']; p.write_text(yaml.safe_dump(d,allow_unicode=True,sort_keys=False))", work));
  expect(await (await request.get(a.api)).json()).toMatchObject({ role: "contributeur" });
  expect(await (await request.get(b.api)).json()).toMatchObject({ role: "lecteur" });

  // Claire approuve une proposition de l'espace Alpha seulement.
  await joinAs(request, CLAIRE, a.remote);
  expect((await request.post(`${CLAIRE}/api/workspaces/${a.id}/proposals/5/reviews`, { data: { event: "approve" } })).ok()).toBe(true);

  // Dans Alpha : filtre du catalogue, revue visible, connexion Databricks, brouillon dans l'éditeur.
  await page.goto(`${a.root}/catalogue`);
  await page.getByRole("searchbox", { name: "Rechercher dans le catalogue" }).fill("marge");
  await expect(table(page).getByRole("link")).toHaveText(["Marge brute"]);
  await expect(page.getByRole("link", { name: "Nouveau concept ou KPI" })).toBeVisible();
  await nav(page).getByRole("link", { name: "Propositions" }).click();
  await expect(queueEntry(page, "Revenu net · nordis-de")).toContainText(/Validations : 1 \/ 2/);
  await nav(page).getByRole("link", { name: "Connexions" }).click();
  const dbx = page.getByRole("row").filter({ hasText: "gold.finance" });
  await authorizeIn(page, () => dbx.getByRole("button", { name: "Se connecter à Databricks · dbx-fr" }).click());
  await expect(dbx.getByRole("cell", { name: /^Connecté ?· ?session OAuth$/ })).toBeVisible();
  await page.goto(`${a.root}/fiche/revenu-net`);
  await page.getByRole("link", { name: "Proposer une modification" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Revenu net : v5 · brouillon" })).toBeVisible();
  await props(page).getByLabel("Description").fill("Description propre à Alpha.");
  await expect(page.getByText(/Enregistré .* \(local\)/)).toBeVisible();

  // Bascule vers Bêta par le sélecteur d'espaces : tout y est comme au premier jour, et en lecture seule.
  await page.goto(`${a.root}/catalogue`);
  await page.getByRole("link", { name: new RegExp(`Espace\\s*${names.a}`) }).click();
  await page.getByRole("list", { name: "Espaces" }).getByRole("link").filter({ hasText: names.b }).click();
  await expect(page).toHaveURL(new RegExp(`#/w/${b.id}/catalogue$`));
  await expect(page.getByRole("searchbox", { name: "Rechercher dans le catalogue" })).toHaveValue("");
  await expect(table(page).getByRole("row")).toHaveCount(8);
  await expect(page.getByRole("link", { name: "Nouveau concept ou KPI" })).toHaveCount(0);
  await nav(page).getByRole("link", { name: "Propositions" }).click();
  await expect(queueEntry(page, "Revenu net · nordis-de")).toContainText(/Validations : 0 \/ 2/);
  await nav(page).getByRole("link", { name: "Connexions" }).click();
  await expect(page.getByRole("row").filter({ hasText: "gold.finance" })).toContainText("Jamais connecté");
  await page.goto(`${b.root}/fiche/revenu-net`);
  await expect(page.getByRole("heading", { level: 1, name: "Revenu net" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Proposer une modification" })).toHaveCount(0);
  await page.goto(`${b.root}/editeur?from=revenu-net`);
  await expect(page).not.toHaveURL(/editeur/); // un lecteur n'ouvre pas l'éditeur
  expect(await seriousViolations(page)).toEqual([]);

  // Retour dans Alpha : la connexion et le brouillon sont toujours là ; Bêta n'a aucun brouillon.
  await page.getByRole("link", { name: new RegExp(`Espace\\s*${names.b}`) }).click();
  await page.getByRole("list", { name: "Espaces" }).getByRole("link").filter({ hasText: names.a }).click();
  await expect(page).toHaveURL(new RegExp(`#/w/${a.id}/catalogue$`));
  await nav(page).getByRole("link", { name: "Connexions" }).click();
  await expect(page.getByRole("row").filter({ hasText: "gold.finance" }).getByRole("cell", { name: /^Connecté ?· ?session OAuth$/ })).toBeVisible();
  await page.goto(`${a.root}/editeur?from=revenu-net`);
  await expect(props(page).getByLabel("Description")).toHaveValue("Description propre à Alpha.");
  const draftA = ((await (await request.get(`${a.api}/editor/documents/revenu-net`)).json()) as { draft?: unknown }).draft;
  const draftB = ((await (await request.get(`${b.api}/editor/documents/revenu-net`)).json()) as { draft?: unknown }).draft;
  expect(draftA).toBeTruthy();
  expect(draftB ?? null).toBeNull();
  expect(await seriousViolations(page)).toEqual([]);
});

// --- 10 : après la fusion d'un collègue, retrouver l'état à jour -----------------------------

test("[S-0035-10] après la fusion d'une collègue, le catalogue, la fiche et la proposition suivante d'Anna partent de la version courante", async ({ page, request }) => {
  test.setTimeout(180_000);
  const ws = await isolatedDemo(request, API);
  await joinAs(request, CLAIRE, ws.remote);

  // Claire approuve la v5 de julien.h (Marc l'a déjà fait) et la fusionne, depuis son poste.
  const approved = await request.post(`${CLAIRE}/api/workspaces/${ws.id}/proposals/3/reviews`, { data: { event: "approve" } });
  expect(approved.ok(), await approved.text()).toBe(true);
  const merged = await request.post(`${CLAIRE}/api/workspaces/${ws.id}/proposals/3/merge`);
  expect(merged.ok(), await merged.text()).toBe(true);
  expect(onMain(ws.remote, "kpis/revenu-net.yaml")).toContain("version: 5");

  // Anna, contributrice (ni référente d'espace, ni Administration), rouvre son catalogue : Revenu net est en v5.
  await page.goto(`${ws.root}/catalogue`);
  await expect((await cellByColumn(catalogRow(page, "Revenu net"), page.getByRole("table", { name: "Concepts et KPI" }), "Version"))).toHaveText("v5");
  await page.goto(`${ws.root}/fiche/revenu-net`);
  await expect(page.getByText(/^v5 · validée le/)).toBeVisible();
  const tabs = page.getByRole("navigation", { name: "Onglets de la fiche" });
  await expect(tabs.getByRole("button", { name: "Versions 5" })).toBeVisible();

  // Sa prochaine modification part de la v5, donc s'ouvre en v6 : sinon sa proposition serait périmée d'emblée.
  await page.getByRole("link", { name: "Proposer une modification" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Revenu net : v6 · brouillon" })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});

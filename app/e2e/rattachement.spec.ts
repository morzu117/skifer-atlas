import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";
import { API, FAKE_DATABRICKS, seriousViolations } from "./demo";
import { git, python, relay, test, trackWorkspace } from "./isolation";

// Plan 0033 de bout en bout : un espace créé dans Atlas se rattache à un dépôt vide, sans CLI
// ni YAML à la main.
// - Dépôts nus locaux sur le serveur principal (anna.k) : le rattachement, ses refus, puis la
//   suite du parcours (autoriser Databricks, créer et proposer un point d'accès).
// - Faux GitHub (127.0.0.1:8792) sur un serveur dédié (8790, anna.k en local) : la connexion
//   par le device flow, les droits, et l'identité du créateur, qui devient `julien.h`, le
//   compte que le faux GitHub authentifie. `https://github.com/e2e-atlas/<nom>.git` est
//   redirigé par git vers un dépôt nu du dossier de test (playwright.config.ts).
// Le vrai GitHub n'est pas joignable ici : voir « Sans test front » dans scenarios.md.

const RATTACHEMENT = "http://127.0.0.1:8790";
const DATA = process.env.ATLAS_E2E_DATA!;
const GITHUB_FOLDER = join(DATA, "depots-github");

/** Un identifiant d'espace et un dépôt unique par scénario. */
const unique = () => crypto.randomUUID().slice(0, 8);

/** Dépôt nu, avec ou sans commit : « non vide » vaut un commit, ou seulement un tag. */
function bareRepository(path: string, content: "vide" | "commit" = "vide") {
  mkdirSync(dirname(path), { recursive: true });
  execFileSync("git", ["init", "--bare", "--quiet", "--initial-branch=main", path]);
  if (content === "commit") {
    const work = mkdtempSync(join(tmpdir(), "atlas-graine-"));
    git(work, "init", "--quiet", "--initial-branch=main");
    writeFileSync(join(work, "README.md"), "Un dépôt déjà utilisé.\n");
    git(work, "add", "-A");
    git(work, "commit", "-qm", "Premier commit");
    git(work, "push", "--quiet", path, "main");
  }
}

const refs = (bare: string) => git(bare, "for-each-ref");
const clone = (root: string, id: string) => join(root, "workspaces", id, "repo");

/** « Créer un espace » depuis l'accueil, avec un dépôt distant facultatif. */
async function createSpace(page: Page, id: string, entities: string, remote = "") {
  await page.goto("/#/");
  await page.getByRole("button", { name: "Créer un espace" }).click();
  const dialog = page.getByRole("dialog", { name: "Créer un espace" });
  await dialog.getByLabel(/^Nom/).fill(`Rattachement ${id}`);
  await dialog.getByLabel(/^Identifiant/).fill(id);
  await dialog.getByLabel("Entités").fill(entities);
  if (remote) await dialog.getByLabel("Dépôt distant").fill(remote);
  await dialog.getByRole("button", { name: "Créer l'espace" }).click();
  return dialog;
}

const repository = (page: Page) => page.getByRole("region", { name: "Dépôt Git de l'espace" });
const attachment = (page: Page) => page.getByRole("group", { name: "Rattacher un dépôt distant" });
const save = (page: Page) => page.getByRole("button", { name: /^Enregistrer et/ });

async function attach(page: Page, url: string) {
  const form = attachment(page);
  await form.getByLabel(/^Adresse du dépôt vide/).fill(url);
  await form.getByRole("button", { name: "Rattacher le dépôt" }).click();
}

/** Connexion GitHub par le device flow du faux GitHub, dans la fenêtre que l'app ouvre. */
async function connectGitHub(page: Page, scope: Locator) {
  await scope.getByRole("button", { name: "Se connecter à GitHub" }).click();
  await expect(scope.getByRole("group", { name: "Connexion à GitHub" })).toContainText(/code sur GitHub/);
  await expect(scope.getByRole("textbox")).toHaveCount(1); // l'adresse du dépôt, jamais un jeton
  const opened = page.waitForEvent("popup");
  await scope.getByRole("button", { name: "Ouvrir GitHub" }).click();
  const popup = await opened;
  await popup.getByRole("link", { name: "Autoriser", exact: true }).click();
  await expect(popup.getByText("Autorisation enregistrée")).toBeVisible();
  await popup.close();
}

async function authorizeIn(page: Page, click: () => Promise<void>) {
  const popup = page.waitForEvent("popup");
  await click();
  const window = await popup;
  await expect(window.getByText(/Connexion réussie/)).toBeVisible();
  await window.close();
}

test("[S-0033-01] [S-0033-02] [S-0033-06] [S-0033-07] [S-0033-08] espace neuf : rattacher un dépôt vide, autoriser Databricks, créer et proposer son point d'accès", async ({ page, request }) => {
  test.setTimeout(180_000);
  const id = `rattachement-${unique()}`;
  const root = mkdtempSync(join(tmpdir(), "atlas-rattachement-"));
  trackWorkspace(id, root);
  const empty = join(root, "vide.git");
  const full = join(root, "plein.git");
  const tagged = join(root, "etiquete.git");
  bareRepository(empty);
  bareRepository(full, "commit");
  bareRepository(tagged, "commit");
  git(tagged, "tag", "v1", "main");
  git(tagged, "update-ref", "-d", "refs/heads/main"); // un dépôt dont il ne reste qu'un tag
  const api = `${API}/api/workspaces/${id}`;

  await createSpace(page, id, "perrault-fr");
  await expect(page).toHaveURL(new RegExp(`#/w/${id}/catalogue$`));

  // Connexions n'envoie pas dans le vide : il dit qu'il manque un dépôt, puis mène à l'administration.
  await page.getByRole("navigation", { name: "Navigation de l'espace" }).getByRole("link", { name: "Connexions" }).click();
  const aside = page.getByRole("complementary", { name: "Configurer les plateformes" });
  await expect(aside).toContainText("Cet espace n'a pas encore de dépôt distant");
  await aside.getByRole("link", { name: "Configurer les plateformes" }).click();

  await expect(page.getByRole("heading", { level: 1, name: `Administration — Rattachement ${id}` })).toBeVisible();
  await expect(page.getByText("Cet espace n'a pas encore de dépôt distant", { exact: true })).toBeVisible();
  await expect(repository(page).getByText("Pas encore de dépôt distant")).toBeVisible();
  await page.getByRole("checkbox", { name: "Databricks" }).check();
  await expect(save(page)).toBeDisabled(); // l'enregistrement est une proposition sur le dépôt
  await expect(page.getByText("Rattachez d'abord un dépôt distant pour enregistrer.")).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);

  // [S-0033-02] Chaque refus dit pourquoi, et il ne reste ni distant ni commit.
  const refusals: [string, RegExp][] = [
    ["pas une adresse", /Adresse de dépôt invalide/],
    [join(root, "absent.git"), /Dépôt introuvable/],
    [full, /Ce dépôt n'est pas vide/],
    [tagged, /Ce dépôt n'est pas vide/],
  ];
  const before = git(clone(DATA, id), "rev-parse", "HEAD");
  for (const [url, message] of refusals) {
    await attach(page, url);
    await expect(attachment(page).getByRole("alert")).toContainText(message);
    await expect(repository(page).getByText("Pas encore de dépôt distant")).toBeVisible();
    await expect(attachment(page).getByRole("button", { name: "Rattacher le dépôt" })).toBeEnabled();
  }
  expect(await seriousViolations(page)).toEqual([]);
  expect(git(clone(DATA, id), "remote")).toBe("");
  expect(git(clone(DATA, id), "rev-parse", "HEAD")).toBe(before);
  expect(refs(full)).toContain("refs/heads/main"); // le dépôt plein n'a pas été touché
  expect((await (await request.get(api)).json()).git_remote).toBe("");

  // [S-0033-01] Le dépôt vide reçoit l'espace.
  await attach(page, empty);
  await expect(repository(page).getByText(`Dépôt rattaché : l'espace est publié sur ${empty}, sous le compte anna.k.`)).toBeVisible();
  await expect(repository(page).getByText(empty, { exact: true })).toBeVisible();
  await expect(repository(page).getByRole("button", { name: "Synchroniser" })).toBeVisible();
  await expect(attachment(page)).toHaveCount(0);
  await expect(page.getByText("Cet espace n'a pas encore de dépôt distant", { exact: true })).toHaveCount(0);
  expect(git(empty, "log", "--format=%s", "main")).toBe(`Création de l'espace Rattachement ${id}`);
  expect(git(clone(DATA, id), "remote")).toBe("origin");
  const attached = await (await request.get(api)).json();
  expect(attached).toMatchObject({ git_remote: empty, account: "anna.k", role: "referent" });
  expect(await seriousViolations(page)).toEqual([]);

  // [S-0033-06] L'enregistrement de la gouvernance passe désormais : seul référent, fusion aussitôt.
  // [S-0033-08] La case cochée avant le rattachement l'est encore : le brouillon a suivi.
  await expect(page.getByRole("checkbox", { name: "Databricks" })).toBeChecked();
  await expect(save(page)).toBeEnabled();
  await expect(save(page)).toHaveText("Enregistrer et fusionner");
  await save(page).click();
  await expect(page.getByText(/Paramètres enregistrés : proposition n° \d+ fusionnée sans revue\./)).toBeVisible();
  expect(git(empty, "show", "main:governance.yaml")).toContain("- databricks");

  // [S-0033-07] Connexions : créer, authentifier, tester et proposer le point d'accès.
  await page.getByRole("navigation", { name: "Navigation de l'espace" }).getByRole("link", { name: "Connexions" }).click();
  await expect(page.getByRole("complementary", { name: "Configurer les plateformes" })).toHaveCount(0);
  await page.getByRole("button", { name: "Ajouter un point d'accès" }).click();
  const panel = page.getByRole("complementary", { name: "Nouveau point d'accès" });
  await expect(panel.getByRole("combobox", { name: /Plateforme/ })).toHaveValue("databricks");
  await expect(panel.getByRole("combobox", { name: "Entité" })).toHaveValue("perrault-fr");
  await panel.getByRole("textbox", { name: "Identifiant" }).fill("dbx-perrault");
  await panel.getByRole("textbox", { name: "Hôte" }).fill(FAKE_DATABRICKS);
  await panel.getByRole("textbox", { name: "SQL warehouse" }).fill("abc123");
  await panel.getByRole("textbox", { name: "Schéma" }).fill("gold.finance");
  await authorizeIn(page, () => panel.getByRole("button", { name: "S'authentifier avec OAuth" }).click());
  await expect(panel.getByText("Connecté : le token est rangé dans votre coffre, sous dbx-perrault.")).toBeVisible();
  await panel.getByRole("button", { name: "Tester la connexion" }).click();
  await expect(panel.getByText(/^Connexion OK · \d+ ms$/)).toBeVisible();
  await panel.getByRole("textbox", { name: "Justification" }).fill("Point d'accès de perrault-fr.");
  await panel.getByRole("button", { name: "Proposer le point d'accès" }).click();
  await expect(panel.getByText(/^Proposition n° \d+ ouverte\./)).toBeVisible();
  const seen = await page.evaluate(() => [document.documentElement.outerHTML, JSON.stringify(localStorage), JSON.stringify(sessionStorage)].join("\n"));
  expect(seen).not.toMatch(/at-secret|rt-secret/);
  expect(git(empty, "branch", "--list")).toContain("prop/");
});

test("[S-0033-03] [S-0033-04] [S-0033-02] GitHub : connexion avant le rattachement, refus par droit ou dépôt, puis le créateur reste référent sous son compte GitHub", async ({ page, request }) => {
  test.setTimeout(180_000);
  const id = `rattachement-${unique()}`;
  const suffix = unique();
  const names = { empty: `vide-${suffix}`, full: `plein-${suffix}`, read: `lecture-${suffix}`, archived: `archive-${suffix}`, missing: `introuvable-${suffix}` };
  const bare = (name: string) => join(GITHUB_FOLDER, `${name}.git`);
  const url = (name: string) => `https://github.com/e2e-atlas/${name}.git`;
  trackWorkspace(id, bare(names.empty), bare(names.full), bare(names.read), bare(names.archived));
  bareRepository(bare(names.empty));
  bareRepository(bare(names.full), "commit");
  bareRepository(bare(names.read));
  bareRepository(bare(names.archived));
  const root = join(DATA, "rattachement");
  await relay(page, RATTACHEMENT);

  await createSpace(page, id, "perrault-fr");
  await expect(page).toHaveURL(new RegExp(`#/w/${id}/catalogue$`));
  await expect(page.locator(".sidebar-user")).toContainText("anna.k");
  await page.goto(`/#/w/${id}/administration`);
  const form = attachment(page);

  // [S-0033-03] Une adresse GitHub demande d'abord la connexion : sans elle, rien ne part.
  await form.getByLabel(/^Adresse du dépôt vide/).fill(url(names.missing));
  await expect(form.getByText(/Atlas se sert de votre compte GitHub/)).toBeVisible();
  await expect(form.getByRole("button", { name: "Rattacher le dépôt" })).toBeDisabled();
  await connectGitHub(page, form);
  await expect(form.getByText("Connecté à GitHub en tant que @julien.h.")).toBeVisible();
  await expect(form.getByRole("button", { name: "Rattacher le dépôt" })).toBeEnabled();
  expect(await seriousViolations(page)).toEqual([]);

  // [S-0033-02] Introuvable, lecture seule, archivé, non vide : un message chacun, rien d'écrit.
  const before = git(clone(root, id), "rev-parse", "HEAD");
  const refusals: [string, RegExp][] = [
    [names.missing, /Dépôt introuvable/],
    [names.read, /Pas de droit d'écriture sur ce dépôt/],
    [names.archived, /Pas de droit d'écriture sur ce dépôt/],
    [names.full, /Ce dépôt n'est pas vide/],
  ];
  for (const [name, message] of refusals) {
    await attach(page, url(name));
    await expect(form.getByRole("alert")).toContainText(message);
    await expect(form.getByRole("alert")).not.toContainText(/gho_/);
    await expect(repository(page).getByText("Pas encore de dépôt distant")).toBeVisible();
  }
  expect(refs(bare(names.read))).toBe("");
  expect(refs(bare(names.archived))).toBe("");
  expect(git(clone(root, id), "remote")).toBe("");
  expect(git(clone(root, id), "rev-parse", "HEAD")).toBe(before);

  // [S-0033-04] Le dépôt vide : le créateur, inscrit `anna.k`, devient `julien.h` pour GitHub
  // et garde son rôle de référent.
  await attach(page, url(names.empty));
  await expect(repository(page).getByText(`Dépôt rattaché : l'espace est publié sur ${url(names.empty)}, sous le compte julien.h.`)).toBeVisible();
  await expect(page.locator(".sidebar-user")).toContainText("julien.h");
  await expect(page.locator(".sidebar-user")).toContainText("Référent d'annuaire");
  await expect(page.getByRole("heading", { level: 1, name: `Administration — Rattachement ${id}` })).toBeVisible();
  const members = page.getByRole("table", { name: "Utilisateurs et rôles" });
  await expect(members.getByRole("row", { name: /julien\.h/ })).toContainText("Référent");
  await expect(members.getByText("anna.k", { exact: true })).toHaveCount(0);
  expect(git(bare(names.empty), "log", "--format=%s", "main").split("\n")).toEqual([
    "Identité du créateur : anna.k devient julien.h",
    `Création de l'espace Rattachement ${id}`,
  ]);
  expect(git(bare(names.empty), "show", "main:governance.yaml")).toContain("account: julien.h");
  const attached = await (await request.get(`${RATTACHEMENT}/api/workspaces/${id}`)).json();
  expect(attached).toMatchObject({ git_remote: url(names.empty), account: "julien.h", role: "referent", space_referent: true });
  expect(git(clone(root, id), "status", "--porcelain")).toBe("");
  expect(await seriousViolations(page)).toEqual([]);

  // Rechargé, l'espace garde son rôle : rien ne dépend de l'état de l'écran.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: `Administration — Rattachement ${id}` })).toBeVisible();
  await expect(page.locator(".sidebar-user")).toContainText("Référent d'annuaire");
});

test("[S-0033-05] Créer un espace avec une adresse GitHub : la connexion et le rattachement se font dans le panneau", async ({ page, request }) => {
  test.setTimeout(120_000);
  const id = `rattachement-${unique()}`;
  const name = `vide-${unique()}`;
  const target = join(GITHUB_FOLDER, `${name}.git`);
  const url = `https://github.com/e2e-atlas/${name}.git`;
  trackWorkspace(id, target);
  bareRepository(target);
  await relay(page, RATTACHEMENT);

  const dialog = await createSpace(page, id, "perrault-fr", url);
  // Sans connexion GitHub, le serveur refuse avant de toucher au dépôt ; l'espace existe, lui.
  await expect(dialog.getByText("Espace créé, dépôt distant non rattaché")).toBeVisible();
  const form = dialog.getByRole("group", { name: "Rattacher un dépôt distant" });
  await expect(form.getByLabel(/^Adresse du dépôt vide/)).toHaveValue(url);
  expect(refs(target)).toBe("");
  await connectGitHub(page, form);
  await form.getByRole("button", { name: "Rattacher le dépôt" }).click();
  await expect(page).toHaveURL(new RegExp(`#/w/${id}/catalogue$`));
  await expect(page.locator(".sidebar-user")).toContainText("julien.h");
  await expect(page.locator(".sidebar-user")).toContainText("Référent d'annuaire");
  const attached = await (await request.get(`${RATTACHEMENT}/api/workspaces/${id}`)).json();
  expect(attached).toMatchObject({ git_remote: url, account: "julien.h", role: "referent" });
  expect(git(target, "log", "--format=%s", "main").split("\n")).toHaveLength(2);
});

test("[S-0033-10] espace neuf : rattacher un dépôt vide, ajouter un domaine, créer puis publier son premier KPI", async ({ page }) => {
  test.setTimeout(240_000);
  const id = `rattachement-${unique()}`;
  const root = mkdtempSync(join(tmpdir(), "atlas-rattachement-"));
  trackWorkspace(id, root);
  const empty = join(root, "vide.git");
  bareRepository(empty);
  const kpi = { id: "chiffre-affaires", label: "Chiffre d'affaires" };
  const nav = page.getByRole("navigation", { name: "Navigation de l'espace" });
  const props = page.getByRole("complementary", { name: "Propriétés" });
  const palette = page.getByRole("complementary", { name: "Palette des nœuds" });

  // Un espace neuf, rattaché à un dépôt vide : ni domaine ni calendrier, seulement l'espace.
  await createSpace(page, id, "perrault-fr");
  await expect(page).toHaveURL(new RegExp(`#/w/${id}/catalogue$`));
  await nav.getByRole("link", { name: "Administration" }).click();
  await attach(page, empty);
  await expect(repository(page).getByText(`Dépôt rattaché : l'espace est publié sur ${empty}, sous le compte anna.k.`)).toBeVisible();

  // Le domaine passe par l'Administration : seul référent, la proposition est fusionnée aussitôt.
  await page.getByRole("button", { name: "Domaine", exact: true }).click();
  const form = page.getByRole("group", { name: "Nouveau domaine" });
  await form.getByRole("textbox", { name: /Libellé/ }).fill("Finance");
  await expect(form.getByRole("textbox", { name: /Identifiant/ })).toHaveValue("finance");
  await form.getByRole("button", { name: "Ajouter le domaine" }).click();
  expect(await seriousViolations(page)).toEqual([]);
  await expect(save(page)).toHaveText("Enregistrer et fusionner");
  await save(page).click();
  await expect(page.getByText(/Paramètres enregistrés : proposition n° \d+ fusionnée sans revue\./)).toBeVisible();
  expect(git(empty, "show", "main:governance.yaml")).toContain("id: finance");

  // Le menu Domaine propose le nouveau domaine sans recharger l'app : le trajet reste dans l'app.
  await nav.getByRole("link", { name: "Catalogue" }).click();
  await page.getByRole("link", { name: "Nouveau concept ou KPI" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Nouveau concept ou KPI" })).toBeFocused();
  await page.getByLabel(/^Libellé/).fill(kpi.label);
  await page.getByLabel(/^Identifiant/).fill(kpi.id);
  await expect(page.getByLabel(/^Propriétaire/)).toHaveValue("anna.k");
  const domain = page.getByLabel(/^Domaine/);
  await expect(domain.locator('option[value="finance"]')).toHaveCount(1);
  await domain.selectOption("finance");
  expect(await seriousViolations(page)).toEqual([]);
  await page.getByRole("button", { name: "Créer et ouvrir l'éditeur" }).click();
  await expect(page.getByRole("heading", { level: 1, name: `${kpi.label} : v1 · brouillon` })).toBeVisible();

  // Un KPI minimal : calendrier civil et fuseau, une source et une agrégation (la sortie d'un KPI est agrégée).
  const civil = props.getByLabel(/^Calendrier/).locator("option", { hasText: /civil/i });
  await expect(civil).toHaveCount(1); // un espace neuf n'a aucun fichier de calendrier : le civil doit tout de même s'offrir
  await props.getByLabel(/^Calendrier/).selectOption("civil");
  await props.getByLabel(/^Fuseau horaire/).fill("Europe/Paris");

  await palette.getByRole("button", { name: "Source", exact: true }).click();
  await expect(props.getByText("n01", { exact: true })).toBeVisible();
  await props.getByLabel("Libellé").fill("Factures");
  await props.getByLabel(/^Plateforme/).selectOption("databricks");
  await props.getByLabel(/^Table/).fill("gold.finance.fact_facturation");
  await props.getByLabel(/^Propriétaire/).fill("anna.k");
  for (const [index, [name, type]] of [["entite", "string"], ["montant_ttc", "decimal"]].entries()) {
    await props.getByRole("button", { name: "Ajouter une colonne" }).click();
    await props.getByLabel(`Nom de la colonne ${index + 1}`).fill(name);
    await props.getByLabel(`Type de la colonne ${index + 1}`).selectOption(type);
  }

  await palette.getByRole("button", { name: "Agrégation", exact: true }).click();
  await expect(props.getByText("n02", { exact: true })).toBeVisible();
  await props.getByRole("button", { name: "Ajouter une mesure" }).click();
  await props.getByLabel("Colonne source de la mesure 1").selectOption("montant_ttc");
  await props.getByLabel("Colonne produite par la mesure 1").fill("chiffre_affaires");
  await props.getByLabel("Fonction de la mesure 1").selectOption("sum");
  await props.getByRole("checkbox", { name: "entite" }).check();
  await expect(page.getByText("schéma 1 · 2 nœuds · 1 arête")).toBeVisible();
  const bottom = page.getByRole("region", { name: "Validation du document" });
  await expect(bottom.getByText("Compilable Databricks, Snowflake")).toBeVisible();
  await expect(bottom.getByRole("listitem").filter({ hasText: "ERREUR" })).toHaveCount(0);
  expect(await seriousViolations(page)).toEqual([]);

  // Soumettre : la proposition s'ouvre, et le référent seul la fusionne sans revue.
  await page.getByRole("button", { name: "Soumettre la proposition" }).click();
  const dialog = page.getByRole("dialog", { name: "Soumettre la proposition" });
  await dialog.getByLabel(/Justification/).fill("Premier KPI de l'espace.");
  await dialog.getByRole("button", { name: "Soumettre" }).click();
  await expect(page.getByRole("heading", { name: /Proposition n° \d+ créée/ })).toBeVisible();
  await page.getByRole("link", { name: "Voir les propositions" }).click();
  await expect(page.getByText("Fusionnée sans revue : aucun autre compte habilité")).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
  await page.getByRole("button", { name: "Fusionner", exact: true }).click();
  await expect(page.getByText(/Proposition n° \d+ fusionnée/)).toBeVisible();
  expect(git(empty, "ls-tree", "-r", "--name-only", "main").split("\n")).toContain(`kpis/${kpi.id}.yaml`);
  expect(git(empty, "show", `main:kpis/${kpi.id}.yaml`)).toContain("domain: finance");

  // Catalogue, puis fiche : le KPI y est, avec son domaine et son propriétaire.
  await nav.getByRole("link", { name: "Catalogue" }).click();
  const table = page.getByRole("table", { name: "Concepts et KPI" });
  await expect(table.getByRole("row", { name: new RegExp(kpi.label) })).toContainText("Finance");
  expect(await seriousViolations(page)).toEqual([]);
  await table.getByRole("link", { name: kpi.label }).click();
  await expect(page).toHaveURL(new RegExp(`#/w/${id}/fiche/${kpi.id}$`));
  await expect(page.getByRole("heading", { level: 1, name: kpi.label })).toBeVisible();
  await expect(page.getByText("Finance", { exact: true })).toBeVisible();
  // Le nom du créateur vient de la machine (git config user.name) : on le relit dans la gouvernance du dépôt.
  const owner = python("import sys,yaml; print(next(m['name'] for m in yaml.safe_load(sys.argv[1])['members'] if m['account']=='anna.k'))", git(empty, "show", "main:governance.yaml")).trim();
  expect(owner).not.toBe("");
  await expect(page.getByText(`Propriétaire : ${owner} ·`)).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});

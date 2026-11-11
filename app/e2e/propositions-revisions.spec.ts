import { expect, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { API, seriousViolations } from "./demo";
import { git, isolatedDemo, relay, test } from "./isolation";

// ADR 0056 : réviser une proposition ouverte depuis Atlas, et la retirer. Un compte = un
// serveur (playwright.config.ts) : anna.k sur le serveur principal, claire.m (référente
// Finance), marc.d (validateur Finance) et julien.h (référent de l'espace) sur les leurs.
// Les propositions de démonstration (examples/propositions-nordis.py) servent d'état de
// départ : n° 1 nordis-es de sofia.r, n° 3 Revenu net v5 de julien.h (approuvée par marc.d),
// n° 5 nordis-de d'anna.k. Chaque test a son espace et son dépôt nu, retirés à la fin.
// Les gestes passent par l'écran ; l'API ne sert qu'à préparer l'état et à constater un refus.

const CLAIRE = "http://127.0.0.1:8798";
const MARC = "http://127.0.0.1:8797";
const JULIEN = "http://127.0.0.1:8795";

type Ws = Awaited<ReturnType<typeof isolatedDemo>>;

async function joinAs(request: APIRequestContext, server: string, remote: string) {
  const joined = await request.post(`${server}/api/workspaces/join`, { data: { remote_url: remote } });
  expect(joined.status(), await joined.text()).toBe(201);
}

async function accountPage(context: BrowserContext, server: string) {
  const page = await context.newPage();
  await relay(page, server);
  return page;
}

const queueEntry = (page: Page, title: string) => page.getByRole("list", { name: "File des propositions" }).getByRole("link").filter({ hasText: title });
const selection = (page: Page) => page.getByRole("region", { name: "Proposition sélectionnée" });
const thread = (page: Page) => selection(page).getByRole("region", { name: "Fil de la proposition" });
const threadItem = (page: Page, text: string | RegExp) => thread(page).getByRole("listitem").filter({ hasText: text });
const props = (page: Page) => page.getByRole("complementary", { name: "Propriétés" });
const bottom = (page: Page) => page.getByRole("region", { name: "Validation du document" });
const canvasNode = (page: Page, id: string) => page.locator(`[data-node-id="${id}"]`);
const reviseLink = (page: Page) => selection(page).getByRole("link", { name: "Modifier ma proposition" });
const closeButton = (page: Page) => selection(page).getByRole("button", { name: "Retirer la proposition" });

/** La proposition `n` dans la file `status` de ce compte, relue même si l'adresse ne change pas. */
async function openProposal(page: Page, root: string, n: number, status = "open") {
  const url = `${root}/propositions?n=${n}&status=${status}&domain=tous`;
  const same = page.url().endsWith(url.replace(/^\/?/, ""));
  await page.goto(url);
  if (same) await page.reload();
  await expect(selection(page)).toBeVisible();
}

/** Branche et tête de la proposition `n`, lues sur le serveur `server`. */
async function proposalRef(request: APIRequestContext, server: string, ws: Ws, n: number) {
  const found = (await (await request.get(`${server}/api/workspaces/${ws.id}/proposals/${n}`)).json()) as { branch: string; head: string };
  return { branch: found.branch, head: found.head };
}

/** Tête de la branche sur le dépôt distant isolé ; vide si elle n'existe plus. */
const remoteHead = (ws: Ws, branch: string) => git(ws.remote, "for-each-ref", "--format=%(objectname)", `refs/heads/${branch}`);

/** Retire la proposition affichée avec ce motif, par la boîte de confirmation. */
async function retire(page: Page, n: number, reason: string) {
  await closeButton(page).click();
  const dialog = page.getByRole("alertdialog", { name: "Retirer la proposition ?" });
  await expect(dialog).toContainText("Ce retrait est irréversible depuis Atlas.");
  await expect(dialog.getByRole("button", { name: "Annuler" })).toBeFocused();
  await dialog.getByLabel("Motif facultatif").fill(reason);
  expect(await seriousViolations(page)).toEqual([]);
  await dialog.getByRole("button", { name: "Retirer la proposition" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(selection(page).getByText(`Proposition n° ${n} retirée`)).toBeVisible();
  await expect(selection(page).getByText("La branche est conservée.")).toBeVisible();
}

/** La proposition `n`, retirée, telle que la voit ce compte dans la file « Fermées ». */
async function expectClosed(page: Page, root: string, n: number, title: string, by: string, reason: string) {
  await openProposal(page, root, n, "closed");
  await expect(queueEntry(page, title)).toContainText("Fermée");
  await expect(selection(page).getByText("Fermée", { exact: true })).toBeVisible();
  await expect(threadItem(page, `Proposition retirée : ${reason}`)).toContainText(by);
  await expect(reviseLink(page)).toHaveCount(0);
  await expect(closeButton(page)).toHaveCount(0);
}

// --- 01 : révision par l'auteur, revues dépassées, blocage maintenu, fusion ---------------

test("[S-0056-01] l'auteur révise depuis l'éditeur : approbation dépassée, demande de changements toujours bloquante jusqu'à l'approbation de son auteur, puis fusion", async ({ page, request, context }) => {
  test.setTimeout(240_000);
  const ws = await isolatedDemo(request, API);
  for (const server of [JULIEN, CLAIRE, MARC]) await joinAs(request, server, ws.remote);
  await relay(page, JULIEN); // la page de ce test joue julien.h, auteur de la n° 3
  const claire = await accountPage(context, CLAIRE);
  const marc = await accountPage(context, MARC);
  const title = "Revenu net · canonique v5";
  const main = git(ws.remote, "rev-parse", "main");
  const before = await proposalRef(request, JULIEN, ws, 3);

  // État de départ : marc.d a approuvé la n° 3 (démonstration), claire.m y demande des changements.
  const asked = await request.post(`${CLAIRE}/api/workspaces/${ws.id}/proposals/3/reviews`, { data: { event: "request_changes", body: "Le libellé du filtre n02 doit dire qu'il ne garde que les factures validées." } });
  expect(asked.ok(), await asked.text()).toBe(true);

  // Julien, auteur, voit l'approbation de Marc et la demande de Claire, et peut modifier sa proposition.
  await openProposal(page, ws.root, 3);
  await expect(queueEntry(page, title)).toContainText("Validations : 1 / 2");
  await expect(selection(page)).toContainText("Changements demandés par claire.m.");
  await expect(threadItem(page, "Marc D. a approuvé")).not.toContainText("dépassée");
  expect(await seriousViolations(page)).toEqual([]);
  await reviseLink(page).click();

  // L'éditeur existant, en mode révision : le document de la branche, pas celui de main.
  await expect(page).toHaveURL(/\/editeur\?.*proposal=3/);
  await expect(page.getByRole("heading", { level: 1, name: "Revenu net : Révision de la proposition n° 3" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Proposition" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Soumettre la proposition" })).toHaveCount(0);
  const label = "Factures validées uniquement";
  await canvasNode(page, "n02").click();
  await props(page).getByLabel("Libellé").fill(label);
  await expect(bottom(page).getByText("Compilable Databricks, Snowflake")).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
  await page.getByRole("button", { name: "Envoyer la révision" }).click();
  const dialog = page.getByRole("dialog", { name: "Envoyer la révision" });
  await expect(dialog.getByRole("region", { name: "Écarts" })).toContainText("1 écart");
  await expect(dialog.getByText("Justification")).toHaveCount(0); // la note est facultative, sans justification exigée
  const note = "Libellé de n02 précisé à la demande de Claire.";
  await dialog.getByLabel("Note facultative").fill(note);
  expect(await seriousViolations(page)).toEqual([]);
  await dialog.getByRole("button", { name: "Envoyer la révision" }).click();

  // Retour à la proposition ; le dépôt a un commit de plus sur la branche, enfant de l'ancienne tête, et main n'a pas bougé.
  await expect(page).toHaveURL(/\/propositions\?.*n=3/);
  await expect.poll(() => remoteHead(ws, before.branch)).not.toBe(before.head);
  const head = remoteHead(ws, before.branch);
  expect(git(ws.remote, "rev-parse", `${head}^`)).toBe(before.head);
  expect(git(ws.remote, "show", `${head}:kpis/revenu-net.yaml`)).toContain(`label: ${label}`);
  expect(git(ws.remote, "log", "-1", "--format=%B", head)).toContain(note);
  expect(git(ws.remote, "rev-parse", "main")).toBe(main);

  // Le fil a la révision ; l'approbation de Marc est dépassée et ne compte plus ; la demande de Claire bloque toujours.
  const revision = threadItem(page, "a envoyé la révision 2");
  await expect(revision).toContainText(note);
  await expect(revision).toContainText(`1 écart(s) · ${head.slice(0, 7)}`);
  await expect(revision).toContainText("Julien H. a envoyé la révision 2"); // le compte Atlas, pas l'identité Git du poste
  await expect(threadItem(page, "Marc D. a approuvé (revue dépassée)")).toHaveCount(1);
  await expect(threadItem(page, "Claire M. demande des changements (sur un ancien commit, demande toujours bloquante)")).toHaveCount(1);
  await expect(queueEntry(page, title)).toContainText("Validations : 0 / 2");
  await expect(selection(page)).toContainText("Changements demandés par claire.m.");
  expect(await seriousViolations(page)).toEqual([]);

  // Marc approuve la nouvelle tête : 1 / 2, la demande de Claire bloque encore, la fusion est refusée.
  await openProposal(marc, ws.root, 3);
  await marc.getByRole("button", { name: "Approuver (0 / 2)" }).click();
  await expect(queueEntry(marc, title)).toContainText("Validations : 1 / 2");
  await expect(selection(marc)).toContainText("Changements demandés par claire.m.");
  await expect(selection(marc).getByRole("button", { name: "Fusionner", exact: true })).toHaveCount(0);
  const refused = await request.post(`${MARC}/api/workspaces/${ws.id}/proposals/3/merge`);
  expect(refused.status()).toBe(409);
  expect(await refused.json()).toMatchObject({ detail: { code: "not_ready" } });
  expect(git(ws.remote, "rev-parse", "main")).toBe(main);
  // Le fil suit l'ordre des instants (dates UTC), pas celui des chaînes : demande, révision, puis nouvelle approbation.
  const order = await thread(marc).getByRole("listitem").allTextContents();
  const at = (match: (entry: string) => boolean) => order.findIndex(match);
  const steps = [
    at((entry) => entry.includes("Marc D. a approuvé (revue dépassée)")),
    at((entry) => entry.includes("Claire M. demande des changements")),
    at((entry) => entry.includes("a envoyé la révision 2")),
    at((entry) => entry.includes("Marc D. a approuvé") && !entry.includes("dépassée")),
  ];
  expect(steps, `fil dans l'ordre chronologique : ${JSON.stringify(order)}`).toEqual([...steps].sort((a, b) => a - b));
  expect(steps).not.toContain(-1);
  expect(at((entry) => entry.includes("a envoyé la révision 1"))).toBeLessThan(steps[1]);

  // Claire approuve à son tour la nouvelle tête : la demande est levée, la proposition est prête, elle la fusionne.
  await openProposal(claire, ws.root, 3);
  await claire.getByRole("button", { name: "Approuver (1 / 2)" }).click();
  await expect(queueEntry(claire, title)).toContainText("Validations : 2 / 2 · prête à fusionner");
  await expect(selection(claire)).not.toContainText("Changements demandés par claire.m.");
  await expect(threadItem(claire, "Claire M. a approuvé")).toHaveCount(1);
  // La demande levée par l'approbation de son auteure n'est plus dite bloquante ; elle reste au fil, dépassée.
  await expect(threadItem(claire, "Claire M. demande des changements (revue dépassée)")).toHaveCount(1);
  await expect(thread(claire)).not.toContainText("demande toujours bloquante");
  await selection(claire).getByRole("button", { name: "Fusionner", exact: true }).click();
  await expect(claire.getByText("Proposition n° 3 fusionnée")).toBeVisible();

  // Le dépôt : la version révisée sur main, la trace des deux revues de la nouvelle tête, le tag.
  expect(git(ws.remote, "show", "main:kpis/revenu-net.yaml")).toContain(`label: ${label}`);
  const message = git(ws.remote, "log", "-1", "--format=%B", "main");
  expect(message).toContain("Atlas-Proposal: #3");
  expect(message).toContain("Atlas-Review: approved by claire.m, marc.d");
  await expect.poll(() => git(ws.remote, "tag", "--list", "doc/revenu-net/v5")).toBe("doc/revenu-net/v5");
});

// --- 02 : un autre compte ne peut pas réviser -------------------------------------------------

test("[S-0056-02] un autre compte n'a pas « Modifier ma proposition », l'éditeur de révision et l'API le refusent, la branche ne bouge pas", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await joinAs(request, CLAIRE, ws.remote);
  await relay(page, CLAIRE);
  const before = await proposalRef(request, API, ws, 5);

  // Claire, référente, peut retirer la n° 5 d'Anna, mais pas la modifier.
  await openProposal(page, ws.root, 5);
  await expect(closeButton(page)).toBeVisible();
  await expect(reviseLink(page)).toHaveCount(0);
  await expect(selection(page).getByRole("button", { name: "Approuver (0 / 2)" })).toBeVisible();

  // L'adresse de l'éditeur de révision, saisie à la main, est refusée.
  await page.goto(`${ws.root}/editeur?from=revenu-net--nordis-de&proposal=5`);
  await expect(page.getByText("Seul l'auteur peut réviser la proposition.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Envoyer la révision" })).toHaveCount(0);

  // L'API refuse la révision, même avec le document de la branche, et rien n'est poussé.
  const document = git(ws.remote, "show", `${before.head}:variants/revenu-net/nordis-de.yaml`);
  const refused = await request.post(`${CLAIRE}/api/workspaces/${ws.id}/proposals/5/revisions`, { data: { document_yaml: document.replace("(MwSt DE 19 %)", "(MwSt 19 %)"), note: "" } });
  expect(refused.status()).toBe(403);
  expect(await refused.json()).toMatchObject({ detail: { code: "forbidden" } });
  expect(remoteHead(ws, before.branch)).toBe(before.head);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

// --- 03 : retrait par l'auteur ----------------------------------------------------------------

test("[S-0056-03] l'auteure retire sa proposition avec un motif : fermée, motif dans le fil, branche conservée", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  const before = await proposalRef(request, API, ws, 5);
  const main = git(ws.remote, "rev-parse", "main");
  const title = "Revenu net · nordis-de";

  await openProposal(page, ws.root, 5);
  await expect(reviseLink(page)).toBeVisible();
  // Annuler ne retire rien.
  await closeButton(page).click();
  await page.getByRole("alertdialog", { name: "Retirer la proposition ?" }).getByRole("button", { name: "Annuler" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(closeButton(page)).toBeFocused();

  const reason = "Remplacée par un point de variation du canonique.";
  await retire(page, 5, reason);
  await expect(queueEntry(page, title)).toHaveCount(0); // a quitté les ouvertes

  await expectClosed(page, ws.root, 5, title, "Anna K.", reason);
  expect(await seriousViolations(page)).toEqual([]);
  expect(remoteHead(ws, before.branch)).toBe(before.head);
  expect(git(ws.remote, "rev-parse", "main")).toBe(main);
});

// --- 04 : retrait par un référent -------------------------------------------------------------

test("[S-0056-04] la référente du domaine et le référent de l'espace retirent la proposition d'un autre : fermée, motif dans le fil, branche conservée", async ({ page, request, context }) => {
  const ws = await isolatedDemo(request, API);
  await joinAs(request, CLAIRE, ws.remote);
  await joinAs(request, JULIEN, ws.remote);
  const claire = await accountPage(context, CLAIRE);
  const julien = await accountPage(context, JULIEN);
  const de = await proposalRef(request, API, ws, 5);
  const es = await proposalRef(request, API, ws, 1);

  // Claire, référente Finance, retire la n° 5 d'Anna ; elle ne peut pas la modifier.
  const reasonDe = "Doublon de la demande FR : on traite le point de variation dans le canonique.";
  await openProposal(claire, ws.root, 5);
  await expect(reviseLink(claire)).toHaveCount(0);
  await retire(claire, 5, reasonDe);
  await expectClosed(claire, ws.root, 5, "Revenu net · nordis-de", "Claire M.", reasonDe);

  // Julien, référent de l'espace sans domaine, retire la n° 1 de Sofia (Finance).
  const reasonEs = "La table consolidée n'est pas encore publiée.";
  await openProposal(julien, ws.root, 1);
  await retire(julien, 1, reasonEs);
  await expectClosed(julien, ws.root, 1, "Revenu net · nordis-es", "Julien H.", reasonEs);
  expect(await seriousViolations(julien)).toEqual([]);

  // L'auteure voit sa proposition fermée et le motif de Claire ; les deux branches restent sur le distant.
  await expectClosed(page, ws.root, 5, "Revenu net · nordis-de", "Claire M.", reasonDe);
  expect(remoteHead(ws, de.branch)).toBe(de.head);
  expect(remoteHead(ws, es.branch)).toBe(es.head);
});

// --- 05 : retrait refusé ----------------------------------------------------------------------

test("[S-0056-05] un validateur ni auteur ni référent n'a pas « Retirer la proposition », l'API refuse le retrait, la proposition reste ouverte", async ({ page, request, context }) => {
  const ws = await isolatedDemo(request, API);
  await joinAs(request, MARC, ws.remote);
  const marc = await accountPage(context, MARC);
  const before = await proposalRef(request, API, ws, 5);

  await openProposal(marc, ws.root, 5);
  await expect(selection(marc).getByRole("button", { name: "Approuver (0 / 2)" })).toBeVisible();
  await expect(closeButton(marc)).toHaveCount(0);
  await expect(reviseLink(marc)).toHaveCount(0);

  const refused = await request.post(`${MARC}/api/workspaces/${ws.id}/proposals/5/close`, { data: { reason: "Je n'en veux pas." } });
  expect(refused.status()).toBe(403);
  expect(await refused.json()).toMatchObject({ detail: { code: "forbidden" } });

  // Chez Anna, la proposition est toujours ouverte, sans trace de retrait.
  await openProposal(page, ws.root, 5);
  await expect(queueEntry(page, "Revenu net · nordis-de")).toContainText("Validations : 0 / 2");
  await expect(closeButton(page)).toBeVisible();
  await expect(thread(page)).not.toContainText("Proposition retirée");
  expect(remoteHead(ws, before.branch)).toBe(before.head);
});

// --- 06 : révision invalide -------------------------------------------------------------------

test("[S-0056-06] une révision invalide est bloquée avec ses diagnostics, le serveur la refuse aussi, et rien n'est poussé", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await joinAs(request, JULIEN, ws.remote);
  await relay(page, JULIEN);
  const before = await proposalRef(request, JULIEN, ws, 3);
  const posted: string[] = [];
  page.on("request", (r) => { if (r.method() === "POST" && r.url().includes("/revisions")) posted.push(r.url()); });

  await openProposal(page, ws.root, 3);
  await reviseLink(page).click();
  await expect(page.getByRole("heading", { level: 1, name: "Revenu net : Révision de la proposition n° 3" })).toBeVisible();

  // Le filtre n02 perd son traitement des valeurs nulles, champ requis : le YAML reste lisible.
  const opened = await (await request.get(`${JULIEN}/api/workspaces/${ws.id}/editor/proposals/3`)).json();
  const current = (await (await request.post(`${JULIEN}/api/workspaces/${ws.id}/editor/check`, { data: { document: opened.document, node_id: null } })).json()).yaml as string;
  const invalid = current.replace(/^ *nulls: drop\n/m, "");
  expect(invalid).not.toBe(current);
  await page.getByRole("button", { name: "Éditer en YAML" }).click();
  const yaml = page.getByRole("textbox", { name: "YAML de Revenu net" });
  await yaml.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText(invalid);
  await page.getByRole("button", { name: "Revenir au canevas" }).click();

  // Les diagnostics sont affichés et l'envoi est bloqué, sans requête de révision.
  const problem = bottom(page).getByRole("listitem").filter({ hasText: "ERREUR" });
  await expect(problem).toHaveCount(1);
  await expect(problem).toContainText("n02");
  await expect(page.getByRole("button", { name: "Envoyer la révision" })).toHaveAttribute("aria-disabled", "true");
  // aria-disabled : le bouton reste cliquable pour expliquer le blocage, d'où `force`.
  await page.getByRole("button", { name: "Envoyer la révision" }).click({ force: true });
  await expect(page.getByRole("alert")).toContainText("Soumission bloquée : 1 erreur à corriger");
  await expect(page.getByRole("dialog", { name: "Envoyer la révision" })).toHaveCount(0);
  expect(await seriousViolations(page)).toEqual([]);
  expect(posted).toEqual([]);

  // Le serveur refuse le même document, diagnostics à l'appui, avant toute poussée.
  const refused = await request.post(`${JULIEN}/api/workspaces/${ws.id}/proposals/3/revisions`, { data: { document_yaml: invalid, note: "" } });
  expect(refused.status()).toBe(422);
  const detail = (await refused.json()).detail as { code: string; issues?: { severity: string; node_id: string | null }[] };
  expect(detail.code).toBe("invalid_document");
  expect(detail.issues).toContainEqual(expect.objectContaining({ severity: "error", node_id: "n02" }));
  expect(remoteHead(ws, before.branch)).toBe(before.head);

  // La proposition n'a pas bougé : toujours une seule révision dans le fil.
  await openProposal(page, ws.root, 3);
  await expect(threadItem(page, "a envoyé la révision")).toHaveCount(1);
  await expect(threadItem(page, "a envoyé la révision 1")).toHaveCount(1);
  await expect(threadItem(page, "Marc D. a approuvé")).not.toContainText("dépassée");
});

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { API } from "./demo";
import { git, isolatedDemo, relay, python, AUTH_API, test } from "./isolation";

const CLAIRE = "http://127.0.0.1:8798";
const MARC = "http://127.0.0.1:8797";
const entry = (page: Page, title: string) => page.getByRole("list", { name: "File des propositions" }).getByRole("link").filter({ hasText: title });
async function joinReviewer(request: APIRequestContext, remote: string, server: string) {
  expect((await request.post(`${server}/api/workspaces/join`, { data: { remote_url: remote } })).status()).toBe(201);
}


/** Synchronise l'espace ; en cas d'échec, le message dit pourquoi. */
async function sync(request: APIRequestContext, api: string) {
  const response = await request.post(`${api}/sync`);
  expect(response.ok(), `sync : ${response.status()} ${await response.text()}`).toBe(true);
}

test("[S-0006-01] Canonique, hors points et from scratch demandent deux validations ; point déclaré une", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  const text = readFileSync(join(ws.work, "variants/revenu-net/nordis-fr.yaml"), "utf8").replace("TVA française à 20 %.", "TVA française, taux normal.");
  const created = await request.post(`${ws.api}/proposals`, { data: { document_yaml: text, justification: "Surcharge déclarée uniquement", base_version: 2 } });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  await page.goto(`${ws.root}/propositions`);
  await expect(entry(page, "Revenu net · canonique v5")).toContainText("Validations : 1 / 2");
  await expect(entry(page, "Revenu net · nordis-de")).toContainText("Validations : 0 / 2 (canonique requis)");
  await expect(entry(page, "Revenu net · nordis-es")).toContainText("Validations : 1 / 2 (canonique requis)");
  await expect(page.getByRole("list", { name: "File des propositions" }).locator(`a[href$="/propositions?n=${id}"]`)).toContainText("Validations : 0 / 1");
});

test("[S-0006-02] Auteur, contributeur et validateur hors domaine ne font pas monter le compteur", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await page.goto(`${ws.root}/propositions`);
  // La démonstration : marc.d, validateur Finance, a approuvé la v5 canonique.
  await expect(entry(page, "Revenu net · canonique v5")).toContainText("Validations : 1 / 2");
  python(`import sys,yaml
from pathlib import Path
p=Path(sys.argv[1])/'governance.yaml'; d=yaml.safe_load(p.read_text())
finance=next(x for x in d['domains'] if x['id']=='finance'); finance['validators'].remove('marc.d')
next(m for m in d['members'] if m['account']=='marc.d')['roles']=[{'role':'validateur','domains':['supply']}]
p.write_text(yaml.safe_dump(d,allow_unicode=True,sort_keys=False))`, ws.work);
  git(ws.work, "add", "."); git(ws.work, "commit", "-qm", "Marc valide Supply uniquement"); git(ws.work, "push", "origin", "main");
  await sync(request, ws.api);
  // Validateur Supply seulement, son approbation de la v5 Finance ne compte plus.
  await page.reload();
  await expect(entry(page, "Revenu net · canonique v5")).toContainText("Validations : 0 / 2");
  await expect(entry(page, "Revenu net · nordis-de")).toContainText("Validations : 0 / 2");
  // anna.k : autrice de n° 5, son approbation est refusée (S-0014-04) ; simple contributrice
  // sur n° 3, son approbation est enregistrée mais ne compte pas.
  const own = await request.post(`${ws.api}/proposals/5/reviews`, { data: { event: "approve" } });
  expect(own.status()).toBe(422);
  expect(await own.json()).toMatchObject({ detail: { code: "cannot_review_own" } });
  expect((await request.post(`${ws.api}/proposals/3/reviews`, { data: { event: "approve" } })).status()).toBe(200);
  // marc.d, validateur Supply, approuve la surcharge DE (domaine Finance) : enregistrée, non comptée.
  await joinReviewer(request, ws.remote, MARC);
  expect((await request.post(`${MARC}/api/workspaces/${ws.id}/proposals/5/reviews`, { data: { event: "approve" } })).ok()).toBe(true);
  await page.reload();
  await expect(entry(page, "Revenu net · nordis-de")).toContainText("Validations : 0 / 2");
  await expect(entry(page, "Revenu net · canonique v5")).toContainText("Validations : 0 / 2");
});

test("[S-0006-03] Un commit après approbation remet le compteur à zéro", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await joinReviewer(request, ws.remote, CLAIRE);
  expect((await request.post(`${CLAIRE}/api/workspaces/${ws.id}/proposals/5/reviews`, { data: { event: "approve" } })).ok()).toBe(true);
  await page.goto(`${ws.root}/propositions`);
  await expect(entry(page, "Revenu net · nordis-de")).toContainText("Validations : 1 / 2");
  const detail = await (await request.get(`${ws.api}/proposals/5`)).json();
  git(ws.work, "fetch", "origin", detail.branch); git(ws.work, "checkout", "-b", "reprise", "FETCH_HEAD");
  const path = join(ws.work, "variants/revenu-net/nordis-de.yaml");
  writeFileSync(path, readFileSync(path, "utf8") + "\n# Reprise après revue\n");
  git(ws.work, "add", "."); git(ws.work, "commit", "-qm", "Reprise"); git(ws.work, "push", "origin", `HEAD:${detail.branch}`);
  await page.reload();
  await expect(entry(page, "Revenu net · nordis-de")).toContainText("Validations : 0 / 2");
  await entry(page, "Revenu net · nordis-de").click();
  await expect(page.getByRole("button", { name: "Fusionner" })).toHaveCount(0);
});

test("[S-0006-05] Une base avancée refuse la fusion approuvée", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  for (const server of [CLAIRE, MARC]) {
    await joinReviewer(request, ws.remote, server);
    expect((await request.post(`${server}/api/workspaces/${ws.id}/proposals/5/reviews`, { data: { event: "approve" } })).ok()).toBe(true);
  }
  await relay(page, CLAIRE); await page.goto(`${ws.root}/propositions?n=5&status=open&domain=tous`);
  await expect(entry(page, "Revenu net · nordis-de")).toContainText("Validations : 2 / 2");
  const path = join(ws.work, "variants/revenu-net/nordis-de.yaml");
  writeFileSync(path, readFileSync(path, "utf8").replace("version: 3\n", "version: 4\n"));
  git(ws.work, "add", "."); git(ws.work, "commit", "-qm", "Base DE avancée"); git(ws.work, "push", "origin", "main");
  const head = git(ws.remote, "rev-parse", "main");
  const response = page.waitForResponse(r => r.url().endsWith("/proposals/5/merge") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Fusionner", exact: true }).click();
  expect((await response).status()).toBe(409);
  expect(await (await response).json()).toMatchObject({ detail: { code: "stale_base" } });
  // La surcharge hors points déclarés a déjà son bandeau d'alerte : on vise celui de l'erreur.
  await expect(page.getByRole("alert").filter({ hasText: "a changé depuis la proposition" })).toBeVisible();
  expect(git(ws.remote, "rev-parse", "main")).toBe(head);
});

test("[S-0006-12] Seul habilité : mention à l'écran, fusion, trailer et retrait de l'exception", async ({ page, request }) => {
  const ws = await isolatedDemo(request, AUTH_API);
  python(`import sys,yaml
from pathlib import Path
p=Path(sys.argv[1])/'governance.yaml'; d=yaml.safe_load(p.read_text())
d['members']=[m for m in d['members'] if m['account']=='julien.h']
for domain in d['domains']: domain['referents']=[]; domain['validators']=[]
p.write_text(yaml.safe_dump(d,allow_unicode=True,sort_keys=False))`, ws.work);
  git(ws.work, "add", "."); git(ws.work, "commit", "-qm", "Un seul habilité"); git(ws.work, "push", "origin", "main");
  await sync(request, ws.api);
  const text = readFileSync(join(ws.work, "kpis/revenu-net.yaml"), "utf8").replace("label: Revenu net", "label: Revenu net solo");
  const created = await request.post(`${ws.api}/proposals`, { data: { document_yaml: text, justification: "Révision seul", base_version: 4 } });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  await relay(page, AUTH_API); await page.goto(`${ws.root}/propositions?n=${id}&status=open&domain=tous`);
  await expect(page.getByRole("region", { name: "Proposition sélectionnée" })).toContainText("Fusionnée sans revue : aucun autre compte habilité");
  await page.getByRole("button", { name: "Fusionner", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: `Proposition n° ${id} fusionnée` })).toBeVisible();
  expect(git(ws.remote, "log", "-1", "--format=%B", "main")).toContain("Atlas-Review: none (no other eligible approver)");
  git(ws.work, "pull", "--ff-only");
  python(`import sys,yaml
from pathlib import Path
p=Path(sys.argv[1])/'governance.yaml'; d=yaml.safe_load(p.read_text())
d['members'].append({'account':'claire.m','name':'Claire M.','roles':[{'role':'validateur','domains':['finance']}]})
p.write_text(yaml.safe_dump(d,allow_unicode=True,sort_keys=False))`, ws.work);
  git(ws.work, "add", "."); git(ws.work, "commit", "-qm", "Deuxième habilitée"); git(ws.work, "push", "origin", "main");
  await sync(request, ws.api);
  const second = await request.post(`${ws.api}/proposals`, { data: { document_yaml: readFileSync(join(ws.work, "kpis/revenu-net.yaml"), "utf8").replace("Revenu net solo", "Revenu net avec revue"), justification: "Nouvelle revue", base_version: 5 } });
  expect(second.status()).toBe(201);
  const next = await second.json();
  // Seul le hash change : recharger pour que la file relise la proposition créée par l'API.
  await page.goto(`${ws.root}/propositions?n=${next.id}&status=open&domain=tous`);
  await page.reload();
  const reviewed = entry(page, "Revenu net avec revue");
  await expect(reviewed).toHaveAttribute("aria-current", "true");
  await expect(reviewed).toContainText("Validations : 0 / 2");
  await expect(page.getByRole("region", { name: "Proposition sélectionnée" })).not.toContainText("Fusionnée sans revue");
  await expect(page.getByRole("button", { name: "Fusionner", exact: true })).toHaveCount(0);
});

test("[S-0014-08] Un refus de fusion dit ce qui s'est passé et quoi faire, sans la sortie de git ni de GitHub", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  for (const server of [CLAIRE, MARC]) {
    await joinReviewer(request, ws.remote, server);
    expect((await request.post(`${server}/api/workspaces/${ws.id}/proposals/5/reviews`, { data: { event: "approve" } })).ok()).toBe(true);
  }
  await relay(page, CLAIRE);
  await page.goto(`${ws.root}/propositions?n=5&status=open&domain=tous`);
  await expect(entry(page, "Revenu net · nordis-de")).toContainText("Validations : 2 / 2");
  const selection = page.getByRole("region", { name: "Proposition sélectionnée" });
  const merge = page.getByRole("button", { name: "Fusionner", exact: true });
  const refusal = (title: string) => selection.getByRole("alert").filter({ hasText: title });

  // Réponse de GitHub à une fusion en conflit : le serveur la relaie telle quelle.
  const raw = "GitHub a répondu 405 : Pull Request is not mergeable";
  await page.route("**/proposals/5/merge", (route) => route.fulfill({ status: 409, json: { detail: { code: "merge_conflict", message: raw } } }), { times: 1 });
  await merge.click();
  await expect(refusal("La fusion provoque un conflit")).toContainText("demandez à l'auteur de la reproposer à partir de la version courante");
  await expect(refusal("La fusion provoque un conflit")).not.toContainText("not mergeable");
  await expect(page.getByText("L'opération a échoué")).toHaveCount(0);

  // Un commit arrive sur la branche après l'affichage : le décompte tombe à zéro, la fusion est refusée.
  const detail = await (await request.get(`${ws.api}/proposals/5`)).json();
  git(ws.work, "fetch", "origin", detail.branch); git(ws.work, "checkout", "-b", "reprise", "FETCH_HEAD");
  const path = join(ws.work, "variants/revenu-net/nordis-de.yaml");
  writeFileSync(path, readFileSync(path, "utf8") + "\n# Reprise après revue\n");
  git(ws.work, "add", "."); git(ws.work, "commit", "-qm", "Reprise"); git(ws.work, "push", "origin", `HEAD:${detail.branch}`);
  const head = git(ws.remote, "rev-parse", "main");
  const response = page.waitForResponse((r) => r.url().endsWith("/proposals/5/merge") && r.request().method() === "POST");
  await merge.click();
  expect((await response).status()).toBe(409);
  expect(await (await response).json()).toMatchObject({ detail: { code: "not_ready" } });
  await expect(refusal("La proposition ne remplit plus les conditions de fusion")).toContainText("0 validation(s) sur 2.");
  await expect(refusal("La proposition ne remplit plus les conditions de fusion")).toContainText("L'écran vient d'être relu");
  // L'écran s'est relu sans perdre le message : plus de « Fusionner », le décompte est à zéro.
  await expect(entry(page, "Revenu net · nordis-de")).toContainText("Validations : 0 / 2");
  await expect(merge).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Approuver (0 / 2)" })).toBeVisible();
  expect(git(ws.remote, "rev-parse", "main")).toBe(head);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("[S-0014-09] Changer de statut affiche le chargement, pas la file de l'ancien statut, même si la requête échoue", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await page.goto(`${ws.root}/propositions`);
  await expect(entry(page, "Revenu net · nordis-de")).toHaveCount(1);
  const list = page.getByRole("list", { name: "File des propositions" });
  const status = page.getByRole("combobox", { name: "Statut" });
  const queueFor = (value: string) => (url: URL) => url.pathname.endsWith("/proposals/queue") && url.searchParams.get("status") === value;

  // Les fusionnées tardent : la file ouverte disparaît le temps de la réponse.
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route(queueFor("merged"), async (route) => { await gate; await route.continue(); });
  await status.selectOption("merged");
  await expect(status).toHaveValue("merged");
  await expect(page.getByText("Chargement des propositions…")).toBeVisible();
  await expect(list).toHaveCount(0);
  release();
  await expect(page.getByText("Chargement des propositions…")).toHaveCount(0);
  await expect(entry(page, "Revenu net · nordis-de")).toHaveCount(0);

  // Les fermées échouent (serveur injoignable) : jamais la file des fusionnées sous « Fermées ».
  await page.route(queueFor("closed"), (route) => route.abort("connectionrefused"));
  await status.selectOption("closed");
  await expect(status).toHaveValue("closed");
  await expect(page.getByText("Chargement des propositions…")).toBeVisible();
  await expect(list).toHaveCount(0);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});


test("[S-0006-05] Une base avancée refuse aussi la création de la proposition : alerte nette, rien n'est poussé, le brouillon reste", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await page.goto(`${ws.root}/editeur?from=revenu-net--nordis-de`);
  await expect(page.getByRole("heading", { level: 1, name: /nordis-de.*brouillon/i })).toBeVisible();
  // La variante surcharge déjà n02 : on précise la justification de cette surcharge.
  const props = page.getByRole("complementary", { name: "Propriétés" });
  await page.locator('[data-node-id="n02"]').click();
  await props.getByLabel(/Justification de la surcharge/).fill("Expédiées comprises.");
  await expect.poll(async () => JSON.stringify((await (await request.get(`${ws.api}/editor/documents/revenu-net--nordis-de`)).json()).draft?.document?.overrides ?? null)).toContain("Expédiées comprises.");

  // Pendant ce temps, la base DE passe à la version suivante sur la branche principale.
  const path = join(ws.work, "variants/revenu-net/nordis-de.yaml");
  writeFileSync(path, readFileSync(path, "utf8").replace("version: 3\n", "version: 4\n"));
  git(ws.work, "add", "."); git(ws.work, "commit", "-qm", "Base DE avancée"); git(ws.work, "push", "origin", "main");
  const head = git(ws.remote, "rev-parse", "main");
  const branches = git(ws.remote, "for-each-ref", "refs/heads");

  await page.getByRole("button", { name: "Soumettre la proposition" }).click();
  const dialog = page.getByRole("dialog", { name: "Soumettre la proposition" });
  await dialog.getByLabel(/Justification/).fill("Soumise sur une base périmée.");
  const response = page.waitForResponse(r => r.url().endsWith("/proposals") && r.request().method() === "POST");
  await dialog.getByRole("button", { name: "Soumettre" }).click();
  const answered = await response;
  expect(answered.status()).toBe(409);
  expect(await answered.json()).toMatchObject({ detail: { code: "stale_base" } });
  await expect(page.getByRole("alert").filter({ hasText: /n'est plus la version courante/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Proposition n° \d+ créée/ })).toHaveCount(0);
  // Rien n'a été publié, et le travail de l'auteur est encore là.
  expect(git(ws.remote, "rev-parse", "main")).toBe(head);
  expect(git(ws.remote, "for-each-ref", "refs/heads")).toBe(branches);
  const draft = await (await request.get(`${ws.api}/editor/documents/revenu-net--nordis-de`)).json();
  expect(JSON.stringify(draft.draft.document.overrides)).toContain("Expédiées comprises.");
});

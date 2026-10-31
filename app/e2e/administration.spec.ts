import { expect, test, type Page } from "@playwright/test";
import { git, isolatedDemo, python } from "./isolation";
import { API, demoRemote, ensureNordis, seriousViolations } from "./demo";

// Plan 0017 de bout en bout : julien.h, seul référent de Groupe Nordis, sur son propre
// serveur et son propre dépôt de démonstration. Ses fusions de gouvernance ne touchent
// donc pas l'espace des autres scénarios.
test.describe.configure({ mode: "serial" });

const JULIEN = "http://127.0.0.1:8795";
const ADMIN = "/#/w/groupe-nordis/administration";

test.beforeAll(async ({ request }) => {
  const listed = (await (await request.get(`${JULIEN}/api/workspaces`)).json()) as { id: string }[];
  if (listed.some((ws) => ws.id === "groupe-nordis")) return;
  const joined = await request.post(`${JULIEN}/api/workspaces/join`, { data: { remote_url: demoRemote() } });
  if (!joined.ok()) throw new Error(await joined.text());
});

/** L'app parle au serveur de julien.h : ses requêtes sont relayées vers son port. */
async function asJulien(page: Page) {
  await page.route(`${API}/**`, async (route) => {
    const response = await route.fetch({ url: route.request().url().replace(API, JULIEN) });
    await route.fulfill({ response });
  });
}

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" }); // relevés de la coque encore en vol
});

const domains = (page: Page) => page.getByRole("region", { name: "Domaines métier" });
const save = (page: Page) => page.getByRole("button", { name: /^Enregistrer et/ });

test("[S-0017-02] [S-0017-03] [S-0017-06] [S-0017-08] référent seul : bandeau, domaine sans référent, enregistrement fusionné (critères 2, 3, 6 et 8)", async ({ page }) => {
  await asJulien(page);
  await page.goto(ADMIN);
  await expect(page.getByRole("heading", { level: 1, name: "Administration — Groupe Nordis" })).toBeVisible();
  await expect(page.getByText("Vous êtes le seul référent de l'espace")).toBeVisible();
  await expect(domains(page).getByText(/^Aucun référent · \d+ KPI$/)).toHaveCount(1); // Marketing
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(save(page)).toHaveText("Enregistrer et fusionner");
  expect(await seriousViolations(page)).toEqual([]);

  const canonical = page.getByRole("spinbutton", { name: "Canonique (min 1)" });
  await canonical.fill("0");
  await expect(page.getByText("Au moins 1.")).toBeVisible();
  await expect(save(page)).toBeDisabled();
  await canonical.fill("3");

  await page.getByRole("button", { name: "Domaine", exact: true }).click();
  const form = page.getByRole("group", { name: "Nouveau domaine" });
  await form.getByRole("textbox", { name: /Libellé/ }).fill("Data");
  await expect(form.getByRole("textbox", { name: /Identifiant/ })).toHaveValue("data");
  await form.getByRole("button", { name: "Ajouter le domaine" }).click();
  await expect(domains(page).getByText(/^Aucun référent/)).toHaveCount(2);
  expect(await seriousViolations(page)).toEqual([]);

  await save(page).click();
  await expect(page.getByText(/Paramètres enregistrés : proposition n° \d+ fusionnée sans revue\./)).toBeVisible();
  // Relu sur la branche principale : le domaine est là, et le formulaire n'a plus rien à enregistrer.
  await expect(domains(page).getByText("Data", { exact: true })).toBeVisible();
  await expect(canonical).toHaveValue("3");
  await expect(save(page)).toBeDisabled();
});

test("[S-0017-08] deuxième référent : le bandeau disparaît, la suite passe par une revue (critère 8)", async ({ page }) => {
  await asJulien(page);
  await page.goto(ADMIN);
  await page.getByRole("button", { name: "Modifier Claire M." }).click();
  const form = page.getByRole("group", { name: "Membre Claire M." });
  await form.getByRole("combobox", { name: "Rôle" }).selectOption("referent");
  await form.getByRole("checkbox", { name: "Finance" }).uncheck(); // aucun domaine : tout l'espace
  await form.getByRole("button", { name: "Appliquer" }).click();
  await save(page).click();
  await expect(page.getByText(/fusionnée sans revue/)).toBeVisible();

  await expect(page.getByText("Vous êtes le seul référent de l'espace")).toHaveCount(0);
  await expect(page.getByText(/Require review from Code Owners/)).toBeVisible();
  await page.getByRole("checkbox", { name: "BigQuery" }).check();
  await expect(save(page)).toHaveText("Enregistrer et créer la proposition");
  await save(page).click();
  await expect(page.getByText(/Proposition n° \d+ ouverte : elle attend la revue d'un autre référent\./)).toBeVisible();
  await page.getByRole("link", { name: "Voir la proposition" }).click();
  await expect(page).toHaveURL(/#\/w\/groupe-nordis\/propositions\?n=\d+&status=open&domain=tous$/);
  await expect(page.getByRole("heading", { name: /Gouvernance de l'espace/ }).first()).toBeVisible();
});

test("[S-0017-07] Synchroniser met à jour la date et l'index (critère 7)", async ({ page }) => {
  await asJulien(page);
  await page.goto(ADMIN);
  const repository = page.getByRole("region", { name: "Dépôt Git de l'espace" });
  await repository.getByRole("button", { name: "Synchroniser" }).click();
  await expect(repository.getByRole("status")).toHaveText(/Synchronisé · index reconstruit\.|Déjà à jour avec le dépôt distant\./);
  await expect(repository.getByText(/^à l'instant · index à jour$/)).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});

async function saveAndWait(page: Page) {
  const response = page.waitForResponse(r => r.url().endsWith("/admin/governance") && r.request().method() === "POST");
  await save(page).click();
  expect((await response).status()).toBe(201);
  await expect(save(page)).toBeDisabled();
}

test("[S-0017-01] Anna n'a ni lien d'administration ni accès à l'écran ou à l'API", async ({ page, request }) => {
  await ensureNordis(request);
  await page.goto("/#/w/groupe-nordis/catalogue");
  await expect(page.getByRole("navigation", { name: "Navigation de l'espace" }).getByRole("link", { name: "Administration" })).toHaveCount(0);
  expect((await request.get(`${API}/api/workspaces/groupe-nordis/admin`)).status()).toBe(403);
  await page.goto(ADMIN);
  await expect(page).toHaveURL(/#\/w\/groupe-nordis\/catalogue$/);
  await expect(page.getByRole("heading", { level: 1, name: "Catalogue" })).toBeVisible();
  await expect(save(page)).toHaveCount(0);
});

test("[S-0017-04] [S-0017-05] Renommer un domaine ne change que son libellé ; proposition limitée à la gouvernance", async ({ page, request }) => {
  const ws = await isolatedDemo(request, JULIEN);
  await asJulien(page);
  const before = await (await request.get(`${ws.api}/admin`)).json();
  const commit = git(ws.remote, "rev-parse", "main");
  await page.goto(`${ws.root}/administration`);
  await page.getByRole("button", { name: "Modifier le domaine Supply chain" }).click();
  await page.getByRole("group", { name: "Domaine Supply chain" }).getByLabel(/^Libellé/).fill("Approvisionnement");
  await page.getByRole("group", { name: "Domaine Supply chain" }).getByRole("button", { name: "Appliquer" }).click();
  await saveAndWait(page);
  await expect(page.getByText(/Paramètres enregistrés : proposition n° \d+ fusionnée/)).toBeVisible();
  const after = await (await request.get(`${ws.api}/admin`)).json();
  const expected = structuredClone(before.governance);
  expected.domains.find((d: { id: string }) => d.id === "supply").label = "Approvisionnement";
  expect(after.governance).toEqual(expected);
  // Le dépôt de démonstration n'a pas de CODEOWNERS : la première proposition de
  // gouvernance le génère, dans le même commit que governance.yaml, et rien d'autre.
  expect(git(ws.remote, "diff", "--name-only", commit, "main").split("\n")).toEqual([".github/CODEOWNERS", "governance.yaml"]);
  // CODEOWNERS ne dépend que des validateurs et référents : un domaine sans référent le
  // régénère à l'identique, seul governance.yaml change.
  const next = git(ws.remote, "rev-parse", "main");
  await page.getByRole("button", { name: "Domaine", exact: true }).click();
  const form = page.getByRole("group", { name: "Nouveau domaine" });
  await form.getByLabel(/^Libellé/).fill(`Domaine ${Date.now().toString(36)}`);
  await form.getByRole("button", { name: "Ajouter le domaine" }).click();
  await saveAndWait(page);
  await expect(save(page)).toBeDisabled();
  expect(git(ws.remote, "diff", "--name-only", next, "main").split("\n")).toEqual(["governance.yaml"]);
});

test("[S-0023-01] [S-0023-02] [S-0023-03] [S-0023-04] Retraits et rôles multiples conservés après enregistrement", async ({ page, request }) => {
  const ws = await isolatedDemo(request, JULIEN);
  await asJulien(page);
  await page.goto(`${ws.root}/administration`);
  await page.getByRole("button", { name: "Modifier Julien H.", exact: true }).click();
  const julien = page.getByRole("group", { name: "Membre Julien H." });
  await expect(julien.getByRole("button", { name: "Retirer de l'espace" })).toBeDisabled();
  await julien.getByRole("button", { name: "Annuler", exact: true }).click();
  await page.getByRole("button", { name: "Modifier le domaine Finance" }).click();
  const finance = page.getByRole("group", { name: "Domaine Finance" });
  await expect(finance.getByRole("button", { name: "Retirer le domaine" })).toBeDisabled();
  await finance.getByRole("button", { name: "Annuler", exact: true }).click();
  const initial = await (await request.get(`${ws.api}/admin`)).json();
  const forbidden = structuredClone(initial.governance);
  forbidden.domains = forbidden.domains.filter((d: { id: string }) => d.id !== "finance");
  expect((await request.post(`${ws.api}/admin/governance`, { data: { governance: forbidden, base_digest: initial.base_digest } })).ok()).toBe(false);

  await page.getByRole("button", { name: "Modifier Anna K.", exact: true }).click();
  const anna = page.getByRole("group", { name: "Membre Anna K." });
  await anna.getByRole("button", { name: "+ Ajouter un rôle", exact: true }).click();
  await anna.getByRole("combobox", { name: "Rôle 2", exact: true }).selectOption("validateur");
  await anna.getByRole("group", { name: "Rôle 2", exact: true }).getByRole("checkbox", { name: "Marketing", exact: true }).check();
  await anna.getByRole("button", { name: "Appliquer", exact: true }).click();
  await saveAndWait(page);
  await expect(save(page)).toBeDisabled();
  await page.reload();
  await page.getByRole("button", { name: "Modifier Anna K.", exact: true }).click();
  await expect(anna.getByRole("combobox", { name: "Rôle 1", exact: true })).toHaveValue("contributeur");
  await expect(anna.getByRole("combobox", { name: "Rôle 2", exact: true })).toHaveValue("validateur");
  await anna.getByRole("button", { name: "Annuler", exact: true }).click();
  // Marketing ne porte aucun document ; le rôle qui s'y limite doit disparaître.
  await page.getByRole("button", { name: "Modifier le domaine Marketing" }).click();
  await page.getByRole("group", { name: "Domaine Marketing" }).getByRole("button", { name: "Retirer le domaine" }).click();
  await saveAndWait(page);
  await expect(save(page)).toBeDisabled();
  const withoutDomain = await (await request.get(`${ws.api}/admin`)).json();
  expect(withoutDomain.governance.domains.some((d: { id: string }) => d.id === "marketing")).toBe(false);
  expect(withoutDomain.governance.members.find((m: { account: string }) => m.account === "anna.k").roles).toEqual(
    initial.governance.members.find((m: { account: string }) => m.account === "anna.k").roles);
  await page.getByRole("button", { name: "Modifier Claire M.", exact: true }).click();
  await page.getByRole("group", { name: "Membre Claire M." }).getByRole("button", { name: "Retirer de l'espace" }).click();
  await saveAndWait(page);
  await expect(save(page)).toBeDisabled();
  await page.reload();
  await expect(page.getByRole("button", { name: "Modifier Claire M.", exact: true })).toHaveCount(0);
  const final = await (await request.get(`${ws.api}/admin`)).json();
  expect(JSON.stringify(final.governance)).not.toContain("claire.m");
  expect(git(ws.remote, "show", "main:governance.yaml")).not.toContain("claire.m");
});

test("[S-0020-01] [S-0020-02] [S-0020-04] Fusion hors Atlas, synchronisation, tag et nouvelle version dans la fiche", async ({ page, request }) => {
  const ws = await isolatedDemo(request, JULIEN);
  git(ws.work, "checkout", "-b", "version-externe");
  python("from pathlib import Path; import sys; p=Path(sys.argv[1])/'kpis/revenu-net.yaml'; p.write_text(p.read_text().replace('version: 4\\n','version: 5\\n',1))", ws.work);
  git(ws.work, "add", "kpis/revenu-net.yaml");
  git(ws.work, "commit", "-qm", "Revenu net v5 hors Atlas");
  git(ws.work, "checkout", "main");
  git(ws.work, "merge", "--no-ff", "version-externe", "-m", "Fusion hors Atlas");
  const merge = git(ws.work, "rev-parse", "HEAD");
  git(ws.work, "push", "origin", "main");
  await asJulien(page);
  await page.goto(`${ws.root}/administration`);
  await page.getByRole("button", { name: "Synchroniser", exact: true }).click();
  await expect(page.getByRole("region", { name: "Dépôt Git de l'espace" }).getByRole("status")).toContainText("taguée au sync");
  expect(git(ws.remote, "rev-parse", "doc/revenu-net/v5^{}")).toBe(merge);
  await page.goto(`${ws.root}/fiche/revenu-net`);
  await expect(page.getByText(/^v5 · validée/)).toBeVisible();
  await page.getByRole("link", { name: "Versions 5", exact: true }).click();
  await expect(page.getByRole("table").getByRole("row").nth(1)).toContainText("v5 · courante");
  const tags = git(ws.remote, "tag", "--list");
  await page.goto(`${ws.root}/administration`);
  await page.getByRole("button", { name: "Synchroniser", exact: true }).click();
  await expect(page.getByText("Déjà à jour avec le dépôt distant.", { exact: true })).toBeVisible();
  expect(git(ws.remote, "tag", "--list")).toBe(tags);
});

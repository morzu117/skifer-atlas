import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { API, seriousViolations } from "./demo";
import { git, isolatedDemo, relay, test } from "./isolation";

// Plans 0017 et 0023 : les états de l'écran Administration que le parcours nominal
// (administration.spec.ts) ne provoque pas : base périmée, invitation d'un membre, accès
// d'un référent de domaine, consignes des formulaires de retrait. Chaque test travaille
// sur sa propre copie de l'espace de démonstration, sur le serveur de julien.h, seul
// référent de l'espace au départ.

const JULIEN = "http://127.0.0.1:8795";
const CLAIRE = "http://127.0.0.1:8798";

const save = (page: Page) => page.getByRole("button", { name: /^Enregistrer et/ });

test("[S-0017-11] une gouvernance modifiée ailleurs refuse l'enregistrement et « Relire les paramètres » efface le brouillon", async ({ page, request }) => {
  const ws = await isolatedDemo(request, JULIEN);
  await relay(page, JULIEN);
  await page.goto(`${ws.root}/administration`);
  const bigquery = page.getByRole("checkbox", { name: "BigQuery" });
  await bigquery.check();
  await expect(save(page)).toBeEnabled();

  // Pendant ce temps, quelqu'un pousse un autre changement de governance.yaml.
  const file = join(ws.work, "governance.yaml");
  writeFileSync(file, readFileSync(file, "utf8").replace("label: Marketing", "label: Marketing et communication"));
  git(ws.work, "add", "."); git(ws.work, "commit", "-qm", "Domaine renommé ailleurs"); git(ws.work, "push", "origin", "main");
  expect((await request.post(`${ws.api}/sync`)).ok()).toBe(true);
  const head = git(ws.remote, "rev-parse", "main");

  await save(page).click();
  const failure = page.getByRole("alert").filter({ has: page.getByRole("button", { name: "Relire les paramètres" }) });
  await expect(failure).toBeVisible();
  await expect(failure).not.toContainText(/Traceback|"detail"|stale_base/);
  await expect(page.getByText(/Paramètres enregistrés|Proposition n° \d+ ouverte/)).toHaveCount(0);
  expect(git(ws.remote, "rev-parse", "main")).toBe(head); // rien n'a été publié
  expect(await seriousViolations(page)).toEqual([]);

  await failure.getByRole("button", { name: "Relire les paramètres" }).click();
  await expect(failure).toHaveCount(0);
  await expect(bigquery).not.toBeChecked(); // le brouillon est abandonné
  await expect(page.getByRole("region", { name: "Domaines métier" })).toContainText("Marketing et communication");
  await expect(save(page)).toBeDisabled();
});

test("[S-0017-12] inviter un membre : compte refusé s'il est mal formé ou déjà membre, puis ajouté à governance.yaml", async ({ page, request }) => {
  const ws = await isolatedDemo(request, JULIEN);
  await relay(page, JULIEN);
  await page.goto(`${ws.root}/administration`);
  await page.getByRole("button", { name: "Inviter" }).click();
  const form = page.getByRole("group", { name: "Nouveau membre" });
  await form.getByLabel(/^Nom/).fill("Léa M.");
  await expect(form.getByText("Atlas ajoute la personne à governance.yaml ; l'accès au dépôt se donne sur l'hébergeur.")).toBeVisible();

  await form.getByLabel("Compte sur l'hébergeur Git").fill("léa m");
  await form.getByRole("button", { name: "Ajouter le membre" }).click();
  await expect(form.getByLabel("Compte sur l'hébergeur Git")).toHaveAccessibleDescription(/Le compte de la personne sur l'hébergeur \(lettres, chiffres, \. _ -\)\./);
  await form.getByLabel("Compte sur l'hébergeur Git").fill("anna.k");
  await form.getByRole("button", { name: "Ajouter le membre" }).click();
  await expect(form.getByLabel("Compte sur l'hébergeur Git")).toHaveAccessibleDescription(/Ce compte est déjà membre de l'espace\./);
  expect(await seriousViolations(page)).toEqual([]);

  await form.getByLabel("Compte sur l'hébergeur Git").fill("lea.m");
  await form.getByRole("button", { name: "Ajouter le membre" }).click();
  await expect(page.getByRole("button", { name: "Modifier Léa M.", exact: true })).toBeVisible();
  await save(page).click();
  await expect(page.getByText(/Paramètres enregistrés : proposition n° \d+ fusionnée sans revue\./)).toBeVisible();
  await expect(page.getByRole("button", { name: "Modifier Léa M.", exact: true })).toBeVisible();
  expect(git(ws.remote, "show", "main:governance.yaml")).toContain("account: lea.m");
  const admin = await (await request.get(`${ws.api}/admin`)).json();
  expect(admin.governance.members.find((m: { account: string }) => m.account === "lea.m")).toMatchObject({ name: "Léa M.", roles: [{ role: "contributeur", domains: [] }] });
});

test("[S-0017-13] une référente de domaine n'a ni lien d'administration, ni accès à l'écran, ni à l'API", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  expect((await request.post(`${CLAIRE}/api/workspaces/join`, { data: { remote_url: ws.remote } })).status()).toBe(201);
  await relay(page, CLAIRE);
  await page.goto(`${ws.root}/catalogue`);
  await expect(page.getByRole("heading", { level: 1, name: "Catalogue" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Navigation de l'espace" }).getByRole("link", { name: "Administration" })).toHaveCount(0);
  expect((await request.get(`${CLAIRE}/api/workspaces/${ws.id}/admin`)).status()).toBe(403);
  await page.goto(`${ws.root}/administration`);
  await expect(page).toHaveURL(new RegExp(`#/w/${ws.id}/catalogue$`));
  await expect(page.getByRole("heading", { level: 1, name: "Catalogue" })).toBeVisible();
  await expect(save(page)).toHaveCount(0);
  await page.goto("about:blank"); // plus de requête vers l'espace que l'isolation va retirer
});

test("[S-0023-05] les formulaires de retrait disent pourquoi un retrait est impossible ou ce qu'il entraîne", async ({ page, request }) => {
  const ws = await isolatedDemo(request, JULIEN);
  await relay(page, JULIEN);
  await page.goto(`${ws.root}/administration`);

  // Seul référent : retrait désactivé, avec la consigne.
  await page.getByRole("button", { name: "Modifier Julien H.", exact: true }).click();
  const julien = page.getByRole("group", { name: "Membre Julien H." });
  await expect(julien.getByRole("button", { name: "Retirer de l'espace" })).toBeDisabled();
  await expect(julien).toContainText("Seul référent de l'espace : nommez-en un autre avant de le retirer.");
  await julien.getByRole("button", { name: "Annuler", exact: true }).click();

  // Un domaine qui porte des documents ne se retire pas.
  await page.getByRole("button", { name: "Modifier le domaine Finance" }).click();
  const finance = page.getByRole("group", { name: "Domaine Finance" });
  await expect(finance.getByRole("button", { name: "Retirer le domaine" })).toBeDisabled();
  await expect(finance).toContainText(/\d+ documents? rattachés? : les rattacher à un autre domaine avant de le retirer\./);
  await finance.getByRole("button", { name: "Annuler", exact: true }).click();

  // Un rôle en double est refusé, et rien n'est appliqué.
  await page.getByRole("button", { name: "Modifier Anna K.", exact: true }).click();
  const anna = page.getByRole("group", { name: "Membre Anna K." });
  await anna.getByRole("button", { name: "+ Ajouter un rôle", exact: true }).click();
  await anna.getByRole("combobox", { name: "Rôle 2", exact: true }).selectOption("contributeur");
  await anna.getByRole("button", { name: "Appliquer", exact: true }).click();
  await expect(anna.getByRole("combobox", { name: "Rôle 2", exact: true })).toHaveAccessibleDescription(/Ce rôle figure déjà : regroupez ses domaines\./);
  await expect(anna).toBeVisible(); // le formulaire reste ouvert
  await anna.getByRole("button", { name: "Annuler", exact: true }).click();
  await expect(save(page)).toBeDisabled();
  expect(await seriousViolations(page)).toEqual([]);

  // Deuxième référente : Julien peut alors se retirer, avec l'avertissement ; l'autre retrait ne le porte pas.
  await page.getByRole("button", { name: "Modifier Claire M.", exact: true }).click();
  const claire = page.getByRole("group", { name: "Membre Claire M." });
  await claire.getByRole("combobox", { name: "Rôle" }).selectOption("referent");
  await claire.getByRole("checkbox", { name: "Finance" }).uncheck();
  await claire.getByRole("button", { name: "Appliquer" }).click();
  await save(page).click();
  await expect(page.getByText(/fusionnée sans revue/)).toBeVisible();

  await page.getByRole("button", { name: "Modifier Julien H.", exact: true }).click();
  await expect(julien.getByRole("button", { name: "Retirer de l'espace" })).toBeEnabled();
  await expect(julien).toContainText("Vous retirer vous ôtera l'administration de l'espace une fois la proposition fusionnée.");
  await julien.getByRole("button", { name: "Annuler", exact: true }).click();

  // Retirer Anna ouvre une proposition à relire, dont la justification nomme le retrait.
  await page.getByRole("button", { name: "Modifier Anna K.", exact: true }).click();
  await expect(anna).toContainText("L'accès au dépôt se retire sur l'hébergeur.");
  await anna.getByRole("button", { name: "Retirer de l'espace" }).click();
  await save(page).click();
  await expect(page.getByText(/Proposition n° \d+ ouverte : elle attend la revue d'un autre référent\./)).toBeVisible();
  await page.getByRole("link", { name: "Voir la proposition" }).click();
  await expect(page.getByText("Anna K. (anna.k) retiré.")).toBeVisible();
});

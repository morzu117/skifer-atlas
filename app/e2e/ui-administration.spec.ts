import { expect } from "@playwright/test";
import { API } from "./demo";
import { test } from "./isolation";
import {
  domainWithReferent,
  domains,
  leaveConfirmationByKeyboard,
  openAdmin,
  platforms,
  platformsByKeyboard,
  save,
  saveMerged,
  validators,
  validatorsByKeyboard,
} from "./ui-administration.gestes";

// Écran 107 (Administration) : chaque geste de la maquette 10.7 et des plans 0017 et 0023
// que administration*.spec.ts, rattachement.spec.ts et reinitialisation.spec.ts ne font pas
// déjà. Inventaire : docs/tests/inventaire-ui-ecrans.md.

const members = (page: import("@playwright/test").Page) => page.getByRole("table", { name: "Utilisateurs et rôles" });

test("[S-UI-107-01] « Annuler » en bas de page défait toutes les modifications locales, rien n'est enregistré", async ({ page, request }) => {
  await openAdmin(page, request);
  const cancel = page.getByRole("button", { name: "Annuler", exact: true });
  await expect(cancel).toBeDisabled();
  await expect(save(page)).toBeDisabled();

  await validators(page).getByRole("spinbutton", { name: "Canonique (min 1)" }).fill("4");
  await validators(page).getByRole("spinbutton", { name: "Déclinaisons (min 1)" }).fill("3");
  await platforms(page).getByRole("checkbox", { name: "BigQuery" }).check();
  await domains(page).getByRole("button", { name: "Domaine", exact: true }).click();
  await page.getByRole("group", { name: "Nouveau domaine" }).getByLabel(/^Libellé/).fill("Data");
  await page.getByRole("group", { name: "Nouveau domaine" }).getByRole("button", { name: "Ajouter le domaine" }).click();
  await page.getByRole("button", { name: "Inviter", exact: true }).click();
  const invite = page.getByRole("group", { name: "Nouveau membre" });
  await invite.getByLabel(/^Nom/).fill("Léa M.");
  await invite.getByLabel("Compte sur l'hébergeur Git").fill("lea.m");
  await invite.getByRole("button", { name: "Ajouter le membre" }).click();
  await expect(members(page)).toContainText("Léa M.");
  await expect(domains(page).getByText("Data", { exact: true })).toBeVisible();
  await expect(save(page)).toBeEnabled();

  await cancel.click();
  await expect(validators(page).getByRole("spinbutton", { name: "Canonique (min 1)" })).toHaveValue("2");
  await expect(validators(page).getByRole("spinbutton", { name: "Déclinaisons (min 1)" })).toHaveValue("1");
  await expect(platforms(page).getByRole("checkbox", { name: "BigQuery" })).not.toBeChecked();
  await expect(domains(page).getByText("Data", { exact: true })).toHaveCount(0);
  await expect(members(page)).not.toContainText("Léa M.");
  await expect(cancel).toBeDisabled();
  await expect(save(page)).toBeDisabled();

  // Rien n'est parti : la gouvernance relue est celle de départ.
  await page.reload();
  await expect(domains(page).getByText("Data", { exact: true })).toHaveCount(0);
  await expect(members(page)).not.toContainText("Léa M.");
});

test("[S-UI-107-02] « + Domaine » : libellé requis, identifiant déduit puis libre, doublon refusé, « Annuler » n'ajoute rien", async ({ page, request }) => {
  await openAdmin(page, request);
  const add = domains(page).getByRole("button", { name: "Domaine", exact: true });
  await add.click();
  const form = page.getByRole("group", { name: "Nouveau domaine" });
  await expect(add).toHaveCount(0); // une modification à la fois
  const label = form.getByRole("textbox", { name: /Libellé/ });
  const id = form.getByRole("textbox", { name: /Identifiant/ });

  await form.getByRole("button", { name: "Ajouter le domaine" }).click();
  await expect(label).toHaveAccessibleDescription(/Le libellé est requis\./);
  await expect(form).toBeVisible();

  await label.fill("Ventes");
  await expect(id).toHaveValue("ventes");
  await form.getByRole("button", { name: "Ajouter le domaine" }).click();
  await expect(id).toHaveAccessibleDescription(/Un domaine porte déjà cet identifiant\./);

  await id.fill("ventes-export");
  await label.fill("Ventes à l'export");
  await expect(id).toHaveValue("ventes-export"); // modifié à la main : il ne suit plus le libellé
  await expect(page.getByText("Appliquez ou annulez la modification en cours.")).toBeVisible();
  await expect(save(page)).toBeDisabled();

  await form.getByRole("button", { name: "Annuler", exact: true }).click();
  await expect(form).toHaveCount(0);
  await expect(domains(page).getByText("Ventes à l'export")).toHaveCount(0);
  await expect(domains(page).getByRole("button", { name: "Domaine", exact: true })).toBeVisible();
  await expect(save(page)).toBeDisabled();
});

test("[S-UI-107-03] « + Domaine » avec référent et validateurs : résumé de la maquette, pas d'alerte, relu après enregistrement", async ({ page, request }) => {
  await domainWithReferent(page, request);
});

test("[S-UI-107-04] nommer un référent à Marketing retire l'alerte « Aucun référent »", async ({ page, request }) => {
  await openAdmin(page, request);
  const marketing = domains(page).getByRole("listitem").filter({ hasText: "Marketing" });
  await expect(marketing).toContainText("Aucun référent");
  await page.getByRole("button", { name: "Modifier le domaine Marketing" }).click();
  const form = page.getByRole("group", { name: "Domaine Marketing" });
  await expect(form).toContainText("Identifiant marketing : il ne change pas");
  await form.getByRole("group", { name: "Référents" }).getByRole("checkbox", { name: "Claire M." }).check();
  await form.getByRole("button", { name: "Appliquer" }).click();
  await expect(marketing).toContainText(/Référent Claire M\. · 0 validateurs? · \d+ KPI/);
  await expect(domains(page).getByText(/Aucun référent/)).toHaveCount(0);
  await saveMerged(page);
  await page.reload();
  await expect(domains(page).getByText(/Aucun référent/)).toHaveCount(0);
  await expect(domains(page).getByRole("listitem").filter({ hasText: "Marketing" })).toContainText("Référent Claire M.");
});

test("[S-UI-107-05] surcharge des validateurs par domaine : 0 refusé, ajoutée à la liste, relue, puis retirée", async ({ page, request }) => {
  await openAdmin(page, request);
  const overrides = validators(page).getByRole("listitem");
  await expect(overrides.filter({ hasText: "Supply chain" })).toContainText("canonique 1 · déclinaisons 1"); // la démonstration
  await expect(overrides.filter({ hasText: "Finance" })).toHaveCount(0);

  await page.getByRole("button", { name: "Modifier le domaine Finance" }).click();
  const form = page.getByRole("group", { name: "Domaine Finance" });
  await form.getByRole("checkbox", { name: "Nombre de validateurs propre au domaine" }).check();
  const canonical = form.getByRole("spinbutton", { name: "Canonique (min 1)" });
  await expect(canonical).toHaveValue("2"); // part des valeurs de l'espace
  await canonical.fill("0");
  await form.getByRole("button", { name: "Appliquer" }).click();
  await expect(canonical).toHaveAccessibleDescription(/Au moins 1\./);
  await expect(form).toBeVisible();
  await canonical.fill("3");
  await form.getByRole("button", { name: "Appliquer" }).click();
  await expect(form).toHaveCount(0);
  await expect(overrides.filter({ hasText: "Finance" })).toContainText("canonique 3 · déclinaisons 1");
  await saveMerged(page);
  await page.reload();
  await expect(validators(page).getByRole("listitem").filter({ hasText: "Finance" })).toContainText("canonique 3 · déclinaisons 1");

  // Chemin inverse : décocher retire la surcharge.
  await page.getByRole("button", { name: "Modifier le domaine Finance" }).click();
  await form.getByRole("checkbox", { name: "Nombre de validateurs propre au domaine" }).uncheck();
  await form.getByRole("button", { name: "Appliquer" }).click();
  await expect(validators(page).getByRole("listitem").filter({ hasText: "Finance" })).toHaveCount(0);
  await saveMerged(page);
  await page.reload();
  await expect(validators(page).getByRole("listitem").filter({ hasText: "Finance" })).toHaveCount(0);
});

test("[S-UI-107-06] validateurs requis au clavier : flèches, plancher à 1, 0 refusé, valeur relue", async ({ page, request }) => {
  await validatorsByKeyboard(page, request);
});

test("[S-UI-107-07] plateformes autorisées : chaque case porte son mode d'authentification, cocher et décocher s'enregistrent", async ({ page, request }) => {
  await openAdmin(page, request);
  const auth: [RegExp, string][] = [
    [/Databricks/, "OAuth · token personnel"],
    [/Snowflake/, "SSO · paire de clés"],
    [/BigQuery/, "OAuth Google"],
    [/Fabric/, "Entra ID"],
    [/Redshift/, "IAM"],
  ];
  for (const [name, mode] of auth) await expect(platforms(page).getByRole("checkbox", { name })).toHaveAccessibleDescription(mode);
  await expect(platforms(page).getByText("Les tokens restent dans le coffre personnel de chaque utilisateur.")).toBeVisible();
});

test("[S-UI-107-08] plateformes autorisées à la barre d'espace, enregistrées et relues", async ({ page, request }) => {
  await platformsByKeyboard(page, request);
});

test("[S-UI-107-09] modifier un membre : nom, entité, rôle et domaine dans le tableau, relus ; « Annuler » du formulaire ne change rien", async ({ page, request }) => {
  await openAdmin(page, request);
  // Chemin inverse d'abord : une saisie annulée ne touche pas le tableau.
  await page.getByRole("button", { name: "Modifier Marc D.", exact: true }).click();
  const marc = page.getByRole("group", { name: "Membre Marc D." });
  await marc.getByLabel(/^Nom/).fill("Marc Dupuis");
  await marc.getByRole("button", { name: "Annuler", exact: true }).click();
  await expect(members(page).getByRole("row").filter({ hasText: "Marc D." })).toBeVisible();
  await expect(members(page)).not.toContainText("Marc Dupuis");
  await expect(save(page)).toBeDisabled();

  // Les deux rôles d'un membre : « Retirer le rôle 2 » revient à un seul rôle.
  await page.getByRole("button", { name: "Modifier Anna K.", exact: true }).click();
  const anna = page.getByRole("group", { name: "Membre Anna K." });
  await anna.getByRole("button", { name: "+ Ajouter un rôle", exact: true }).click();
  await expect(anna.getByRole("combobox", { name: "Rôle 2", exact: true })).toBeVisible();
  await anna.getByRole("button", { name: "Retirer le rôle 2" }).click();
  await expect(anna.getByRole("combobox", { name: "Rôle 2", exact: true })).toHaveCount(0);
  await expect(anna.getByRole("combobox", { name: "Rôle", exact: true })).toHaveValue("contributeur");

  await anna.getByLabel(/^Nom/).fill("Anna Keller");
  await anna.getByRole("combobox", { name: "Entité" }).selectOption("nordis-fr");
  await anna.getByRole("combobox", { name: "Rôle", exact: true }).selectOption("validateur");
  await anna.getByRole("checkbox", { name: "Ventes" }).check();
  await anna.getByRole("button", { name: "Appliquer" }).click();
  const row = members(page).getByRole("row").filter({ hasText: "Anna Keller" });
  await expect(row.getByRole("cell")).toHaveText(["Anna Kelleranna.k", "nordis-fr", "Validateur", "Ventes", "Modifier"]);
  await saveMerged(page);
  await page.reload();
  await expect(members(page).getByRole("row").filter({ hasText: "Anna Keller" }).getByRole("cell"))
    .toHaveText(["Anna Kelleranna.k", "nordis-fr", "Validateur", "Ventes", "Modifier"]);
});

test("[S-UI-107-10] tableau Utilisateurs et rôles et Dépôt Git : colonnes de la maquette, URL en lecture seule", async ({ page, request }) => {
  const ws = await openAdmin(page, request);
  await expect(members(page).getByRole("columnheader")).toHaveText(["Nom", "Entité", "Rôle", "Domaines", "Actions"]);
  await expect(members(page).getByRole("row").filter({ hasText: "Julien H." }).getByRole("cell").nth(2)).toHaveText("Référent");
  await expect(members(page).getByRole("row").filter({ hasText: "Julien H." }).getByRole("cell").nth(3)).toHaveText("Tout l'espace");
  await expect(members(page).getByRole("row").filter({ hasText: "Marc D." }).getByRole("cell").nth(3)).toHaveText("Finance, Ventes");
  const repository = page.getByRole("region", { name: "Dépôt Git de l'espace" });
  await expect(repository.getByText(ws.remote, { exact: true })).toBeVisible();
  await expect(repository.getByText("main", { exact: true })).toBeVisible();
  await expect(repository.getByRole("textbox")).toHaveCount(0); // changer de dépôt n'est pas une modification de gouvernance
  await expect(repository.getByRole("button", { name: "Rattacher le dépôt" })).toHaveCount(0);
});

test("[S-UI-107-11] la confirmation de sortie : focus, Tab enfermé, Échap reste, Entrée quitte sans enregistrer", async ({ page, request }) => {
  await leaveConfirmationByKeyboard(page, request);
});

test("[S-UI-107-12] quitter par le sélecteur d'espace avec un brouillon : confirmation, puis l'accueil", async ({ page, request }) => {
  const ws = await openAdmin(page, request);
  await platforms(page).getByRole("checkbox", { name: "BigQuery" }).check();
  const switcher = page.getByRole("link", { name: /Espace\s*Groupe Nordis/ });
  await switcher.click();
  const dialog = page.getByRole("alertdialog", { name: "Quitter l'Administration ?" });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`#/w/${ws.id}/administration$`));
  await dialog.getByRole("button", { name: "Annuler" }).click();
  await expect(switcher).toBeFocused();
  await expect(platforms(page).getByRole("checkbox", { name: "BigQuery" })).toBeChecked();

  await switcher.click();
  await dialog.getByRole("button", { name: "Quitter sans enregistrer" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Vos espaces de travail" })).toBeVisible();
});

test("[S-UI-107-13] erreur du serveur à la lecture des paramètres : un bandeau dit quoi faire et « Réessayer » recharge", async ({ page, request }) => {
  const ws = await openAdmin(page, request);
  const admin = `${API}/api/workspaces/${ws.id}/admin`;
  await page.route(admin, (route) => route.fulfill({ status: 500, json: { detail: { code: "internal_error", message: "Erreur interne du serveur." } } }));
  await page.reload();
  const banner = page.getByRole("alert").filter({ hasText: "Erreur interne du serveur." });
  await expect(banner).toBeVisible();
  await expect(save(page)).toHaveCount(0);
  await page.unroute(admin);
  // Guide 3.7 : un bandeau dit toujours quoi faire ; plan 0010 : « bandeau avec le message et l'action ».
  await expect(banner.getByRole("button", { name: "Réessayer" })).toBeVisible();
  await banner.getByRole("button", { name: "Réessayer" }).click();
  await expect(save(page)).toBeVisible();
});

test("[S-UI-107-14] serveur injoignable pendant l'enregistrement : le brouillon reste, l'enregistrement repart ensuite", async ({ page, request }) => {
  const ws = await openAdmin(page, request);
  const bigquery = platforms(page).getByRole("checkbox", { name: "BigQuery" });
  await bigquery.check();
  const post = `${API}/api/workspaces/${ws.id}/admin/governance`;
  await page.route(post, (route) => route.abort("connectionrefused"));
  await save(page).click();
  // Le bandeau global de la coque, avec son « Réessayer » (plan 0010, critère 5).
  await expect(page.getByRole("alert").filter({ hasText: "Serveur local injoignable", has: page.getByRole("button", { name: "Réessayer" }) })).toBeVisible();
  await expect(bigquery).toBeChecked();
  await expect(save(page)).toBeEnabled();
  await expect(page.getByText(/Paramètres enregistrés/)).toHaveCount(0);
  await page.unroute(post);
  await saveMerged(page);
  await page.reload();
  await expect(platforms(page).getByRole("checkbox", { name: "BigQuery" })).toBeChecked();
});

test("[S-UI-107-15] « Synchroniser » sans serveur : l'erreur s'affiche dans la section, le bouton redevient utilisable", async ({ page, request }) => {
  const ws = await openAdmin(page, request);
  const repository = page.getByRole("region", { name: "Dépôt Git de l'espace" });
  const sync = `${API}/api/workspaces/${ws.id}/sync`;
  await page.route(sync, (route) => route.abort("connectionrefused"));
  await repository.getByRole("button", { name: "Synchroniser" }).click();
  await expect(repository.getByRole("alert")).toBeVisible();
  await expect(repository.getByRole("alert")).not.toContainText(/Traceback|"detail"/);
  await expect(repository.getByRole("button", { name: "Synchroniser" })).toBeEnabled();
  await page.unroute(sync);
  await repository.getByRole("button", { name: "Synchroniser" }).click();
  await expect(repository.getByRole("status")).toHaveText(/Synchronisé · index reconstruit\.|Déjà à jour avec le dépôt distant\./);
});

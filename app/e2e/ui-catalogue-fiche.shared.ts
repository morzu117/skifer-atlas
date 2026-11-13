import type { APIRequestContext, Page as ScenarioPage } from "@playwright/test";
type ScenarioRun = (args: { page: ScenarioPage; request: APIRequestContext }) => Promise<void>;
type Scenario = [string, ScenarioRun];
import { expect } from "@playwright/test";
import { API } from "./demo";
import { isolatedDemo, trackWorkspace } from "./isolation";

export function catalogueFicheScenarios(): Scenario[] {
  const scenarios: Scenario[] = [];
scenarios.push(["[S-UI-101-01] recherche par synonyme, filtre et retour à la liste", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await page.goto(`${ws.root}/catalogue`);
  const table = page.getByRole("table", { name: "Concepts et KPI" });
  const search = page.getByRole("searchbox", { name: "Rechercher dans le catalogue" });
  await search.fill("CA net");
  await expect(table.getByRole("link", { name: "Revenu net", exact: true })).toBeVisible();
  await expect(table.getByRole("row")).toHaveCount(2);
  await search.fill("aucun résultat xyz");
  await expect(page.getByText("Aucun concept ou KPI ne correspond")).toBeVisible();
  await search.fill("");
  await page.getByRole("combobox", { name: "Domaine" }).selectOption({ label: "Finance" });
  await page.getByRole("combobox", { name: "Type" }).selectOption({ label: "KPI" });
  await expect(table.getByRole("row")).toHaveCount(3);
  await page.goBack();
  await expect(page.getByRole("combobox", { name: "Type" })).toHaveValue("");
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Domaine" })).toHaveValue("finance");
}]);

scenarios.push(["[S-UI-101-02] aperçu d'une ligne et ouverture de la fiche", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await page.goto(`${ws.root}/catalogue`);
  const link = page.getByRole("table", { name: "Concepts et KPI" }).getByRole("link", { name: "Revenu net", exact: true });
  await link.focus();
  const preview = page.getByRole("complementary", { name: "Revenu net" });
  await expect(preview).toContainText("n03");
  await preview.getByRole("link", { name: "Ouvrir la fiche" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Revenu net" })).toBeVisible();
  await page.getByRole("main").getByRole("link", { name: "Catalogue", exact: true }).click();
  await expect(page.getByRole("table", { name: "Concepts et KPI" })).toBeVisible();
}]);

scenarios.push(["[S-UI-101-03] création depuis le catalogue, reprise et abandon du brouillon", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await page.goto(`${ws.root}/catalogue`);
  await page.getByRole("link", { name: "Nouveau concept ou KPI" }).click();
  await page.getByLabel(/^Libellé/).fill("Test gestes catalogue");
  await page.getByLabel(/^Propriétaire/).fill("claire.m");
  await page.getByLabel(/^Domaine/).selectOption("finance");
  await page.getByRole("button", { name: "Créer et ouvrir l'éditeur" }).click();
  await expect(page.getByRole("heading", { name: "Test gestes catalogue : v1 · brouillon" })).toBeVisible();
  await page.getByRole("complementary", { name: "Palette des nœuds" }).getByRole("button", { name: "Source", exact: true }).click();
  await expect(page.getByText(/Enregistré .* \(local\)/)).toBeVisible();
  await page.getByRole("link", { name: /Catalogue/ }).click();
  const drafts = page.getByRole("region", { name: "Mes brouillons" });
  await expect(drafts).toContainText("Test gestes catalogue");
  await drafts.getByRole("link", { name: /Reprendre/ }).click();
  await expect(page.getByText(/1 nœud/)).toBeVisible();
  await page.getByRole("link", { name: /Catalogue/ }).click();
  await drafts.getByRole("button", { name: /Abandonner/ }).click();
  const dialog = page.getByRole("alertdialog", { name: "Abandonner le brouillon ?" });
  await expect(dialog.getByRole("button", { name: "Annuler" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await drafts.getByRole("button", { name: /Abandonner/ }).click();
  await dialog.getByRole("button", { name: "Abandonner", exact: true }).click();
  await expect(drafts).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("Test gestes catalogue")).toHaveCount(0);
}]);

scenarios.push(["[S-UI-102-01] fiche : onglets et comparaison de versions", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await page.goto(`${ws.root}/catalogue`);
  const revenue = page.getByRole("table", { name: "Concepts et KPI" }).getByRole("link", { name: "Revenu net", exact: true });
  await revenue.focus();
  await expect(page.getByRole("complementary", { name: "Revenu net" })).toBeVisible();
  await revenue.click();
  await expect(page).toHaveURL(/fiche\/revenu-net/);
  const tabs = page.getByRole("navigation", { name: "Onglets de la fiche" });
  await expect(page.getByRole("figure", { name: "Graphe de Revenu net" })).toBeVisible();
  await tabs.getByRole("button", { name: /Déclinaisons/ }).click();
  await expect(page.getByRole("row").filter({ hasText: "nordis-de" })).toBeVisible();
  await tabs.getByRole("button", { name: /Versions/ }).click();
  await page.getByRole("combobox", { name: "De", exact: true }).selectOption("3");
  await page.getByRole("combobox", { name: "À", exact: true }).selectOption("4");
  await page.getByRole("button", { name: "Afficher les écarts" }).click();
  await expect(page.getByText(/3 écarts :/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/3 écarts :/)).toBeVisible();
  await tabs.getByRole("button", { name: /Dépendances/ }).click();
  await expect(page.getByRole("region", { name: "Référencé par" }).getByRole("link", { name: "Panier moyen" })).toBeVisible();
  await tabs.getByRole("button", { name: /Implémentations/ }).click();
  await expect(page.getByRole("region", { name: "nordis-fr · Databricks" })).toBeVisible();
  await tabs.getByRole("button", { name: /Scope/ }).click();
  await expect(page.getByRole("heading", { name: "Dernières comparaisons" })).toBeVisible();
  await tabs.getByRole("button", { name: "Définition", exact: true }).click();
  await expect(page.getByRole("figure", { name: "Graphe de Revenu net" })).toBeVisible();
}]);

scenarios.push(["[S-UI-101-19] navigation du catalogue aux flèches et ouverture au clavier", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await page.goto(`${ws.root}/catalogue`);
  const table = page.getByRole("table", { name: "Concepts et KPI" });
  await table.getByRole("link", { name: "Revenu net", exact: true }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(table.getByRole("link", { name: "Taux de service" })).toBeFocused();
  await expect(page.getByRole("complementary", { name: "Taux de service" })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Taux de service" })).toBeVisible();
}]);

scenarios.push(["[S-UI-101-20] serveur indisponible : message et réessai du catalogue", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  const catalog = new RegExp(`/api/workspaces/${ws.id}/catalog`);
  await page.route(catalog, route => route.fulfill({ status: 500, json: { detail: { code: "index_failed", message: "Index illisible." } } }));
  await page.goto(`${ws.root}/catalogue`);
  const banner = page.getByRole("main").getByRole("alert");
  await expect(banner).toContainText("Index illisible.");
  await page.unroute(catalog);
  await banner.getByRole("button", { name: "Réessayer" }).click();
  await expect(page.getByRole("table", { name: "Concepts et KPI" }).getByRole("link", { name: "Revenu net", exact: true })).toBeVisible();
}]);

scenarios.push(["[S-UI-102-17] lancer une comparaison depuis la fiche", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await page.goto(`${ws.root}/fiche/revenu-net`);
  await page.getByRole("link", { name: "Lancer une comparaison" }).click();
  await expect(page.getByRole("combobox", { name: "KPI" })).toHaveValue("revenu-net");
}]);

scenarios.push(["[S-UI-102-18] dépendances et extraction d'une implémentation", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await page.goto(`${ws.root}/fiche/revenu-net`);
  const tabs = page.getByRole("navigation", { name: "Onglets de la fiche" });
  await tabs.getByRole("button", { name: /Implémentations/ }).click();
  const implementation = page.getByRole("region", { name: "nordis-fr · Databricks" });
  await implementation.getByRole("button", { name: "Extraire et comparer au canonique" }).click();
  await expect(implementation.getByRole("region", { name: "Écarts au canonique" })).toContainText("Écarts au canonique v4");
  await tabs.getByRole("button", { name: /Dépendances/ }).click();
  await page.getByRole("region", { name: "Référencé par" }).getByRole("link", { name: "Panier moyen" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Panier moyen" })).toBeVisible();
}]);

scenarios.push(["[S-UI-101-21] filtres propriétaire et statut, remise à zéro", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await page.goto(`${ws.root}/catalogue`);
  const table = page.getByRole("table", { name: "Concepts et KPI" });
  const owner = page.getByRole("combobox", { name: "Propriétaire" });
  const status = page.getByRole("combobox", { name: "Statut" });
  await owner.selectOption({ label: "Claire M." });
  await status.selectOption({ label: "Validé" });
  await expect(table.getByRole("link", { name: "Revenu net", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/owner=/);
  await page.reload();
  await expect(owner).not.toHaveValue("");
  await expect(status).not.toHaveValue("");
  await owner.selectOption("");
  await status.selectOption("");
  await expect(table.getByRole("row")).toHaveCount(8);
}]);

scenarios.push(["[S-UI-101-22] annuler la création ne laisse aucun brouillon", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await page.goto(`${ws.root}/catalogue`);
  await page.getByRole("link", { name: "Nouveau concept ou KPI" }).click();
  await page.getByRole("textbox", { name: /^Libellé/ }).fill("Brouillon jamais créé");
  await page.getByRole("link", { name: "Annuler", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Catalogue" })).toBeVisible();
  await expect(page.getByText("Brouillon jamais créé")).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("Brouillon jamais créé")).toHaveCount(0);
}]);

scenarios.push(["[S-UI-101-23] catalogue hors ligne puis réessai", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  const catalog = new RegExp(`/api/workspaces/${ws.id}/catalog`);
  await page.route(catalog, route => route.abort("connectionrefused"));
  await page.goto(`${ws.root}/catalogue`);
  await expect(page.getByText("Catalogue indisponible.")).toBeVisible();
  const retry = page.getByRole("alert").getByRole("button", { name: "Réessayer" });
  await expect(retry).toBeVisible();
  await page.unroute(catalog);
  await retry.click();
  await expect(page.getByRole("table", { name: "Concepts et KPI" }).getByRole("link", { name: "Revenu net", exact: true })).toBeVisible();
}]);

scenarios.push(["[S-UI-102-19] fiche concept : onglets et actions pertinents seulement", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await page.goto(`${ws.root}/catalogue`);
  await page.getByRole("link", { name: "Commande", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Commande" })).toBeVisible();
  const tabs = page.getByRole("navigation", { name: "Onglets de la fiche" });
  await expect(tabs.getByRole("button", { name: /Déclinaisons/ })).toHaveCount(0);
  await expect(tabs.getByRole("button", { name: /Scope/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Lancer une comparaison" })).toHaveCount(0);
}]);

scenarios.push(["[S-UI-102-20] fiche inconnue et retour au catalogue", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await page.goto(`${ws.root}/fiche/inconnu-xyz`);
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("navigation", { name: "Navigation de l'espace" }).getByRole("link", { name: "Catalogue", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Catalogue" })).toBeVisible();
}]);

scenarios.push(["[S-UI-101-24] aperçu : description, déclinaisons, références et comparaison", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await page.goto(`${ws.root}/catalogue`);
  await page.getByRole("table", { name: "Concepts et KPI" }).getByRole("link", { name: "Revenu net", exact: true }).focus();
  const preview = page.getByRole("complementary", { name: "Revenu net" });
  await expect(preview).toContainText("Chiffre d'affaires facturé");
  await expect(preview).toContainText("nordis-fr");
  await expect(preview.getByRole("link", { name: "Panier moyen" })).toBeVisible();
  await expect(preview).toContainText("Jamais comparé");
  await preview.getByRole("link", { name: "Panier moyen" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Panier moyen" })).toBeVisible();
}]);

scenarios.push(["[S-UI-101-25] aperçu du catalogue sous le tableau sur petit écran", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await page.setViewportSize({ width: 880, height: 820 });
  await page.goto(`${ws.root}/catalogue`);
  const table = page.getByRole("table", { name: "Concepts et KPI" });
  await table.getByRole("link", { name: "Revenu net", exact: true }).focus();
  const preview = page.getByRole("complementary", { name: "Revenu net" });
  await expect(preview).toBeVisible();
  const tableBox = await table.boundingBox();
  const previewBox = await preview.boundingBox();
  expect(tableBox).not.toBeNull(); expect(previewBox).not.toBeNull();
  expect(previewBox!.y).toBeGreaterThanOrEqual(tableBox!.y + tableBox!.height);
  await preview.getByRole("link", { name: "Ouvrir la fiche" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Revenu net" })).toBeVisible();
}]);

scenarios.push(["[S-UI-102-21] définition, sémantique et modification du KPI", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await page.goto(`${ws.root}/fiche/revenu-net`);
  const graph = page.getByRole("figure", { name: "Graphe de Revenu net" });
  await expect(graph).toContainText("n03");
  await expect(graph).toContainText("n04");
  await expect(page.getByText("Europe/Paris").first()).toBeVisible();
  await expect(page.getByText("EUR", { exact: true }).first()).toBeVisible();
  await page.getByRole("link", { name: "Proposer une modification" }).click();
  await expect(page.getByRole("heading", { name: "Revenu net : v5 · brouillon" })).toBeVisible();
  await page.getByRole("link", { name: "Revenu net", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Revenu net" })).toBeVisible();
}]);

scenarios.push(["[S-UI-102-22] versions : comparer dans l'autre sens et reprendre après rechargement", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await page.goto(`${ws.root}/fiche/revenu-net`);
  await page.getByRole("navigation", { name: "Onglets de la fiche" }).getByRole("button", { name: /Versions/ }).click();
  await page.getByRole("combobox", { name: "De", exact: true }).selectOption("4");
  await page.getByRole("combobox", { name: "À", exact: true }).selectOption("3");
  await page.getByRole("button", { name: "Afficher les écarts" }).click();
  await expect(page).toHaveURL(/base=4&other=3/);
  await expect(page.getByRole("figure", { name: "Graphe de la version 3" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("combobox", { name: "De", exact: true })).toHaveValue("4");
  await expect(page.getByRole("combobox", { name: "À", exact: true })).toHaveValue("3");
}]);

scenarios.push(["[S-UI-101-26] formulaire de création : erreurs des champs et annulation", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await page.goto(`${ws.root}/catalogue`);
  await page.getByRole("link", { name: "Nouveau concept ou KPI" }).click();
  const label = page.getByRole("textbox", { name: /^Libellé/ });
  const id = page.getByRole("textbox", { name: /^Identifiant/ });
  const owner = page.getByRole("textbox", { name: /^Propriétaire/ });
  const domain = page.getByRole("combobox", { name: /^Domaine/ });
  await label.clear(); await id.fill("?"); await owner.clear(); await domain.selectOption("");
  await page.getByRole("button", { name: "Créer et ouvrir l'éditeur" }).click();
  await expect(label).toHaveAttribute("aria-invalid", "true");
  await expect(id).toHaveAttribute("aria-invalid", "true");
  await expect(owner).toHaveAttribute("aria-invalid", "true");
  await expect(domain).toHaveAccessibleDescription(/Choisir un domaine/);
  await page.getByRole("link", { name: "Annuler", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Catalogue" })).toBeVisible();
}]);

scenarios.push(["[S-UI-101-27] combiner et réinitialiser les quatre filtres", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await page.goto(`${ws.root}/catalogue`);
  const table = page.getByRole("table", { name: "Concepts et KPI" });
  const domain = page.getByRole("combobox", { name: "Domaine" });
  const owner = page.getByRole("combobox", { name: "Propriétaire" });
  const status = page.getByRole("combobox", { name: "Statut" });
  const kind = page.getByRole("combobox", { name: "Type" });
  await domain.selectOption({ label: "Finance" });
  await owner.selectOption({ label: "Claire M." });
  await status.selectOption({ label: "Validé" });
  await kind.selectOption({ label: "KPI" });
  await expect(table.getByRole("link", { name: "Revenu net", exact: true })).toBeVisible();
  await page.reload();
  await expect(domain).toHaveValue("finance");
  await expect(kind).toHaveValue("kpi");
  for (const filter of [domain, owner, status, kind]) await filter.selectOption("");
  await expect(table.getByRole("row")).toHaveCount(8);
}]);

scenarios.push(["[S-UI-101-28] trier les noms du catalogue dans les deux sens", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await page.goto(`${ws.root}/catalogue`);
  const table = page.getByRole("table", { name: "Concepts et KPI" });
  const sort = table.getByRole("button", { name: /^(nom|trier.*nom|nom.*trier)$/i });
  await expect(sort).toBeVisible();
  await sort.click();
  const first = table.getByRole("link").first();
  await expect(first).toHaveText(/^(Client actif|Taux de service)$/);
  const initial = await first.textContent();
  await sort.click();
  await expect(first).toHaveText(initial === "Client actif" ? "Taux de service" : "Client actif");
}]);

scenarios.push(["[S-UI-101-29] confirmation d'abandon : focus après suppression", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await page.goto(`${ws.root}/catalogue`);
  await page.getByRole("link", { name: "Nouveau concept ou KPI" }).click();
  await page.getByRole("textbox", { name: /^Libellé/ }).fill("Focus après abandon");
  await page.getByRole("button", { name: "Créer et ouvrir l'éditeur" }).click();
  await expect(page.getByRole("heading", { name: "Focus après abandon : v1 · brouillon" })).toBeVisible();
  await page.getByRole("link", { name: "Catalogue" }).click();
  await page.getByRole("region", { name: "Mes brouillons" }).getByRole("button", { name: /Abandonner/ }).click();
  const dialog = page.getByRole("alertdialog", { name: "Abandonner le brouillon ?" });
  await expect(dialog.getByRole("button", { name: "Annuler" })).toBeFocused();
  await dialog.getByRole("button", { name: "Abandonner", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Catalogue" })).toBeFocused();
  await page.reload();
  await expect(page.getByText("Focus après abandon")).toHaveCount(0);
}]);

scenarios.push(["[S-UI-102-23] ouvrir la fiche depuis le catalogue et revenir", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await page.goto(`${ws.root}/catalogue`);
  const link = page.getByRole("table", { name: "Concepts et KPI" }).getByRole("link", { name: "Revenu net", exact: true });
  await link.focus();
  await expect(page.getByRole("complementary", { name: "Revenu net" })).toBeVisible();
  await link.click();
  await expect(page.getByRole("heading", { level: 1, name: "Revenu net" })).toBeVisible();
  await page.getByRole("main").getByRole("link", { name: "Catalogue", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Revenu net" })).toBeVisible();
  await link.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Revenu net" })).toBeVisible();
}]);

scenarios.push(["[S-UI-102-24] dépendances : naviguer d'une référence à un référencé par", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await page.goto(`${ws.root}/fiche/revenu-net?tab=dependances`);
  const by = page.getByRole("region", { name: "Référencé par" });
  await by.getByRole("link", { name: "Panier moyen" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Panier moyen" })).toBeVisible();
  await page.getByRole("navigation", { name: "Onglets de la fiche" }).getByRole("button", { name: /Dépendances/ }).click();
  await page.getByRole("region", { name: "Références" }).getByRole("link", { name: "Revenu net" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Revenu net" })).toBeVisible();
}]);

for (const [suffix, mode] of [["25", "Surcharge du canonique"], ["26", "Graphe indépendant"]] as const) {
  scenarios.push([`[S-UI-102-${suffix}] créer une déclinaison ${mode} depuis la fiche`, async ({ page, request }) => {
    const ws = await isolatedDemo(request, API);
    await page.goto(`${ws.root}/fiche/marge-brute`);
    await page.getByRole("navigation", { name: "Onglets de la fiche" }).getByRole("button", { name: /Déclinaisons/ }).click();
    await page.getByRole("link", { name: "Créer une déclinaison" }).click();
    await expect(page.getByRole("heading", { name: "Nouvelle déclinaison de marge-brute" })).toBeVisible();
    await page.getByRole("combobox", { name: /Entité/ }).selectOption("nordis-fr");
    await page.getByRole("radio", { name: mode, exact: true }).check();
    await page.getByRole("textbox", { name: /Justification/ }).fill("Adapter les règles françaises.");
    await page.getByRole("button", { name: "Créer et ouvrir l'éditeur" }).click();
    await expect(page.getByRole("heading", { level: 1, name: /marge-brute.*nordis-fr.*v1.*brouillon/ })).toBeVisible();
    const palette = page.getByRole("complementary", { name: "Palette des nœuds" });
    if (mode === "Surcharge du canonique") {
      await expect(palette.getByRole("button", { name: "Source", exact: true })).toBeDisabled();
      await expect(page.getByRole("group", { name: /Graphe de/ })).toBeVisible();
    } else {
      await palette.getByRole("button", { name: "Source", exact: true }).click();
      await expect(page.getByText(/1 nœud.*0 arête/)).toBeVisible();
    }
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: /marge-brute.*nordis-fr.*v1.*brouillon/ })).toBeVisible();
  }]);
}

scenarios.push(["[S-UI-102-27] annuler la création d'une déclinaison", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await page.goto(`${ws.root}/fiche/marge-brute?tab=declinaisons`);
  await page.getByRole("link", { name: "Créer une déclinaison" }).click();
  await page.getByRole("radio", { name: "Graphe indépendant" }).check();
  await page.getByRole("textbox", { name: /Justification/ }).fill("Test abandonné.");
  await page.getByRole("link", { name: "Annuler", exact: true }).click();
  await expect(page).toHaveURL(/fiche\/marge-brute\?tab=declinaisons/);
  await page.getByRole("link", { name: "Créer une déclinaison" }).click();
  await expect(page.getByRole("textbox", { name: /Justification/ })).toHaveValue("");
}]);

scenarios.push(["[S-UI-101-30] catalogue vide après création d'un espace", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Créer un espace" }).click();
  const dialog = page.getByRole("dialog", { name: "Créer un espace" });
  await dialog.getByRole("textbox", { name: /^Nom/ }).fill(`Espace vide ${Date.now()}`);
  const id = await dialog.getByRole("textbox", { name: /^Identifiant/ }).inputValue();
  trackWorkspace(id);
  await dialog.getByRole("textbox", { name: "Entités" }).fill("vide-fr");
  await dialog.getByRole("button", { name: "Créer l'espace" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Catalogue" })).toBeVisible();
  await expect(page.getByText("Le catalogue est vide", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Le catalogue est vide", { exact: true })).toBeVisible();
}]);

scenarios.push(["[S-UI-102-28] fiche : serveur indisponible puis rechargement", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  const sheet = "**/documents/revenu-net/sheet";
  await page.route(sheet, route => route.fulfill({ status: 503, json: { detail: { code: "unavailable", message: "Fiche indisponible" } } }));
  await page.goto(`${ws.root}/fiche/revenu-net`);
  await expect(page.getByRole("alert")).toContainText(/Fiche indisponible|échoué/i);
  await page.unroute(sheet);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Revenu net" })).toBeVisible();
}]);

scenarios.push(["[S-UI-102-29] fiche : hors ligne puis reprise", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  const sheet = "**/documents/revenu-net/sheet";
  await page.route(sheet, route => route.abort("connectionrefused"));
  await page.goto(`${ws.root}/fiche/revenu-net`);
  await expect(page.getByRole("alert")).toContainText(/injoignable|indisponible/i);
  await page.unroute(sheet);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Revenu net" })).toBeVisible();
}]);

for (const [id, entity] of [["30", "nordis-fr"], ["31", "nordis-de"], ["32", "nordis-es"]] as const) {
  scenarios.push([`[S-UI-102-${id}] ouvrir la déclinaison ${entity}`, async ({ page, request }) => {
    const ws = await isolatedDemo(request, API);
    await page.goto(`${ws.root}/fiche/revenu-net?tab=declinaisons`);
    const row = page.getByRole("row").filter({ hasText: entity });
    const link = row.getByRole("link").or(row.getByRole("button"));
    await expect(link).toBeVisible();
    await link.click();
    await expect(page.getByRole("heading", { level: 1, name: new RegExp(entity, "i") })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: new RegExp(entity, "i") })).toBeVisible();
  }]);
}

scenarios.push(["[S-UI-102-33] définition : liens de déclinaisons et de dépendances", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await page.goto(`${ws.root}/fiche/revenu-net`);
  await expect(page.getByRole("figure", { name: "Graphe de Revenu net" })).toBeVisible();
  const variant = page.getByRole("link", { name: /nordis-fr/i }).or(page.getByRole("button", { name: /nordis-fr/i }));
  await expect(variant).toBeVisible();
  await variant.click();
  await expect(page.getByRole("heading", { level: 1, name: /nordis-fr/i })).toBeVisible();
  await page.goBack();
  await page.getByRole("link", { name: "Panier moyen", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Panier moyen" })).toBeVisible();
}]);

scenarios.push(["[S-UI-102-34] lancer une comparaison et l'ouvrir depuis le scope", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await page.goto(`${ws.root}/fiche/revenu-net`);
  await page.getByRole("link", { name: "Lancer une comparaison" }).click();
  await expect(page.getByRole("combobox", { name: "KPI" })).toHaveValue("revenu-net");
  await page.getByRole("button", { name: /Lancer la comparaison|Relancer/ }).click();
  await expect(page).toHaveURL(/id=\d+.*variant=/, { timeout: 20000 });
  const comparisonId = new URLSearchParams(page.url().split("?")[1]).get("id");
  expect(comparisonId).not.toBeNull();
  await page.goto(`${ws.root}/fiche/revenu-net?tab=scope`);
  await expect(page.getByRole("heading", { name: "Dernières comparaisons" })).toBeVisible();
  const result = page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: comparisonId!, exact: true }) });
  const comparison = result.getByRole("link").or(result.getByRole("button"));
  await expect(comparison).toBeVisible();
  await comparison.click();
  await expect(page).toHaveURL(/comparaison/);
}]);

scenarios.push(["[S-UI-101-31] identifiant existant refusé à la création", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await page.goto(`${ws.root}/catalogue`);
  await page.getByRole("link", { name: "Nouveau concept ou KPI" }).click();
  await page.getByRole("textbox", { name: /^Libellé/ }).fill("Revenu net");
  await page.getByRole("textbox", { name: /^Identifiant/ }).fill("revenu-net");
  await page.getByRole("combobox", { name: /^Domaine/ }).selectOption("finance");
  await page.getByRole("button", { name: "Créer et ouvrir l'éditeur" }).click();
  await expect(page.getByRole("textbox", { name: /^Identifiant/ })).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("heading", { name: "Nouveau concept ou KPI" })).toBeVisible();
  await page.getByRole("link", { name: "Annuler", exact: true }).click();
  await expect(page.getByRole("table", { name: "Concepts et KPI" }).getByRole("link", { name: "Revenu net", exact: true })).toBeVisible();
}]);

scenarios.push(["[S-UI-102-35] définition : légende, variations et sémantique", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await page.goto(`${ws.root}/fiche/revenu-net`);
  const graph = page.getByRole("figure", { name: "Graphe de Revenu net" });
  await expect(graph.getByText(/variation/i).first()).toBeVisible();
  await expect(page.getByText("Point de variation déclaré")).toBeVisible();
  await expect(page.getByText("Sémantique déclarée")).toBeVisible();
  await expect(page.getByText("Europe/Paris").first()).toBeVisible();
  await page.reload();
  await expect(graph.getByText(/variation/i).first()).toBeVisible();
}]);

return scenarios;
}

import type { APIRequestContext, Page as ScenarioPage } from "@playwright/test";
type ScenarioRun = (args: { page: ScenarioPage; request: APIRequestContext }) => Promise<void>;
type Scenario = [string, ScenarioRun];
import { expect, type Locator, type Page } from "@playwright/test";
import { API } from "./demo";
import { isolatedDemo } from "./isolation";

const node = (page: Page, id: string) => page.locator(`[data-node-id="${id}"]`);
const props = (page: Page) => page.getByRole("complementary", { name: "Propriétés" });
const bottom = (page: Page) => page.getByRole("region", { name: "Validation du document" });
const edge = (page: Page, from: string, to: string) => page.getByRole("group", { name: `Edge from ${from} to ${to}` });

async function drag(page: Page, from: Locator, to: Locator) {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  expect(a).not.toBeNull(); expect(b).not.toBeNull();
  await page.mouse.move(a!.x + a!.width / 2, a!.y + a!.height / 2);
  await page.mouse.down();
  await page.mouse.move(b!.x + b!.width / 2, b!.y + b!.height / 2, { steps: 20 });
  await page.mouse.up();
}

// Le zoom et le panoramique automatique peuvent déplacer la cible pendant le geste.
// Relever sa position au fil du déplacement garde le pointeur sur la poignée visée.
async function dragHandle(page: Page, from: Locator, to: Locator) {
  const start = await from.boundingBox();
  expect(start).not.toBeNull();
  const x = start!.x + start!.width / 2, y = start!.y + start!.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 20; step++) {
    const target = await to.boundingBox();
    expect(target).not.toBeNull();
    const fraction = step / 20;
    await page.mouse.move(x + (target!.x + target!.width / 2 - x) * fraction, y + (target!.y + target!.height / 2 - y) * fraction);
  }
  await page.mouse.up();
}

// Chaque test a son propre dépôt ; seule la fixture prépare l'espace.
export const openEditor: ScenarioRun = async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await page.goto(`${ws.root}/fiche/revenu-net`);
  await page.getByRole("link", { name: "Proposer une modification" }).click();
  await expect(page.getByRole("heading", { name: "Revenu net : v5 · brouillon" })).toBeVisible();
};

export function editorScenarios(): Scenario[] {
  const scenarios: Scenario[] = [];


scenarios.push(["[S-UI-103-01] relier deux étapes par les poignées puis par l'outil, avec validation et reprise", async ({ page }) => {
  for (const gesture of ["poignées", "outil"] as const) {
    await page.getByRole("button", { name: "Sélection", exact: true }).click();
    await node(page, "n02").click();
    await props(page).getByRole("tab", { name: "Entrées" }).click();
    await props(page).getByRole("combobox", { name: "Entrée requis", exact: true }).selectOption("");
    await expect(edge(page, "n01", "n02")).toHaveCount(0);
    await expect(page.getByText("schéma 1 · 7 nœuds · 5 arêtes")).toBeVisible();
    await page.getByRole("button", { name: "Valider le graphe" }).click();

    if (gesture === "poignées") {
      await drag(page, node(page, "n01").locator(".react-flow__handle.source"), node(page, "n02").locator(".react-flow__handle.target"));
    } else {
      await page.getByRole("button", { name: "Ajouter une arête" }).click();
      await node(page, "n01").click();
      await node(page, "n02").click();
    }
    await expect(edge(page, "n01", "n02")).toBeVisible();
    await expect(page.getByText("schéma 1 · 7 nœuds · 6 arêtes")).toBeVisible();
    await page.getByRole("button", { name: "Valider le graphe" }).click();
    await expect(bottom(page).getByText("Schéma valide")).toBeVisible();
    await expect(bottom(page).getByText("Compilable Databricks, Snowflake")).toBeVisible();
    await page.getByRole("button", { name: "Sélection", exact: true }).click();
    await node(page, "n02").click();
    await props(page).getByRole("tab", { name: "YAML du nœud" }).click();
    await expect(props(page).getByLabel("YAML de n02")).toContainText(/inputs:\s*\[n01\]/);
    await expect(page.getByText(/Enregistré .* \(local\)/)).toBeVisible();
    await page.reload();
    await expect(edge(page, "n01", "n02")).toBeVisible();
    await node(page, "n02").click();
    await props(page).getByRole("tab", { name: "YAML du nœud" }).click();
    await expect(props(page).getByLabel("YAML de n02")).toContainText(/inputs:\s*\[n01\]/);
    await expect(bottom(page).getByText("Compilable Databricks, Snowflake")).toBeVisible();
  }
}]);

for (const [index, name] of ["Source", "Référence à un KPI", "Filtre", "Dédoublonnage", "Calcul de colonne", "Opération temporelle", "Jointure", "Union", "Agrégation", "Opération entre métriques"].entries()) {
  scenarios.push([`[S-UI-103-${String(index + 2).padStart(2, "0")}] palette : glisser ${name} sur le canevas`, async ({ page }) => {
    const palette = page.getByRole("complementary", { name: "Palette des nœuds" });
    const canvas = page.getByRole("group", { name: "Graphe de Revenu net" });
    await expect(bottom(page).getByText("Compilable Databricks, Snowflake")).toBeVisible();
    const item = palette.getByRole("button", { name, exact: true });
    if (name === "Source") await item.dragTo(canvas);
    else await drag(page, item, canvas);
    await expect(node(page, "n08")).toBeVisible();
    await expect(props(page).getByRole("heading", { name, exact: true })).toBeVisible();
    await expect(page.getByText(/8 nœuds/)).toBeVisible();
    await expect(page.getByText(/Enregistré .* \(local\)/)).toBeVisible();
    await page.reload();
    await expect(node(page, "n08")).toBeVisible();
  }]);
}

scenarios.push(["[S-UI-103-12] palette au clavier, annuler, rétablir et supprimer", async ({ page }) => {
  const palette = page.getByRole("complementary", { name: "Palette des nœuds" });
  await palette.getByRole("button", { name: "Source", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(node(page, "n08")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(node(page, "n08")).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(node(page, "n08")).toBeVisible();
  await node(page, "n08").click();
  await props(page).getByRole("button", { name: "Supprimer", exact: true }).click();
  await expect(node(page, "n08")).toHaveCount(0);
  await expect(page.getByText(/Enregistré .* \(local\)/)).toBeVisible();
  await page.reload();
  await expect(node(page, "n08")).toHaveCount(0);
}]);

scenarios.push(["[S-UI-103-13] une liaison en double est refusée avec un message", async ({ page }) => {
  await page.getByRole("button", { name: "Ajouter une arête" }).click();
  await node(page, "n01").click(); await node(page, "n02").click();
  await expect(page.getByRole("alert")).toContainText(/déjà|existe/i);
  await expect(page.getByText("schéma 1 · 7 nœuds · 6 arêtes")).toBeVisible();
}]);

scenarios.push(["[S-UI-103-18] une boucle sur soi est refusée avec un message", async ({ page }) => {
  await page.getByRole("button", { name: "Ajouter une arête" }).click();
  await node(page, "n02").click(); await node(page, "n02").click();
  await expect(page.getByRole("alert")).toContainText(/lui-même|cycle/i);
  await expect(page.getByText("schéma 1 · 7 nœuds · 6 arêtes")).toBeVisible();
}]);

scenarios.push(["[S-UI-103-14] panneau bas : colonnes, SQL et dialectes", async ({ page }) => {
  await node(page, "n03").click();
  await bottom(page).getByRole("tab", { name: /Colonnes en sortie/ }).click();
  await expect(bottom(page).getByRole("table")).toContainText("montant_ht");
  await bottom(page).getByRole("tab", { name: "SQL compilé" }).click();
  await expect(bottom(page).getByLabel("SQL databricks")).toContainText("montant_ht");
  await bottom(page).getByRole("radio", { name: "Snowflake" }).check();
  await expect(bottom(page).getByLabel("SQL snowflake")).toContainText("montant_ht");
  await bottom(page).getByRole("tab", { name: /Problèmes/ }).click();
  await expect(bottom(page).getByRole("tabpanel").getByText(/INFO.*point\(s\) de variation/)).toBeVisible();
}]);

scenarios.push(["[S-UI-103-15] les deux entrées d'une jointure acceptent les poignées", async ({ page }) => {
  const palette = page.getByRole("complementary", { name: "Palette des nœuds" });
  const canvas = page.getByRole("group", { name: "Graphe de Revenu net" });
  await drag(page, palette.getByRole("button", { name: "Jointure", exact: true }), canvas);
  await expect(node(page, "n08")).toBeVisible();
  await dragHandle(page, node(page, "n01").locator(".react-flow__handle.source"), node(page, "n08").locator(".react-flow__handle.target.port-left"));
  await expect(edge(page, "n01", "n08")).toBeVisible();
  // Contrôler le premier côté avant de commencer le second geste : un échange
  // ou un déplacement de poignée sera ainsi localisé au geste qui le provoque.
  await node(page, "n08").click();
  await props(page).getByRole("tab", { name: "Entrées" }).click();
  await expect(props(page).getByRole("combobox", { name: "Entrée gauche requis" })).toHaveValue("n01");
  await dragHandle(page, node(page, "n06").locator(".react-flow__handle.source"), node(page, "n08").locator(".react-flow__handle.target.port-right"));
  await expect(edge(page, "n06", "n08")).toBeVisible();
  await node(page, "n08").click();
  await props(page).getByRole("tab", { name: "Entrées" }).click();
  await expect(props(page).getByLabel(/^Entrée gauche/)).toHaveValue("n01");
  await expect(props(page).getByLabel(/^Entrée droite/)).toHaveValue("n06");
  await props(page).getByRole("tab", { name: "YAML du nœud" }).click();
  await expect(props(page).getByLabel("YAML de n08")).toContainText(/left: n01/);
  await expect(props(page).getByLabel("YAML de n08")).toContainText(/right: n06/);
  await expect(page.getByText(/Enregistré .* \(local\)/)).toBeVisible();
  await page.reload();
  await expect(edge(page, "n01", "n08")).toBeVisible();
  await expect(edge(page, "n06", "n08")).toBeVisible();
}]);

scenarios.push(["[S-UI-103-16] un cycle est refusé et le graphe reste intact", async ({ page }) => {
  await page.getByRole("button", { name: "Ajouter une arête" }).click();
  await node(page, "n05").click();
  await node(page, "n02").click();
  await expect(page.getByRole("alert")).toContainText(/cycle/i);
  await expect(page.getByText("schéma 1 · 7 nœuds · 6 arêtes")).toBeVisible();
}]);

scenarios.push(["[S-UI-103-17] outils de navigation, zoom, ajustement et disposition", async ({ page }) => {
  const select = page.getByRole("button", { name: "Sélection", exact: true });
  const pan = page.getByRole("button", { name: "Déplacer la vue" });
  await pan.click();
  await expect(pan).toHaveAttribute("aria-pressed", "true");
  await select.click();
  await expect(select).toHaveAttribute("aria-pressed", "true");
  const zoom = page.getByLabel("Zoom", { exact: true });
  const before = await zoom.textContent();
  await page.getByRole("button", { name: "Zoom avant" }).click();
  await expect(zoom).not.toHaveText(before!);
  await page.getByRole("button", { name: "Zoom arrière" }).click();
  await expect(zoom).toHaveText(before!);
  await page.getByRole("button", { name: "Ajuster", exact: true }).click();
  await expect(node(page, "n01")).toBeVisible();
  await page.getByRole("button", { name: "Disposition automatique" }).click();
  await page.getByRole("button", { name: "Aligner", exact: true }).click();
  await expect(node(page, "n02")).toBeVisible();
}]);

scenarios.push(["[S-UI-103-63] le YAML édité revient au graphe et survit à la réouverture", async ({ page }) => {
  await node(page, "n03").click();
  await props(page).getByLabel("Libellé", { exact: true }).fill("Calcul modifié");
  await expect(node(page, "n03")).toContainText("Calcul modifié");
  await page.getByRole("button", { name: "Éditer en YAML" }).click();
  const yaml = page.getByRole("textbox", { name: "YAML de Revenu net" });
  // CodeMirror virtualise les lignes : la recherche amène le libellé à l'écran.
  await yaml.focus();
  await page.keyboard.press("ControlOrMeta+f");
  const find = page.getByRole("textbox", { name: "Find", exact: true });
  await find.fill("Calcul modifié");
  await find.press("End");
  await find.press("Enter");
  await expect(yaml).toContainText("Calcul modifié");
  const replace = page.getByRole("textbox", { name: "Replace", exact: true });
  await replace.fill("Calcul depuis YAML");
  await replace.press("End");
  await page.getByRole("button", { name: "replace all", exact: true }).click();
  await expect(yaml).toContainText("Calcul depuis YAML");
  await page.getByRole("button", { name: "close", exact: true }).click();
  await page.getByRole("button", { name: "Revenir au canevas" }).click();
  await expect(node(page, "n03")).toContainText("Calcul depuis YAML");
  await page.reload();
  await expect(node(page, "n03")).toContainText("Calcul depuis YAML");
}]);

scenarios.push(["[S-UI-103-64] dialogue de soumission : validation, annulation et envoi", async ({ page }) => {
  await node(page, "n03").click();
  await props(page).getByLabel("Libellé", { exact: true }).fill("Calcul proposé");
  await expect(bottom(page).getByText("Compilable Databricks, Snowflake")).toBeVisible();
  const open = page.getByRole("button", { name: "Soumettre la proposition" });
  await expect(open).not.toHaveAttribute("aria-disabled", "true");
  await open.click();
  const dialog = page.getByRole("dialog", { name: "Soumettre la proposition" });
  await expect(dialog.getByText("Nouvelle version")).toBeVisible();
  await expect(dialog.getByText("Validations requises")).toBeVisible();
  await dialog.getByRole("button", { name: "Soumettre", exact: true }).click();
  await expect(dialog.getByLabel(/Justification/)).toHaveAttribute("aria-invalid", "true");
  await dialog.getByRole("button", { name: "Annuler" }).click();
  await expect(dialog).toHaveCount(0);
  await open.click();
  await dialog.getByLabel(/Justification/).fill("Préciser le libellé du calcul.");
  await dialog.getByRole("button", { name: "Soumettre", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Proposition n° \d+ créée/ })).toBeVisible();
  await page.getByRole("link", { name: "Voir les propositions" }).click();
  await expect(page.getByText("Préciser le libellé du calcul.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Préciser le libellé du calcul.")).toBeVisible();
}]);

scenarios.push(["[S-UI-103-65] l'outil arête relie deux étapes après déliaison et conserve le résultat", async ({ page }) => {
  await node(page, "n02").click();
  await props(page).getByRole("tab", { name: "Entrées" }).click();
  await props(page).getByRole("combobox", { name: "Entrée requis" }).selectOption("");
  await expect(edge(page, "n01", "n02")).toHaveCount(0);
  await page.getByRole("button", { name: "Ajouter une arête" }).click();
  await node(page, "n01").click();
  await expect(page.getByRole("status").filter({ hasText: /Arête depuis n01/ })).toBeVisible();
  await node(page, "n02").click();
  await expect(edge(page, "n01", "n02")).toBeVisible();
  await page.getByRole("button", { name: "Valider le graphe" }).click();
  await expect(bottom(page).getByText("Compilable Databricks, Snowflake")).toBeVisible();
  await page.getByRole("button", { name: "Sélection", exact: true }).click();
  await node(page, "n02").click();
  await props(page).getByRole("tab", { name: "YAML du nœud" }).click();
  await expect(props(page).getByLabel("YAML de n02")).toContainText(/inputs:\s*\[n01\]/);
  await page.reload();
  await expect(edge(page, "n01", "n02")).toBeVisible();
}]);

scenarios.push(["[S-UI-103-66] supprimer et rétablir une arête au clavier", async ({ page }) => {
  await edge(page, "n01", "n02").focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Delete");
  await expect(edge(page, "n01", "n02")).toHaveCount(0);
  await expect(page.getByText("schéma 1 · 7 nœuds · 5 arêtes")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(edge(page, "n01", "n02")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(edge(page, "n01", "n02")).toHaveCount(0);
  await page.reload();
  await expect(edge(page, "n01", "n02")).toHaveCount(0);
}]);

scenarios.push(["[S-UI-103-67] déplacer puis supprimer un nœud au clavier et annuler", async ({ page }) => {
  const card = node(page, "n03");
  const box = await card.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + 8);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + 68, { steps: 15 });
  await page.mouse.up();
  await expect.poll(async () => (await card.boundingBox())!.y).toBeGreaterThan(box!.y + 10);
  const moved = await card.boundingBox();
  await page.reload();
  await expect.poll(async () => (await card.boundingBox())!.y).toBeGreaterThan(box!.y + 10);
  expect(moved).not.toBeNull();
  await page.getByRole("group", { name: "Calcul de colonne n03" }).focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Delete");
  await expect(card).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(card).toBeVisible();
}]);

for (const [index, name] of ["Référence à un KPI", "Filtre", "Dédoublonnage", "Calcul de colonne", "Opération temporelle", "Jointure", "Union", "Agrégation", "Opération entre métriques"].entries()) {
  scenarios.push([`[S-UI-103-${68 + index}] ajouter ${name} au clavier`, async ({ page }) => {
    const button = page.getByRole("complementary", { name: "Palette des nœuds" }).getByRole("button", { name, exact: true });
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(node(page, "n08")).toBeVisible();
    await expect(props(page).getByRole("heading", { name, exact: true })).toBeVisible();
    await page.reload();
    await expect(node(page, "n08")).toBeVisible();
  }]);
}

scenarios.push(["[S-UI-103-77] propriétés de source : propriétaire, table et colonne temporelle", async ({ page }) => {
  await node(page, "n01").click();
  await props(page).getByRole("textbox", { name: "Table requis" }).fill("gold.finance.factures_test");
  await props(page).getByRole("textbox", { name: "Propriétaire requis" }).fill("claire.test");
  await props(page).getByRole("textbox", { name: "Fuseau d'origine de la colonne 5" }).fill("Europe/London");
  await expect(node(page, "n01")).toContainText("factures_test");
  await props(page).getByRole("tab", { name: "YAML du nœud" }).click();
  const yaml = props(page).getByLabel("YAML de n01");
  await expect(yaml).toContainText("gold.finance.factures_test");
  await expect(yaml).toContainText("claire.test");
  await expect(yaml).toContainText("Europe/London");
  await page.reload();
  await node(page, "n01").click();
  await expect(props(page).getByRole("textbox", { name: "Table requis" })).toHaveValue("gold.finance.factures_test");
  await expect(props(page).getByRole("textbox", { name: "Propriétaire requis" })).toHaveValue("claire.test");
}]);

scenarios.push(["[S-UI-103-78] calcul : libellé, note et expression", async ({ page }) => {
  await node(page, "n03").click();
  await props(page).getByRole("textbox", { name: "Libellé", exact: true }).fill("Montant contrôlé");
  await props(page).getByRole("textbox", { name: "Note (pourquoi ce nœud)" }).fill("Nouvelle règle documentée");
  await props(page).getByRole("textbox", { name: "Expression requis" }).fill("montant_ttc - montant_taxes");
  await expect(node(page, "n03")).toContainText("montant_ttc - montant_taxes");
  await props(page).getByRole("tab", { name: "YAML du nœud" }).click();
  await expect(props(page).getByLabel("YAML de n03")).toContainText("Nouvelle règle documentée");
  await expect(props(page).getByLabel("YAML de n03")).toContainText("montant_ttc - montant_taxes");
  await page.reload();
  await node(page, "n03").click();
  await expect(props(page).getByRole("textbox", { name: "Libellé", exact: true })).toHaveValue("Montant contrôlé");
}]);

scenarios.push(["[S-UI-103-79] rechercher un type dans la palette et effacer la recherche", async ({ page }) => {
  const palette = page.getByRole("complementary", { name: "Palette des nœuds" });
  const search = palette.getByRole("searchbox", { name: "Rechercher un nœud" });
  await search.fill("jointure");
  await expect(palette.getByRole("button", { name: "Jointure", exact: true })).toBeVisible();
  await expect(palette.getByRole("button", { name: "Filtre", exact: true })).toHaveCount(0);
  await search.fill("introuvable xyz");
  await expect(palette.getByText("Aucun nœud ne correspond.")).toBeVisible();
  await search.clear();
  await expect(palette.getByRole("button", { name: "Filtre", exact: true })).toBeVisible();
}]);

scenarios.push(["[S-UI-103-80] filtre : expression SQL et valeurs nulles", async ({ page }) => {
  await node(page, "n02").click();
  await props(page).getByRole("radio", { name: "Expression SQL" }).check();
  await props(page).getByRole("textbox", { name: "Expression requis" }).fill("statut = 'validée'");
  await props(page).getByRole("radio", { name: "gardées" }).check();
  await props(page).getByRole("tab", { name: "YAML du nœud" }).click();
  await expect(props(page).getByLabel("YAML de n02")).toContainText("statut = 'validée'");
  await expect(props(page).getByLabel("YAML de n02")).toContainText("nulls: keep");
  await page.getByRole("button", { name: "Valider le graphe" }).click();
  await expect(bottom(page).getByText("Compilable Databricks, Snowflake")).toBeVisible();
  await page.reload();
  await node(page, "n02").click();
  await expect(props(page).getByRole("radio", { name: "gardées" })).toBeChecked();
}]);

scenarios.push(["[S-UI-103-81] brouillon : confirmation de reprise, Échap et abandon", async ({ page }) => {
  await node(page, "n03").click();
  await props(page).getByRole("textbox", { name: "Libellé", exact: true }).fill("Brouillon à reprendre");
  await expect(node(page, "n03")).toContainText("Brouillon à reprendre");
  await page.reload();
  await expect(node(page, "n03")).toContainText("Brouillon à reprendre");
  const restart = page.getByRole("button", { name: "Repartir de la v4" });
  await restart.click();
  const dialog = page.getByRole("alertdialog", { name: "Repartir de la v4 ?" });
  await expect(dialog.getByRole("button", { name: "Annuler" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(restart).toBeFocused();
  await expect(node(page, "n03")).toContainText("Brouillon à reprendre");
  await restart.click();
  await dialog.getByRole("button", { name: "Supprimer le brouillon" }).click();
  await expect(node(page, "n03")).toContainText("déduction des taxes");
  await page.reload();
  await expect(node(page, "n03")).toContainText("déduction des taxes");
}]);

scenarios.push(["[S-UI-103-82] YAML illisible : retour bloqué puis correction", async ({ page }) => {
  await page.getByRole("button", { name: "Éditer en YAML" }).click();
  const yaml = page.getByRole("textbox", { name: "YAML de Revenu net" });
  await yaml.focus();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.insertText("\nlabel: [inachevé");
  const back = page.getByRole("button", { name: "Revenir au canevas" });
  await expect(back).toHaveAttribute("aria-disabled", "true");
  await expect(yaml).toBeVisible();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(back).not.toHaveAttribute("aria-disabled", "true");
  await back.click();
  await expect(node(page, "n01")).toBeVisible();
}]);

scenarios.push(["[S-UI-103-83] validation indisponible : erreur visible et brouillon conservé", async ({ page }) => {
  await page.route("**/editor/check", route => route.fulfill({ status: 503, json: { detail: { code: "unavailable", message: "Validation indisponible" } } }));
  await node(page, "n03").click();
  await props(page).getByRole("textbox", { name: "Libellé", exact: true }).fill("Conservé malgré la panne");
  await page.getByRole("button", { name: "Valider le graphe" }).click();
  await expect(page.getByRole("alert")).toContainText(/validation|indisponible|échoué/i);
  await expect(page.getByRole("button", { name: "Soumettre la proposition" })).toHaveAttribute("aria-disabled", "true");
  await page.unroute("**/editor/check");
  await page.reload();
  await expect(node(page, "n03")).toContainText("Conservé malgré la panne");
  await page.getByRole("button", { name: "Valider le graphe" }).click();
  await expect(bottom(page).getByText("Compilable Databricks, Snowflake")).toBeVisible();
}]);

scenarios.push(["[S-UI-103-84] jointure : type, cardinalité et justification du contournement", async ({ page }) => {
  await node(page, "n07").click();
  await props(page).getByRole("combobox", { name: /Type de jointure/ }).selectOption("left");
  await props(page).getByRole("radio", { name: "contourné" }).check();
  const errors = bottom(page).getByRole("listitem").filter({ hasText: "ERREUR" });
  await expect(errors.first()).toBeVisible();
  await props(page).getByRole("textbox", { name: /Raison du contournement/ }).fill("Contrôle assuré en amont.");
  await expect(bottom(page).getByRole("listitem").filter({ hasText: "Contrôle de cardinalité contourné" })).toBeVisible();
  await props(page).getByRole("tab", { name: "YAML du nœud" }).click();
  await expect(props(page).getByLabel("YAML de n07")).toContainText("Contrôle assuré en amont.");
  await page.reload();
  await node(page, "n07").click();
  await expect(props(page).getByRole("radio", { name: "contourné" })).toBeChecked();
}]);

scenarios.push(["[S-UI-103-85] agrégation : modifier la fonction et la mesure", async ({ page }) => {
  await node(page, "n05").click();
  await props(page).getByRole("combobox", { name: "Fonction de la mesure 1" }).selectOption("avg");
  await props(page).getByRole("textbox", { name: "Colonne produite par la mesure 1" }).fill("moyenne_nette");
  await expect(node(page, "n05")).toContainText(/AVG/i);
  await props(page).getByRole("tab", { name: "YAML du nœud" }).click();
  await expect(props(page).getByLabel("YAML de n05")).toContainText("moyenne_nette");
  await page.reload();
  await node(page, "n05").click();
  await expect(props(page).getByRole("textbox", { name: "Colonne produite par la mesure 1" })).toHaveValue("moyenne_nette");
}]);

scenarios.push(["[S-UI-103-86] opération temporelle : grain et colonne produite", async ({ page }) => {
  await node(page, "n04").click();
  await props(page).getByRole("textbox", { name: /Colonne produite/ }).fill("trimestre_fiscal");
  await props(page).getByRole("combobox", { name: /Grain/ }).selectOption("quarter");
  await expect(node(page, "n04")).toContainText("trimestre_fiscal");
  await props(page).getByRole("tab", { name: "YAML du nœud" }).click();
  await expect(props(page).getByLabel("YAML de n04")).toContainText("trimestre_fiscal");
  await expect(props(page).getByLabel("YAML de n04")).toContainText("quarter");
  await page.reload();
  await node(page, "n04").click();
  await expect(props(page).getByRole("textbox", { name: /Colonne produite/ })).toHaveValue("trimestre_fiscal");
}]);

scenarios.push(["[S-UI-103-87] référence KPI : choisir le KPI et une version inexistante puis corriger", async ({ page }) => {
  await page.getByRole("complementary", { name: "Palette des nœuds" }).getByRole("button", { name: "Référence à un KPI" }).click();
  await props(page).getByRole("combobox", { name: /KPI référencé/ }).selectOption("taux-de-service");
  await props(page).getByRole("spinbutton", { name: /Version/ }).fill("99");
  await expect(bottom(page).getByRole("listitem").filter({ hasText: "introuvable" })).toBeVisible();
  await props(page).getByRole("spinbutton", { name: /Version/ }).fill("2");
  await expect(bottom(page).getByRole("listitem").filter({ hasText: "introuvable" })).toHaveCount(0);
  await props(page).getByRole("tab", { name: "YAML du nœud" }).click();
  await expect(props(page).getByLabel("YAML de n08")).toContainText("taux-de-service");
  await page.reload();
  await node(page, "n08").click();
  await expect(props(page).getByRole("spinbutton", { name: /Version/ })).toHaveValue("2");
}]);

scenarios.push(["[S-UI-103-88] surcharge : structure verrouillée, remplacement et retrait", async ({ page }) => {
  const back = await page.getByRole("link", { name: "Revenu net", exact: true }).getAttribute("href");
  expect(back).not.toBeNull();
  const root = back!.split("/fiche/")[0];
  await page.goto(`${root}/editeur?from=revenu-net--nordis-fr`);
  await expect(page.getByRole("heading", { level: 1, name: /v3 · brouillon/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ajouter une arête" })).toBeDisabled();
  await expect(page.getByRole("complementary", { name: "Palette des nœuds" }).getByRole("button", { name: "Filtre", exact: true })).toBeDisabled();
  await node(page, "n02").click();
  await expect(props(page).getByRole("textbox", { name: /Valeur/ })).not.toBeEditable();
  await props(page).getByRole("button", { name: "Remplacer ce nœud" }).click();
  await expect(props(page).getByText("Hors points déclarés : la validation canonique s'appliquera")).toBeVisible();
  await props(page).getByRole("textbox", { name: /Valeur/ }).fill("validée,expédiée");
  await props(page).getByRole("textbox", { name: /Justification de la surcharge/ }).fill("Inclure les ventes expédiées.");
  await page.reload();
  await node(page, "n02").click();
  await expect(props(page).getByRole("textbox", { name: /Justification de la surcharge/ })).toHaveValue("Inclure les ventes expédiées.");
  await props(page).getByRole("button", { name: "Retirer la surcharge" }).click();
  await expect(props(page).getByRole("textbox", { name: /Valeur/ })).not.toBeEditable();
}]);

scenarios.push(["[S-UI-103-89] Échap annule le départ d'une arête", async ({ page }) => {
  await page.getByRole("button", { name: "Ajouter une arête" }).click();
  await node(page, "n01").click();
  await expect(page.getByRole("status").filter({ hasText: "Arête depuis n01" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("status").filter({ hasText: "Cliquer le nœud de départ" })).toBeVisible();
  await expect(page.getByText("schéma 1 · 7 nœuds · 6 arêtes")).toBeVisible();
}]);

scenarios.push(["[S-UI-103-90] outil main : déplacer la vue puis revenir", async ({ page }) => {
  const canvas = page.getByRole("group", { name: "Graphe de Revenu net" });
  const before = await node(page, "n01").boundingBox();
  const surface = await canvas.boundingBox();
  expect(before).not.toBeNull(); expect(surface).not.toBeNull();
  await page.getByRole("button", { name: "Déplacer la vue" }).click();
  await page.mouse.move(surface!.x + 25, surface!.y + 25);
  await page.mouse.down();
  await page.mouse.move(surface!.x + 95, surface!.y + 65, { steps: 15 });
  await page.mouse.up();
  await expect.poll(async () => (await node(page, "n01").boundingBox())!.x).toBeGreaterThan(before!.x + 20);
  await page.getByRole("button", { name: "Ajuster", exact: true }).click();
  await expect(node(page, "n01")).toBeVisible();
}]);

scenarios.push(["[S-UI-103-91] dupliquer un nœud puis retirer la copie", async ({ page }) => {
  await node(page, "n03").click();
  await props(page).getByRole("button", { name: "Dupliquer" }).click();
  await expect(node(page, "n08")).toBeVisible();
  await expect(props(page).getByRole("heading", { name: "Calcul de colonne" })).toBeVisible();
  await props(page).getByRole("tab", { name: "YAML du nœud" }).click();
  await expect(props(page).getByLabel("YAML de n08")).toContainText("montant_ht");
  await page.reload();
  await expect(node(page, "n08")).toBeVisible();
  await node(page, "n08").click();
  await props(page).getByRole("button", { name: "Supprimer", exact: true }).click();
  await expect(node(page, "n08")).toHaveCount(0);
  await expect(node(page, "n03")).toBeVisible();
}]);

scenarios.push(["[S-UI-103-92] source : ajouter puis retirer une colonne temporelle", async ({ page }) => {
  await node(page, "n01").click();
  await props(page).getByRole("button", { name: "Ajouter une colonne" }).click();
  await props(page).getByRole("textbox", { name: "Nom de la colonne 9" }).fill("date_recue");
  await props(page).getByRole("combobox", { name: "Type de la colonne 9" }).selectOption("date");
  await props(page).getByRole("textbox", { name: "Fuseau d'origine de la colonne 9" }).fill("Europe/Paris");
  await props(page).getByRole("textbox", { name: "Format de la colonne 9" }).fill("yyyy-MM-dd");
  await props(page).getByRole("tab", { name: "YAML du nœud" }).click();
  await expect(props(page).getByLabel("YAML de n01")).toContainText("date_recue");
  await page.reload();
  await node(page, "n01").click();
  await expect(props(page).getByRole("textbox", { name: "Nom de la colonne 9" })).toHaveValue("date_recue");
  await props(page).getByRole("button", { name: "Retirer la ligne 9 : Colonnes" }).click();
  await expect(props(page).getByRole("textbox", { name: "Nom de la colonne 9" })).toHaveCount(0);
}]);

scenarios.push(["[S-UI-103-93] jointure : modifier puis rétablir les deux entrées", async ({ page }) => {
  await node(page, "n07").click();
  await props(page).getByRole("tab", { name: "Entrées" }).click();
  const left = props(page).getByRole("combobox", { name: "Entrée gauche requis" });
  const right = props(page).getByRole("combobox", { name: "Entrée droite requis" });
  await expect(left).toHaveValue("n03");
  await expect(right).toHaveValue("n06");
  await left.selectOption("n01");
  await expect(edge(page, "n01", "n07")).toBeVisible();
  await expect(edge(page, "n03", "n07")).toHaveCount(0);
  await props(page).getByRole("tab", { name: "YAML du nœud" }).click();
  await expect(props(page).getByLabel("YAML de n07")).toContainText(/left: n01/);
  await page.getByRole("button", { name: "Annuler", exact: true }).click();
  await expect(edge(page, "n03", "n07")).toBeVisible();
}]);

scenarios.push(["[S-UI-103-94] filtre : changer colonne, opérateur et valeur puis restaurer", async ({ page }) => {
  await node(page, "n02").click();
  await props(page).getByRole("combobox", { name: /Colonne requis/ }).selectOption("entite");
  await props(page).getByRole("combobox", { name: /Opérateur/ }).selectOption("equals");
  await props(page).getByRole("textbox", { name: /Valeur/ }).fill("nordis-fr");
  await expect(node(page, "n02")).toContainText("entite");
  await props(page).getByRole("tab", { name: "YAML du nœud" }).click();
  await expect(props(page).getByLabel("YAML de n02")).toContainText("nordis-fr");
  await page.reload();
  await node(page, "n02").click();
  await expect(props(page).getByRole("textbox", { name: /Valeur/ })).toHaveValue("nordis-fr");
}]);

scenarios.push(["[S-UI-103-95] union : ordonner ses entrées et faire correspondre les colonnes", async ({ page }) => {
  await node(page, "n01").click();
  await page.getByRole("complementary", { name: "Palette des nœuds" }).getByRole("button", { name: "Union", exact: true }).click();
  await props(page).getByRole("tab", { name: "Entrées" }).click();
  await props(page).getByRole("button", { name: "Ajouter une entrée" }).click();
  await props(page).getByRole("combobox", { name: "Entrée 2" }).selectOption("n06");
  await props(page).getByRole("button", { name: "Descendre l'entrée n01" }).click();
  await expect(props(page).getByRole("combobox", { name: "Entrée 1" })).toHaveValue("n06");
  await props(page).getByRole("tab", { name: "Propriétés" }).click();
  await props(page).getByRole("radio", { name: /sans doublons/ }).check();
  await props(page).getByRole("button", { name: "Ajouter une colonne" }).click();
  await props(page).getByRole("textbox", { name: "Colonne produite 1" }).fill("jour");
  await props(page).getByRole("combobox", { name: "Colonne de n06 pour la ligne 1" }).selectOption("date_jour");
  await props(page).getByRole("combobox", { name: "Colonne de n01 pour la ligne 1" }).selectOption("date_facture");
  await props(page).getByRole("tab", { name: "YAML du nœud" }).click();
  await expect(props(page).getByLabel("YAML de n08")).toContainText("jour");
  await expect(props(page).getByLabel("YAML de n08")).toContainText("distinct");
  await page.reload();
  await node(page, "n08").click();
  await expect(props(page).getByRole("radio", { name: /sans doublons/ })).toBeChecked();
}]);

scenarios.push(["[S-UI-103-96] dédoublonnage : clés et ordre de la ligne gardée", async ({ page }) => {
  await node(page, "n01").click();
  await page.getByRole("complementary", { name: "Palette des nœuds" }).getByRole("button", { name: "Dédoublonnage", exact: true }).click();
  await props(page).getByRole("checkbox", { name: "facture_id" }).check();
  await props(page).getByRole("button", { name: "Ajouter un critère" }).click();
  await props(page).getByRole("combobox", { name: "Colonne du critère 1" }).selectOption("date_facture");
  await props(page).getByRole("combobox", { name: "Sens du critère 1" }).selectOption("desc");
  await props(page).getByRole("tab", { name: "YAML du nœud" }).click();
  await expect(props(page).getByLabel("YAML de n08")).toContainText("facture_id");
  await expect(props(page).getByLabel("YAML de n08")).toContainText("date_facture");
  await page.reload();
  await node(page, "n08").click();
  await expect(props(page).getByRole("checkbox", { name: "facture_id" })).toBeChecked();
}]);

scenarios.push(["[S-UI-103-97] supprimer une arête par une commande accessible", async ({ page }) => {
  await edge(page, "n01", "n02").focus();
  await page.keyboard.press("Enter");
  const removeEdge = page.getByRole("button", { name: /Supprimer (l')?arête/i });
  await expect(removeEdge).toBeVisible();
  await removeEdge.click();
  await expect(edge(page, "n01", "n02")).toHaveCount(0);
  await page.reload();
  await expect(edge(page, "n01", "n02")).toHaveCount(0);
}]);

scenarios.push(["[S-UI-103-98] métriques : expression et ordre calcul agrégation", async ({ page }) => {
  await node(page, "n05").click();
  await page.getByRole("complementary", { name: "Palette des nœuds" }).getByRole("button", { name: "Opération entre métriques", exact: true }).click();
  await props(page).getByRole("button", { name: "Ajouter une métrique" }).click();
  await props(page).getByRole("textbox", { name: "Nom de la métrique 1" }).fill("revenu_milliers");
  await props(page).getByRole("textbox", { name: "Expression de la métrique 1" }).fill("revenu_net / 1000");
  await props(page).getByRole("radio", { name: "agréger puis calculer" }).check();
  await props(page).getByRole("tab", { name: "YAML du nœud" }).click();
  await expect(props(page).getByLabel("YAML de n08")).toContainText("revenu_milliers");
  await expect(props(page).getByLabel("YAML de n08")).toContainText("revenu_net / 1000");
  await page.reload();
  await node(page, "n08").click();
  await expect(props(page).getByRole("radio", { name: "agréger puis calculer" })).toBeChecked();
}]);

scenarios.push(["[S-UI-103-99] propriétés du document et validation du fuseau", async ({ page }) => {
  await props(page).getByRole("textbox", { name: "Description" }).fill("Description revue pour le KPI.");
  await props(page).getByRole("button", { name: "Ajouter un synonyme" }).click();
  await props(page).getByRole("textbox", { name: "Synonyme 3" }).fill("recettes nettes");
  await props(page).getByRole("combobox", { name: /Calendrier/ }).selectOption("civil");
  await props(page).getByRole("textbox", { name: /Fuseau horaire/ }).fill("Fuseau/Inexistant");
  await page.getByRole("button", { name: "Valider le graphe" }).click();
  await expect(bottom(page).getByText("Schéma invalide")).toBeVisible();
  await props(page).getByRole("textbox", { name: /Fuseau horaire/ }).fill("Europe/Paris");
  await props(page).getByRole("textbox", { name: "Devise" }).fill("USD");
  await page.getByRole("button", { name: "Valider le graphe" }).click();
  await expect(bottom(page).getByText("Schéma valide")).toBeVisible();
  await page.reload();
  await expect(props(page).getByRole("textbox", { name: "Synonyme 3" })).toHaveValue("recettes nettes");
  await expect(props(page).getByRole("textbox", { name: "Devise" })).toHaveValue("USD");
}]);

scenarios.push(["[S-UI-103-100] joindre par l'outil arête deux sources aux côtés gauche et droit", async ({ page }) => {
  const palette = page.getByRole("complementary", { name: "Palette des nœuds" });
  await drag(page, palette.getByRole("button", { name: "Jointure", exact: true }), page.getByRole("group", { name: "Graphe de Revenu net" }));
  await page.getByRole("button", { name: "Ajouter une arête" }).click();
  await node(page, "n01").click(); await node(page, "n08").click();
  await expect(edge(page, "n01", "n08")).toBeVisible();
  await node(page, "n06").click(); await node(page, "n08").click();
  await expect(edge(page, "n06", "n08")).toBeVisible();
  await page.getByRole("button", { name: "Sélection", exact: true }).click();
  await node(page, "n08").click();
  await props(page).getByRole("tab", { name: "Entrées" }).click();
  await expect(props(page).getByRole("combobox", { name: "Entrée gauche requis" })).toHaveValue("n01");
  await expect(props(page).getByRole("combobox", { name: "Entrée droite requis" })).toHaveValue("n06");
  await page.reload();
  await expect(edge(page, "n01", "n08")).toBeVisible();
  await expect(edge(page, "n06", "n08")).toBeVisible();
}]);

scenarios.push(["[S-UI-103-101] propriétés communes : variation, sortie et note", async ({ page }) => {
  await node(page, "n02").click();
  await props(page).getByRole("textbox", { name: "Libellé", exact: true }).fill("Filtre de démonstration");
  await props(page).getByRole("textbox", { name: "Note (pourquoi ce nœud)" }).fill("Vérification des factures.");
  await props(page).getByRole("checkbox", { name: /Point de variation/ }).check();
  await expect(node(page, "n02")).toContainText("Variation");
  await props(page).getByRole("button", { name: "Définir comme sortie du graphe" }).click();
  await expect(node(page, "n02")).toContainText("sortie du graphe");
  await props(page).getByRole("tab", { name: "YAML du nœud" }).click();
  await expect(props(page).getByLabel("YAML de n02")).toContainText("Vérification des factures.");
  await page.reload();
  await expect(node(page, "n02")).toContainText("sortie du graphe");
  await node(page, "n02").click();
  await expect(props(page).getByRole("checkbox", { name: /Point de variation/ })).toBeChecked();
}]);

scenarios.push(["[S-UI-103-102] une erreur conduit au nœud et disparaît après correction", async ({ page }) => {
  await node(page, "n01").click();
  await props(page).getByRole("textbox", { name: "Propriétaire requis" }).clear();
  await page.getByRole("button", { name: "Valider le graphe" }).click();
  const issue = bottom(page).getByRole("listitem").filter({ hasText: "n01" }).filter({ hasText: "ERREUR" });
  await expect(issue.first()).toBeVisible();
  await node(page, "n03").click();
  await issue.first().getByRole("button", { name: "Aller au nœud n01" }).click();
  await expect(props(page).getByRole("heading", { name: "Source" })).toBeVisible();
  await props(page).getByRole("textbox", { name: "Propriétaire requis" }).fill("claire.m");
  await page.getByRole("button", { name: "Valider le graphe" }).click();
  await expect(issue).toHaveCount(0);
  await expect(bottom(page).getByText("Schéma valide")).toBeVisible();
}]);

scenarios.push(["[S-UI-103-103] annuler et rétablir une modification de champ", async ({ page }) => {
  await node(page, "n03").click();
  const label = props(page).getByRole("textbox", { name: "Libellé", exact: true });
  await label.fill("Libellé temporaire");
  await expect(node(page, "n03")).toContainText("Libellé temporaire");
  await page.getByRole("button", { name: "Annuler", exact: true }).click();
  await expect(label).toHaveValue("déduction des taxes");
  await page.getByRole("button", { name: "Rétablir", exact: true }).click();
  await expect(label).toHaveValue("Libellé temporaire");
  await page.reload();
  await expect(node(page, "n03")).toContainText("Libellé temporaire");
}]);

scenarios.push(["[S-UI-103-104] quitter aussitôt après modification et reprendre le brouillon", async ({ page }) => {
  await node(page, "n03").click();
  await props(page).getByRole("textbox", { name: "Libellé", exact: true }).fill("Départ immédiat");
  await page.getByRole("link", { name: "Revenu net", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Revenu net" })).toBeVisible();
  await page.getByRole("link", { name: "Proposer une modification" }).click();
  await expect(node(page, "n03")).toContainText("Départ immédiat");
  await page.reload();
  await expect(node(page, "n03")).toContainText("Départ immédiat");
}]);

scenarios.push(["[S-UI-103-105] envoi indisponible : erreur, brouillon puis nouvelle tentative", async ({ page }) => {
  await node(page, "n03").click();
  await props(page).getByRole("textbox", { name: "Libellé", exact: true }).fill("Règle à soumettre");
  await expect(bottom(page).getByText("Compilable Databricks, Snowflake")).toBeVisible();
  const open = page.getByRole("button", { name: "Soumettre la proposition" });
  await expect(open).not.toHaveAttribute("aria-disabled", "true");
  await open.click();
  const dialog = page.getByRole("dialog", { name: "Soumettre la proposition" });
  await expect(dialog.getByText("Nouvelle version")).toBeVisible();
  await dialog.getByRole("textbox", { name: /Justification/ }).fill("Changement proposé.");
  await page.route("**/proposals", route => route.request().method() === "POST" ? route.fulfill({ status: 503, json: { detail: { code: "unavailable", message: "Envoi indisponible" } } }) : route.continue());
  await dialog.getByRole("button", { name: "Soumettre", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText(/indisponible|échoué/i);
  await dialog.getByRole("button", { name: "Annuler" }).click();
  await page.unroute("**/proposals");
  await page.reload();
  await expect(node(page, "n03")).toContainText("Règle à soumettre");
  await expect(open).not.toHaveAttribute("aria-disabled", "true");
  await open.click();
  await dialog.getByRole("textbox", { name: /Justification/ }).fill("Changement proposé.");
  await dialog.getByRole("button", { name: "Soumettre", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Proposition n° \d+ créée/ })).toBeVisible();
}]);

scenarios.push(["[S-UI-103-106] source : plateforme, table et propriétaire dans le graphe et le YAML", async ({ page }) => {
  await node(page, "n01").click();
  await props(page).getByRole("combobox", { name: /Plateforme/ }).selectOption("snowflake");
  await props(page).getByRole("textbox", { name: /Table requis/ }).fill("ANALYTICS.FINANCE.FACTURES");
  await props(page).getByRole("textbox", { name: /Propriétaire requis/ }).fill("owner.test");
  await expect(node(page, "n01")).toContainText("FACTURES");
  await props(page).getByRole("tab", { name: "YAML du nœud" }).click();
  const yaml = props(page).getByLabel("YAML de n01");
  await expect(yaml).toContainText("snowflake");
  await expect(yaml).toContainText("ANALYTICS.FINANCE.FACTURES");
  await expect(yaml).toContainText("owner.test");
  await page.reload();
  await node(page, "n01").click();
  await expect(props(page).getByRole("combobox", { name: /Plateforme/ })).toHaveValue("snowflake");
  await expect(props(page).getByRole("textbox", { name: /Table requis/ })).toHaveValue("ANALYTICS.FINANCE.FACTURES");
}]);

scenarios.push(["[S-UI-103-107] jointure : clés, cardinalité et contrôle requis", async ({ page }) => {
  await node(page, "n07").click();
  await props(page).getByRole("combobox", { name: "Clé gauche 1" }).selectOption("date_facture");
  await props(page).getByRole("combobox", { name: "Clé droite 1" }).selectOption("date_jour");
  await props(page).getByRole("radio", { name: "1:1", exact: true }).check();
  await props(page).getByRole("radio", { name: "requis", exact: true }).check();
  await expect(node(page, "n07")).toContainText("1:1");
  await props(page).getByRole("tab", { name: "YAML du nœud" }).click();
  await expect(props(page).getByLabel("YAML de n07")).toContainText("1:1");
  await page.reload();
  await node(page, "n07").click();
  await expect(props(page).getByRole("radio", { name: "1:1", exact: true })).toBeChecked();
}]);

scenarios.push(["[S-UI-103-108] calcul : colonne, expression et type", async ({ page }) => {
  await node(page, "n03").click();
  await props(page).getByRole("textbox", { name: /Colonne produite/ }).fill("montant_calcule");
  await props(page).getByRole("textbox", { name: /Expression requis/ }).fill("montant_ttc - montant_taxes");
  await props(page).getByRole("combobox", { name: "Type de la colonne" }).selectOption("double");
  await expect(node(page, "n03")).toContainText("montant_calcule");
  await props(page).getByRole("tab", { name: "YAML du nœud" }).click();
  const yaml = props(page).getByLabel("YAML de n03");
  await expect(yaml).toContainText("montant_calcule");
  await expect(yaml).toContainText("double");
  await page.reload();
  await node(page, "n03").click();
  await expect(props(page).getByRole("combobox", { name: "Type de la colonne" })).toHaveValue("double");
}]);

scenarios.push(["[S-UI-103-109] agrégation : modifier la granularité puis la rétablir", async ({ page }) => {
  await node(page, "n05").click();
  const entity = props(page).getByRole("checkbox", { name: "entite", exact: true });
  await expect(entity).toBeChecked();
  await entity.uncheck();
  await props(page).getByRole("tab", { name: "YAML du nœud" }).click();
  await expect(props(page).getByLabel("YAML de n05")).not.toContainText("entite");
  await page.reload();
  await node(page, "n05").click();
  await expect(props(page).getByRole("checkbox", { name: "entite", exact: true })).not.toBeChecked();
  await props(page).getByRole("checkbox", { name: "entite", exact: true }).check();
  await expect(props(page).getByRole("checkbox", { name: "entite", exact: true })).toBeChecked();
}]);

scenarios.push(["[S-UI-103-110] métrique calculée ligne à ligne puis agrégée", async ({ page }) => {
  await node(page, "n01").click();
  await page.getByRole("complementary", { name: "Palette des nœuds" }).getByRole("button", { name: "Opération entre métriques", exact: true }).click();
  await props(page).getByRole("button", { name: "Ajouter une métrique" }).click();
  await props(page).getByRole("textbox", { name: "Nom de la métrique 1" }).fill("montant_net");
  await props(page).getByRole("textbox", { name: "Expression de la métrique 1" }).fill("montant_ttc - montant_taxes");
  await props(page).getByRole("radio", { name: /calculer ligne à ligne/ }).check();
  await props(page).getByRole("button", { name: "Ajouter une mesure" }).click();
  await props(page).getByRole("combobox", { name: "Colonne source de la mesure 1" }).selectOption("montant_net");
  await props(page).getByRole("textbox", { name: "Colonne produite par la mesure 1" }).fill("net_total");
  await props(page).getByRole("combobox", { name: "Fonction de la mesure 1" }).selectOption("sum");
  await props(page).getByRole("tab", { name: "YAML du nœud" }).click();
  const yaml = props(page).getByLabel("YAML de n08");
  await expect(yaml).toContainText("rows_first");
  await expect(yaml).toContainText("net_total");
  await page.reload();
  await node(page, "n08").click();
  await expect(props(page).getByRole("radio", { name: /calculer ligne à ligne/ })).toBeChecked();
}]);

scenarios.push(["[S-UI-103-111] connexion : annuler et rétablir", async ({ page }) => {
  await node(page, "n02").click();
  await props(page).getByRole("tab", { name: "Entrées" }).click();
  await props(page).getByRole("combobox", { name: "Entrée requis" }).selectOption("");
  await expect(edge(page, "n01", "n02")).toHaveCount(0);
  await page.getByRole("button", { name: "Annuler", exact: true }).click();
  await expect(edge(page, "n01", "n02")).toBeVisible();
  await page.getByRole("button", { name: "Rétablir", exact: true }).click();
  await expect(edge(page, "n01", "n02")).toHaveCount(0);
  await page.reload();
  await expect(edge(page, "n01", "n02")).toHaveCount(0);
}]);

scenarios.push(["[S-UI-103-112] soumission : récapitulatif des écarts et annulation", async ({ page }) => {
  await node(page, "n03").click();
  await props(page).getByRole("textbox", { name: "Libellé", exact: true }).fill("Déduction documentée");
  const submit = page.getByRole("button", { name: "Soumettre la proposition" });
  await expect(submit).not.toHaveAttribute("aria-disabled", "true");
  await submit.click();
  const dialog = page.getByRole("dialog", { name: "Soumettre la proposition" });
  await expect(dialog.getByText("Validations requises")).toBeVisible();
  await expect(dialog.getByRole("region", { name: "Écarts" })).toBeVisible();
  await dialog.getByRole("button", { name: "Annuler" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(node(page, "n03")).toContainText("Déduction documentée");
  await page.reload();
  await expect(node(page, "n03")).toContainText("Déduction documentée");
}]);

scenarios.push(["[S-UI-103-113] opérations temporelles : dates, fuseaux et fenêtre", async ({ page }) => {
  await node(page, "n04").click();
  const operation = props(page).getByRole("combobox", { name: /Opération/ });
  await operation.selectOption("to_date");
  await props(page).getByRole("textbox", { name: /Fuseau d'évaluation/ }).fill("Europe/Paris");
  await props(page).getByRole("textbox", { name: "Format", exact: true }).fill("yyyy-MM-dd");
  await props(page).getByRole("tab", { name: "YAML du nœud" }).click();
  await expect(props(page).getByLabel("YAML de n04")).toContainText("Europe/Paris");
  await props(page).getByRole("tab", { name: "Propriétés" }).click();
  await operation.selectOption("convert_timezone");
  await props(page).getByRole("textbox", { name: /Fuseau cible/ }).fill("Europe/London");
  await props(page).getByRole("tab", { name: "YAML du nœud" }).click();
  await expect(props(page).getByLabel("YAML de n04")).toContainText("Europe/London");
  await props(page).getByRole("tab", { name: "Propriétés" }).click();
  await operation.selectOption("window");
  await props(page).getByRole("combobox", { name: /Colonne source/ }).selectOption("montant_ttc");
  await props(page).getByRole("combobox", { name: /Fonction/ }).selectOption("sum");
  await props(page).getByRole("checkbox", { name: "entite", exact: true }).check();
  await props(page).getByRole("textbox", { name: /Fenêtre/ }).fill("ROWS BETWEEN 2 PRECEDING AND CURRENT ROW");
  await props(page).getByRole("button", { name: "Ajouter un critère" }).click();
  await props(page).getByRole("combobox", { name: "Colonne du critère 1" }).selectOption("date_facture");
  await props(page).getByRole("combobox", { name: "Sens du critère 1" }).selectOption("asc");
  await props(page).getByRole("tab", { name: "YAML du nœud" }).click();
  await expect(props(page).getByLabel("YAML de n04")).toContainText("ROWS BETWEEN 2 PRECEDING AND CURRENT ROW");
  await page.reload();
  await node(page, "n04").click();
  await expect(operation).toHaveValue("window");
}]);

scenarios.push(["[S-UI-103-114] éditeur indisponible puis réouverture", async ({ page }) => {
  const url = "**/editor/documents/revenu-net";
  await page.route(url, route => route.fulfill({ status: 503, json: { detail: { code: "unavailable", message: "Éditeur indisponible" } } }));
  await page.reload();
  await expect(page.getByRole("alert")).toContainText(/indisponible|échoué/i);
  await page.unroute(url);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Revenu net : v5 · brouillon" })).toBeVisible();
  await expect(node(page, "n03")).toBeVisible();
}]);

scenarios.push(["[S-UI-103-115] éditeur hors ligne puis réouverture", async ({ page }) => {
  const url = "**/editor/documents/revenu-net";
  await page.route(url, route => route.abort("connectionrefused"));
  await page.reload();
  await expect(page.getByRole("alert")).toContainText(/injoignable|indisponible/i);
  await page.unroute(url);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Revenu net : v5 · brouillon" })).toBeVisible();
}]);

scenarios.push(["[S-UI-103-116] verrouiller le dialogue pendant un envoi vers un serveur injoignable", async ({ page }) => {
  await node(page, "n03").click();
  await props(page).getByRole("textbox", { name: "Libellé", exact: true }).fill("Proposition en attente");
  const open = page.getByRole("button", { name: "Soumettre la proposition" });
  await expect(open).not.toHaveAttribute("aria-disabled", "true");
  await open.click();
  const dialog = page.getByRole("dialog", { name: "Soumettre la proposition" });
  await expect(dialog.getByText("Nouvelle version")).toBeVisible();
  const justification = dialog.getByRole("textbox", { name: /Justification/ });
  await justification.fill("Vérifier le verrouillage de l'envoi.");
  let release!: () => void;
  const connectionLost = new Promise<void>(resolve => { release = resolve; });
  const attempted = page.waitForRequest(req => req.url().endsWith("/proposals") && req.method() === "POST");
  await page.route("**/proposals", async route => {
    if (route.request().method() !== "POST") return route.continue();
    await connectionLost;
    await route.abort("connectionfailed");
  });
  try {
    await dialog.getByRole("button", { name: "Soumettre", exact: true }).click();
    await attempted;
    await expect(dialog.getByRole("button", { name: "Envoi…" })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "Annuler" })).toBeDisabled();
    await expect(justification).not.toBeEditable();
  } finally {
    release();
  }
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Soumettre", exact: true })).toBeEnabled();
  await page.unroute("**/proposals");
}]);

return scenarios;
}

import { expect, type Page } from "@playwright/test";
import { API, seriousViolations } from "./demo";
import { AUTH_API, git, isolatedDemo, python, relay, test } from "./isolation";

// Écran 10.5 (Comparaison) : chaque geste de l'utilisateur, fait pour de vrai, contre le vrai
// serveur (exécution locale DuckDB, ATLAS_COMPARE_DATA). L'oracle : maquette 10.5, guide 10.5,
// brief 10.5 et 8.3, plan 0015, ADR 0019. Chaque scénario travaille sur une copie isolée de la
// démonstration, dont l'historique de comparaisons part vide.
// Ce que les fichiers comparaison*.spec.ts font déjà (lancement, détail, nœud divergent,
// annulation, double clic, bypass, tolérance appliquée, période, « Tout voir », filtre par
// utilisateur, Connexion requise) n'est pas refait ici : voir docs/tests/inventaire-ui-ecrans.md.

const launchButton = (page: Page) => page.getByRole("button", { name: /Lancer la comparaison|Relancer/ });
const cell = (page: Page, entity: string, kpi = "Revenu net") => page.getByRole("link", { name: new RegExp(`^${kpi} × ${entity} :`) });
const detail = (page: Page) => page.getByRole("region", { name: /^Détail · / });
const strip = (page: Page) => page.getByRole("region", { name: "Dernières comparaisons" });
const matrix = (page: Page) => page.getByRole("table").filter({ hasText: "KPI \\ Déclinaison" });

/** L'aperçu a rendu ses alertes : le panneau est prêt à lancer. */
async function open(page: Page, root: string) {
  await page.goto(`${root}/comparaison`);
  await expect(page.getByRole("heading", { level: 1, name: "Comparaison" })).toBeVisible();
  await expect(page.getByText("Surcharge hors des points déclarés").first()).toBeVisible();
}

/** Lance (ou relance) par un clic et attend la fin : rend le numéro de la comparaison. */
async function launch(page: Page): Promise<number> {
  const started = page.waitForResponse((r) => /\/comparisons$/.test(new URL(r.url()).pathname) && r.request().method() === "POST");
  await launchButton(page).click();
  const response = await started;
  expect(response.status()).toBe(202);
  const { id } = (await response.json()) as { id: number };
  await expect(page).toHaveURL(new RegExp(`id=${id}&variant=`), { timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Relancer" })).toBeVisible();
  return id;
}

test("[S-UI-105-01] [S-UI-105-02] [S-UI-105-03] [S-UI-105-04] changer de KPI recharge les déclinaisons, une déclinaison en retard est grisée avec sa raison, le filtre Domaine de la matrice", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  // Préparation du dépôt : Taux de service (domaine Supply chain) reçoit une déclinaison nordis-fr, et la
  // déclinaison nordis-fr de Revenu net reste sur la v3 du canonique (en retard).
  python(`import sys,yaml
from pathlib import Path
root=Path(sys.argv[1])
p=root/'variants/revenu-net/nordis-fr.yaml'; d=yaml.safe_load(p.read_text()); d['variant_of']['version']=3
p.write_text(yaml.safe_dump(d,allow_unicode=True,sort_keys=False))
v=root/'variants/taux-de-service'; v.mkdir(parents=True,exist_ok=True)
(v/'nordis-fr.yaml').write_text(yaml.safe_dump({'schema_version':1,'kind':'variant','data_product':{'id':'taux-de-service--nordis-fr','version':1,'owner':'claire.m'},'variant_of':{'id':'taux-de-service','version':2},'entity':'nordis-fr','mode':'override','justification':'Déclinaison française du taux de service.','overrides':[{'node':'n02','justification':'Mois civil, libellé local.','replace':{'id':'n02','type':'temporal','label':'Mois civil','inputs':['n01'],'operation':'period','column':'date_promise','target':'mois','grain':'month'}}]},allow_unicode=True,sort_keys=False))`, ws.work);
  git(ws.work, "add", ".");
  git(ws.work, "commit", "-qm", "Taux de service décliné, nordis-fr de Revenu net en retard");
  git(ws.work, "push", "origin", "main");
  expect((await request.post(`${ws.api}/sync`)).ok()).toBe(true);

  await open(page, ws.root);
  const kpi = page.getByRole("combobox", { name: "KPI" });
  await expect(kpi).toHaveValue("revenu-net");
  await expect(kpi.locator("option")).toHaveCount(2);
  expect(await kpi.locator("option").allTextContents()).toEqual(expect.arrayContaining(["Revenu net (v4)", "Taux de service (v2)"]));

  // [S-UI-105-02] Une déclinaison en retard sur le canonique n'est pas cochée, sa case est grisée,
  // et la raison s'affiche sous elle (ADR 0019, setup).
  const fr = page.getByRole("checkbox", { name: /nordis-fr/ });
  await expect(fr).toBeDisabled();
  await expect(fr).not.toBeChecked();
  await expect(fr).toHaveAccessibleDescription("Non comparable : Déclinaison de la v3 du KPI, canonique en v4.");
  await expect(page.getByRole("checkbox", { name: /nordis-de/ })).toBeChecked();

  // [S-UI-105-01] Changer de KPI : les déclinaisons sont celles du nouveau KPI, l'adresse le retient.
  await kpi.selectOption({ label: "Taux de service (v2)" });
  await expect(page).toHaveURL(/kpi=taux-de-service/);
  const launchPanel = page.getByRole("region", { name: "Lancement" });
  await expect(launchPanel.getByRole("checkbox")).toHaveCount(1);
  await expect(launchPanel.getByRole("checkbox", { name: /nordis-fr/ })).toBeVisible();
  await expect(launchPanel.getByText("Ce KPI ne déclare aucun scope de comparaison")).toBeVisible();
  await expect(page.getByText("Surcharge hors des points déclarés")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("combobox", { name: "KPI" })).toHaveValue("taux-de-service");
  await expect(page.getByRole("region", { name: "Lancement" }).getByRole("checkbox")).toHaveCount(1);
  // Retour arrière : le KPI précédent et ses trois déclinaisons.
  await page.goBack();
  await expect(page.getByRole("combobox", { name: "KPI" })).toHaveValue("revenu-net");
  await expect(page.getByRole("region", { name: "Lancement" }).getByRole("checkbox")).toHaveCount(3);

  // [S-UI-105-03] Filtre Domaine de la matrice (maquette 10.5 : Finance, Ventes, Tous domaines).
  const domain = page.getByRole("combobox", { name: "Domaine" });
  await expect(domain).toHaveValue("tous");
  await expect(matrix(page).getByRole("rowheader")).toHaveCount(2);
  expect(await matrix(page).getByRole("rowheader").allTextContents()).toEqual(expect.arrayContaining(["Revenu net", "Taux de service"]));
  await domain.selectOption({ label: "Supply chain" });
  await expect(page).toHaveURL(/domain=supply/);
  await expect(matrix(page).getByRole("rowheader")).toHaveText(["Taux de service"]);
  await domain.selectOption({ label: "Finance" });
  await expect(matrix(page).getByRole("rowheader")).toHaveText(["Revenu net"]);
  // [S-UI-105-04] Le filtre tient au rechargement, et le retour arrière rend le précédent.
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Domaine" })).toHaveValue("finance");
  await expect(matrix(page).getByRole("rowheader")).toHaveText(["Revenu net"]);
  await page.goBack();
  await expect(page.getByRole("combobox", { name: "Domaine" })).toHaveValue("supply");
  await expect(matrix(page).getByRole("rowheader")).toHaveText(["Taux de service"]);
  expect(await seriousViolations(page)).toEqual([]);
});

test("[S-UI-105-05] [S-UI-105-06] décocher une déclinaison la retire du lancement ; tout décocher est refusé sans rien envoyer, recocher le rétablit", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  const starts: { variants: string[] }[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && /\/comparisons$/.test(new URL(r.url()).pathname)) starts.push(r.postDataJSON());
  });
  await open(page, ws.root);
  const es = page.getByRole("checkbox", { name: /nordis-es/ });
  const de = page.getByRole("checkbox", { name: /nordis-de/ });
  const fr = page.getByRole("checkbox", { name: /nordis-fr/ });
  // La maquette nomme la plateforme à côté de chaque déclinaison.
  await expect(page.getByRole("region", { name: "Lancement" }).getByText(/nordis-es\s*· Snowflake/)).toBeVisible();
  await expect(page.getByRole("region", { name: "Lancement" }).getByText(/nordis-de\s*· Databricks/)).toBeVisible();

  await es.click();
  await expect(es).not.toBeChecked();
  const id = await launch(page);
  expect(starts.at(-1)?.variants.sort()).toEqual(["nordis-de", "nordis-fr"]);
  await expect(detail(page).getByRole("combobox", { name: "Déclinaison" }).locator("option")).toHaveText(["nordis-de", "nordis-fr"]);
  await expect(matrix(page).getByRole("row").filter({ hasText: "Revenu net" }).getByText("non comparé")).toHaveCount(1); // nordis-es
  await expect(strip(page).getByRole("listitem").first()).toContainText(`n° ${id}`);
  await expect(strip(page).getByRole("listitem").first()).not.toContainText("nordis-es");

  // Tout décocher : le lancement est refusé à l'écran, rien ne part.
  await de.click();
  await fr.click();
  await expect(launchButton(page)).toHaveAttribute("aria-disabled", "true");
  const before = starts.length;
  // Bouton aria-disabled : Playwright refuse de le cliquer ; on l'active au clavier, comme un utilisateur.
  await launchButton(page).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Cocher au moins une déclinaison.")).toBeVisible();
  expect(starts.length).toBe(before);
  // Chemin inverse : recocher rend le lancement possible, le message disparaît.
  await es.click();
  await expect(es).toBeChecked();
  await expect(page.getByText("Cocher au moins une déclinaison.")).toHaveCount(0);
  await expect(launchButton(page)).not.toHaveAttribute("aria-disabled", "true");
  expect(await seriousViolations(page)).toEqual([]);
});

test("[S-UI-105-07] une granularité plus grossière est exécutée : le détail n'a plus que le mois", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await open(page, ws.root);
  const granularity = page.getByRole("combobox", { name: "Granularité" });
  await expect(granularity).toHaveValue("0");
  await granularity.selectOption({ label: "Mois fiscal" });
  await launch(page);
  await cell(page, "nordis-de").click();
  await expect(detail(page)).toHaveAccessibleName(/^Détail · Revenu net · nordis-de · par Mois fiscal$/);
  await expect(detail(page).getByRole("columnheader")).toHaveText(["Mois fiscal", "Canonique", "Déclinaison nordis-de", "Écart"]);
  await expect(detail(page).getByRole("columnheader", { name: "Entité" })).toHaveCount(0);
});

test("[S-UI-105-08] [S-UI-105-09] le curseur de tolérance se règle au clavier et à la souris ; la valeur choisie est celle de la comparaison", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await open(page, ws.root);
  const slider = page.getByRole("slider", { name: /Tolérance/ });
  // Maquette : « Tolérance (globale 1 % · KPI 1,5 %) ».
  await expect(page.getByText("Tolérance : 1,5 % (globale 1 % · KPI 1,5 %)")).toBeVisible();
  await expect(slider).toHaveValue("1.5");

  await slider.focus();
  await page.keyboard.press("ArrowRight");
  await expect(slider).toHaveValue("1.6");
  await expect(page.getByText("Tolérance : 1,6 %")).toBeVisible();
  await expect(slider).toHaveAttribute("aria-valuetext", "1,6 %");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(slider).toHaveValue("1.4");
  await page.keyboard.press("Home");
  await expect(slider).toHaveValue("0");
  await expect(page.getByText("Tolérance : 0 %")).toBeVisible();
  await page.keyboard.press("End");
  await expect(slider).toHaveValue("5");
  await expect(page.getByText("Tolérance : 5 %")).toBeVisible();

  // À la souris : la poignée glissée vers le début de la piste.
  const box = (await slider.boundingBox())!;
  await page.mouse.move(box.x + box.width - 4, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();
  const dragged = Number(await slider.inputValue());
  expect(dragged).toBeGreaterThan(1);
  expect(dragged).toBeLessThan(3);
  const shown = String(dragged).replace(".", ",");
  await expect(page.getByText(`Tolérance : ${shown} %`)).toBeVisible();

  // [S-UI-105-09] La comparaison lancée porte la tolérance choisie (métadonnées du détail).
  await launch(page);
  await expect(detail(page)).toContainText(`tolérance ${shown} %`);
});

test("[S-UI-105-10] à [S-UI-105-17] relancer, les trois dernières, la cellule au clavier, le détail tenu au rechargement, le retour arrière, l'historique complet et ses filtres", async ({ page, request }) => {
  test.setTimeout(180_000);
  const ws = await isolatedDemo(request, API);
  await open(page, ws.root);
  // [S-UI-105-10] « Relancer » crée chaque fois une nouvelle comparaison.
  const ids: number[] = [];
  for (let i = 0; i < 4; i += 1) ids.push(await launch(page));
  expect(new Set(ids).size).toBe(4);

  // [S-UI-105-11] Le bandeau d'historique montre les trois dernières, la plus récente d'abord.
  const recent = strip(page).getByRole("link", { name: /^n° \d+ · Revenu net$/ });
  await expect(recent).toHaveText([`n° ${ids[3]} · Revenu net`, `n° ${ids[2]} · Revenu net`, `n° ${ids[1]} · Revenu net`]);

  // [S-UI-105-12] Une cellule de la matrice s'ouvre au clavier ; la cellule ouverte est entourée.
  await page.getByRole("combobox", { name: "Domaine" }).focus();
  const es = cell(page, "nordis-es");
  for (let i = 0; i < 4 && !(await es.evaluate((el) => el === document.activeElement)); i += 1) await page.keyboard.press("Tab");
  await expect(es).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/variant=nordis-es/);
  await expect(detail(page)).toHaveAccessibleName(/Détail · Revenu net · nordis-es/);
  await expect(es).toHaveAttribute("aria-current", "true");
  await expect(es).toHaveCSS("outline-width", "2px"); // guide 10.5 : contour 2 px de la couleur de la cellule
  await expect(es).toHaveCSS("outline-style", "solid");

  // [S-UI-105-13] Le détail ouvert tient au rechargement (adresse ?id=&variant=).
  await cell(page, "nordis-de").click();
  await expect(detail(page)).toHaveAccessibleName(/Détail · Revenu net · nordis-de/);
  await page.reload();
  await expect(detail(page)).toHaveAccessibleName(/Détail · Revenu net · nordis-de/);
  await expect(cell(page, "nordis-de")).toHaveAttribute("aria-current", "true");
  // [S-UI-105-14] Retour arrière : la cellule précédente et son détail.
  await page.goBack();
  await expect(detail(page)).toHaveAccessibleName(/Détail · Revenu net · nordis-es/);
  await expect(cell(page, "nordis-es")).toHaveAttribute("aria-current", "true");

  // [S-UI-105-15] Une entrée du bandeau rouvre les résultats de cette comparaison.
  await strip(page).getByRole("link", { name: `n° ${ids[1]} · Revenu net` }).click();
  await expect(page).toHaveURL(new RegExp(`id=${ids[1]}&variant=`));
  await expect(detail(page)).toContainText(`Comparaison n° ${ids[1]}`);

  // [S-UI-105-16] Historique complet : quatre lignes, filtres KPI et « Depuis le » (et leur inverse).
  await strip(page).getByRole("link", { name: "Tout voir" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Historique des comparaisons" })).toBeVisible();
  const history = page.getByRole("region", { name: "Toutes les comparaisons" });
  const rows = history.getByRole("table").locator("tbody tr");
  await expect(rows).toHaveCount(4);
  await history.getByRole("combobox", { name: "KPI" }).selectOption({ label: "Revenu net" });
  await expect(page).toHaveURL(/hkpi=revenu-net/);
  await expect(rows).toHaveCount(4);
  const since = history.getByLabel("Depuis le");
  await since.fill("2999-01-01");
  await expect(history.getByText("Aucune comparaison ne correspond à ces filtres.")).toBeVisible();
  await since.fill("");
  await expect(rows).toHaveCount(4);
  await history.getByRole("combobox", { name: "Utilisateur" }).selectOption("anna.k");
  // Les filtres tiennent au rechargement (adresse ?vue=historique&…).
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Historique des comparaisons" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "KPI" })).toHaveValue("revenu-net");
  await expect(page.getByRole("combobox", { name: "Utilisateur" })).toHaveValue("anna.k");
  await expect(page.getByRole("region", { name: "Toutes les comparaisons" }).getByRole("table").locator("tbody tr")).toHaveCount(4);
  expect(await seriousViolations(page)).toEqual([]);

  // [S-UI-105-17] Une ligne rouvre ses résultats ; le retour arrière ramène à l'historique ;
  // « Retour à la comparaison » ramène à l'écran de lancement.
  await page.getByRole("link", { name: `n° ${ids[0]}`, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Comparaison" })).toBeVisible();
  await expect(detail(page)).toContainText(`Comparaison n° ${ids[0]}`);
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "Historique des comparaisons" })).toBeVisible();
  await page.getByRole("link", { name: "← Retour à la comparaison" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Comparaison" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Lancement" })).toBeVisible();
});

test("[S-UI-105-18] le lien « Mes connexions » du bandeau « Connexion requise » mène à l'écran des connexions, sans champ de token", async ({ page, request }) => {
  const ws = await isolatedDemo(request, AUTH_API);
  await relay(page, AUTH_API);
  await page.goto(`${ws.root}/comparaison`);
  // Sur ce serveur, nordis-de n'est pas comparable (case grisée, non cochée) : seule nordis-es est à décocher.
  await page.getByRole("checkbox", { name: /nordis-es/ }).click();
  await expect(page.getByRole("checkbox", { name: /nordis-de/ })).not.toBeChecked();
  const banner = page.getByRole("alert").filter({ hasText: "Connexion requise" });
  await expect(banner).toBeVisible();
  await expect(banner.getByRole("button", { name: "Se connecter à dbx-fr" })).toBeVisible();
  await expect(page.locator("input[type=password]")).toHaveCount(0); // jamais de champ de token (guide 10.6, ADR 0019)
  await banner.getByRole("link", { name: "Mes connexions" }).click();
  await expect(page).toHaveURL(new RegExp(`#/w/${ws.id}/connexions$`));
  await expect(page.getByRole("heading", { level: 1, name: "Mes connexions" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "Comparaison" })).toBeVisible();
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("[S-UI-105-19] la synthèse en erreur serveur s'affiche en bandeau avec une action, « Réessayer » la relit", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  // Panne du serveur sur la synthèse seule (page.route : simulation d'une panne serveur).
  await page.route((url) => url.pathname.endsWith("/comparisons/matrix"), (route) =>
    route.fulfill({ status: 500, json: { detail: { code: "internal_error", message: "Erreur interne du serveur." } } }));
  await page.goto(`${ws.root}/comparaison`);
  const banner = page.getByRole("alert").filter({ hasText: /échoué|erreur|Erreur/ }).first();
  await expect(banner).toBeVisible();
  // Plan 0010 (États) et ADR 0013 : « Une erreur d'API s'affiche dans un bandeau, avec le message traduit et une action. »
  await expect(banner.getByRole("button", { name: "Réessayer" })).toBeVisible();
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await banner.getByRole("button", { name: "Réessayer" }).click();
  await expect(matrix(page)).toBeVisible();
});

test("[S-UI-105-20] serveur injoignable au lancement : bandeau de la coque, rien n'est lancé, « Réessayer » rétablit l'écran", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await open(page, ws.root);
  await page.route(`${API}/**`, (route) => route.abort("connectionrefused"));
  await launchButton(page).click();
  const banner = page.getByRole("alert").filter({ hasText: "Serveur local injoignable" }).first();
  await expect(banner).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await page.getByRole("button", { name: "Réessayer" }).first().click();
  await expect(page.getByRole("alert").filter({ hasText: "Serveur local injoignable" })).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "Comparaison" })).toBeVisible();
  await expect(launchButton(page)).toBeVisible();
});

test("[S-UI-105-21] choisir un KPI décliné dont la sortie passe par une jointure (Panier moyen) montre ses déclinaisons, sans erreur serveur", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  // Préparation du dépôt : Panier moyen (domaine Ventes), KPI de la démonstration, reçoit une déclinaison nordis-fr.
  python(`import sys,yaml
from pathlib import Path
v=Path(sys.argv[1])/'variants/panier-moyen'; v.mkdir(parents=True,exist_ok=True)
(v/'nordis-fr.yaml').write_text(yaml.safe_dump({'schema_version':1,'kind':'variant','data_product':{'id':'panier-moyen--nordis-fr','version':1,'owner':'claire.m'},'variant_of':{'id':'panier-moyen','version':1},'entity':'nordis-fr','mode':'override','justification':'Déclinaison française du panier moyen.','overrides':[{'node':'n03','justification':'Mois fiscal, libellé local.','replace':{'id':'n03','type':'temporal','label':'Mois fiscal France','inputs':['n02'],'operation':'period','column':'date_commande','target':'mois_fiscal','grain':'month'}}]},allow_unicode=True,sort_keys=False))`, ws.work);
  git(ws.work, "add", ".");
  git(ws.work, "commit", "-qm", "Panier moyen décliné pour nordis-fr");
  git(ws.work, "push", "origin", "main");
  expect((await request.post(`${ws.api}/sync`)).ok()).toBe(true);

  await page.goto(`${ws.root}/comparaison`);
  const kpi = page.getByRole("combobox", { name: "KPI" });
  await expect(kpi.locator("option", { hasText: "Panier moyen (v1)" })).toHaveCount(1);
  await kpi.selectOption({ label: "Panier moyen (v1)" });
  const launchPanel = page.getByRole("region", { name: "Lancement" });
  // ADR 0019 : le panneau liste les déclinaisons du KPI ; sans scope déclaré, il le dit (plan 0009).
  await expect(launchPanel.getByRole("checkbox", { name: /nordis-fr/ })).toBeVisible();
  await expect(launchPanel.getByText("Ce KPI ne déclare aucun scope de comparaison")).toBeVisible();
  await expect(launchPanel.getByRole("alert")).toHaveCount(0);
});

test("[S-UI-105-25] choisir un scope à période de calendrier remplace Du/Au par la période nommée ; la comparaison porte sur ses seuls mois", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await open(page, ws.root);
  const scope = page.getByRole("combobox", { name: "Scope" });
  await expect(scope).toHaveValue("fy2026-mois-entite");
  await expect(page.getByLabel("Du", { exact: true })).toHaveValue("2026-02-01");
  // Plan 0015 : scope choisi parmi les scopes déclarés du KPI ; fy2026-t4 = FY2026_Q4 (juillet à septembre 2026).
  await scope.selectOption("fy2026-t4");
  await expect(page.getByText("Période : FY2026_Q4")).toBeVisible();
  await expect(page.getByLabel("Du", { exact: true })).toHaveCount(0);
  // Chemin inverse : revenir au premier scope rend Du/Au et sa période.
  await scope.selectOption("fy2026-mois-entite");
  await expect(page.getByLabel("Du", { exact: true })).toHaveValue("2026-02-01");
  await expect(page.getByLabel("Au", { exact: true })).toHaveValue("2026-09-30");
  await scope.selectOption("fy2026-t4");
  await launch(page);
  await cell(page, "nordis-de").click();
  const rows = detail(page).getByRole("table").getByRole("row");
  await expect(rows.first()).toContainText("Mois fiscal");
  // Les lignes ne portent que les mois de FY2026_Q4 (une par mois et par entité de nordis-de).
  const months = new Set((await rows.allInnerTexts()).slice(1).map((row) => row.split("\t")[0]));
  expect([...months]).toEqual(["Juil. 2026", "Août 2026", "Sept. 2026"]);
  expect(await seriousViolations(page)).toEqual([]);
});

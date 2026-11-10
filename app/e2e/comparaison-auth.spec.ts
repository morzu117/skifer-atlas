import { expect, type Page } from "@playwright/test";
import { AUTH_API, isolatedDemo, relay, test } from "./isolation";

test("[S-0009-06] [S-0015-04] OAuth manquant : authentification puis reprise du lancement", async ({ page, request }) => {
  const ws = await isolatedDemo(request, AUTH_API);
  await relay(page, AUTH_API);
  // L'aperçu de la seule déclinaison FR, avant l'authentification : un aperçu encore en
  // vol après le retour OAuth trouverait l'accès et retirerait la demande de connexion.
  const previewed = page.waitForResponse(r => r.url().endsWith("/comparisons/preview")
    && (JSON.parse(r.request().postData() ?? "{}") as { variants?: string[] }).variants?.join() === "nordis-fr");
  await page.goto(`${ws.root}/comparaison`);
  await page.getByRole("checkbox", { name: /nordis-es/ }).uncheck();
  await page.getByRole("checkbox", { name: /nordis-de/ }).uncheck();
  await previewed;
  // L'aperçu signale l'accès manquant avant tout lancement : le bouton reste cliquable mais
  // marqué aria-disabled ; le clic mémorise la demande, qui reprend après l'authentification.
  await expect(page.getByText("Connexion requise", { exact: true })).toBeVisible();
  const launch = page.getByRole("button", { name: /Lancer la comparaison|Relancer/ });
  await expect(launch).toHaveAttribute("aria-disabled", "true");
  await launch.click({ force: true });
  const resumed = page.waitForResponse(r => r.url().endsWith("/comparisons") && r.request().method() === "POST" && r.status() === 202);
  const opened = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Se connecter à dbx-fr" }).click();
  const popup = await opened;
  await expect(popup.getByText(/Connexion réussie/)).toBeVisible();
  await popup.close();
  const { id } = await (await resumed).json() as { id: number };
  expect(id).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: "Se connecter à dbx-fr" })).toHaveCount(0);
  // Le faux ne calcule pas le SQL : hors SELECT 1, il rend mois/ca. La reprise, pas
  // le résultat financier, est le contrat de ce scénario.
});

/** Espace isolé dont seule nordis-fr est cochée : l'aperçu demande la connexion à dbx-fr. */
async function needsConnection(page: Page, request: Parameters<typeof isolatedDemo>[0]) {
  const ws = await isolatedDemo(request, AUTH_API);
  await relay(page, AUTH_API);
  const previewed = page.waitForResponse(r => r.url().endsWith("/comparisons/preview")
    && (JSON.parse(r.request().postData() ?? "{}") as { variants?: string[] }).variants?.join() === "nordis-fr");
  await page.goto(`${ws.root}/comparaison`);
  await page.getByRole("checkbox", { name: /nordis-es/ }).uncheck();
  await page.getByRole("checkbox", { name: /nordis-de/ }).uncheck();
  await previewed;
  await expect(page.getByText("Connexion requise", { exact: true })).toBeVisible();
  return ws;
}

test("[S-0015-13] Deux clics rapides sur « Se connecter à… » ne lancent qu'une autorisation, sans échec affiché", async ({ page, request }) => {
  const ws = await needsConnection(page, request);
  // L'autorisation tarde : la fenêtre pendant laquelle un second clic relançait l'OAuth reste ouverte.
  await page.route(`**/api/workspaces/${ws.id}/connections/dbx-fr/authorize`, async route => {
    await new Promise(resolve => setTimeout(resolve, 700));
    await route.fallback();
  });
  let authorizations = 0;
  page.on("request", r => { if (r.method() === "POST" && r.url().endsWith("/connections/dbx-fr/authorize")) authorizations += 1; });
  const popups: Page[] = [];
  page.on("popup", popup => { popups.push(popup); });

  const connect = page.getByRole("button", { name: "Se connecter à dbx-fr" });
  await connect.dblclick();
  await expect(connect).toBeDisabled();
  await expect(page.getByRole("button", { name: "En attente de dbx-fr…" })).toBeDisabled();
  await expect.poll(() => popups.length).toBe(1);
  await expect(popups[0].getByText(/Connexion réussie/)).toBeVisible();
  await popups[0].close();
  // L'accès est là : la demande de connexion disparaît d'elle-même.
  await expect(page.getByText("Connexion requise", { exact: true })).toHaveCount(0);
  expect(authorizations).toBe(1);
  expect(popups).toHaveLength(1);
  await expect(page.getByText(/Connexion échouée/)).toHaveCount(0);
});

test("[S-0015-13] Page d'autorisation abandonnée : le bouton d'attente reste désactivé, « Recommencer la connexion » relance l'autorisation", async ({ page, request }) => {
  const ws = await needsConnection(page, request);
  // La première page d'autorisation ne s'ouvre pas (fermée ou bloquée) ; la seconde passe.
  let blocked = true;
  let interrupted = 0;
  await page.context().route("**/oidc/v1/authorize**", async route => {
    if (blocked) {
      interrupted += 1;
      await route.abort();
    } else await route.fallback();
  });
  let authorizations = 0;
  page.on("request", r => { if (r.method() === "POST" && r.url().endsWith(`/api/workspaces/${ws.id}/connections/dbx-fr/authorize`)) authorizations += 1; });
  const popups: Page[] = [];
  page.on("popup", opened => { popups.push(opened); });

  await page.getByRole("button", { name: "Se connecter à dbx-fr" }).click();
  const waiting = page.getByRole("button", { name: "En attente de dbx-fr…" });
  await expect(waiting).toBeDisabled();
  await expect(page.getByText(/Terminer la connexion dans le navigateur/)).toBeVisible();
  expect(authorizations).toBe(1);

  // La navigation de la première fenêtre doit avoir été interrompue avant de laisser passer la suivante.
  await expect.poll(() => interrupted).toBe(1);
  blocked = false;
  await page.getByRole("button", { name: "Recommencer la connexion à dbx-fr" }).click();
  await expect.poll(() => popups.length).toBe(2);
  const popup = popups[1];
  await expect(popup.getByText(/Connexion réussie/)).toBeVisible();
  await popup.close();
  expect(authorizations).toBe(2);
  await expect(page.getByText("Connexion requise", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Connexion échouée/)).toHaveCount(0);
});

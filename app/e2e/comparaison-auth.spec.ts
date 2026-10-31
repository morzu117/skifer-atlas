import { expect, test } from "@playwright/test";
import { AUTH_API, isolatedDemo, relay } from "./isolation";

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

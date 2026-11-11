import { expect, type Route } from "@playwright/test";
import { API, seriousViolations } from "./demo";
import { isolatedDemo, test } from "./isolation";

// ADR 0049 : la synchronisation automatique d'un espace, relancée tant que le serveur répond
// `busy` ou `pending`, au plus 20 essais espacés de 150 ms et pendant 8 s. Chaque test a sa
// copie de l'espace de démonstration, sur le serveur principal (anna.k).

test("[S-0049-01] une synchronisation encore occupée après tous ses essais l'annonce, puis un succès efface le bandeau", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  const auto = (url: URL) => url.pathname === `/api/workspaces/${ws.id}/sync/auto`;

  // Le serveur répond « occupé » à chaque essai, jusqu'à la limite des 20 essais.
  const busy = (route: Route) => route.fulfill({ json: { status: "busy" } });
  await page.route(auto, busy);
  await page.goto(`${ws.root}/catalogue`);
  await expect(page.getByRole("heading", { name: "Catalogue", level: 1 })).toBeVisible();

  const banner = page.getByRole("status").filter({ hasText: "Synchronisation en attente" });
  await expect(banner).toBeVisible({ timeout: 10_000 }); // 20 essais espacés de 150 ms
  await expect(banner).toContainText("La synchronisation n’a pas encore eu lieu. Un nouvel essai aura lieu au prochain changement d’écran.");
  expect(await seriousViolations(page)).toEqual([]);

  // Le serveur répond de nouveau : le changement d'écran synchronise et le bandeau disparaît.
  await page.unroute(auto, busy);
  const nav = page.getByRole("navigation", { name: "Navigation de l'espace" });
  let synced = page.waitForResponse((response) => auto(new URL(response.url())));
  await nav.getByRole("link", { name: "Propositions" }).click();
  await expect(page.getByRole("heading", { name: "Propositions", level: 1 })).toBeVisible();
  expect((await (await synced).json()).status).toBe("up_to_date");
  await expect(banner).toHaveCount(0);

  // De retour sur le catalogue, le bandeau effacé ne revient pas.
  synced = page.waitForResponse((response) => auto(new URL(response.url())));
  await nav.getByRole("link", { name: "Catalogue" }).click();
  await expect(page.getByRole("heading", { name: "Catalogue", level: 1 })).toBeVisible();
  expect((await (await synced).json()).status).toBe("up_to_date");
  await expect(banner).toHaveCount(0);
});

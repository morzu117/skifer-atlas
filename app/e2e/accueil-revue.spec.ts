import { expect, type APIRequestContext } from "@playwright/test";
import { API } from "./demo";
import { isolatedDemo, relay, test } from "./isolation";

// Plan 0010 : le compte de propositions à relire apparaît sur la carte de l'espace et dans la
// navigation, selon le compte qui regarde, et baisse quand la revue est faite. Trois comptes,
// trois serveurs sur le même dépôt : anna.k (autrice de la proposition DE), claire.m et
// marc.d (validateurs Finance).

const CLAIRE = "http://127.0.0.1:8798";
const MARC = "http://127.0.0.1:8797";

async function forMe(request: APIRequestContext, server: string, id: string) {
  const response = await request.get(`${server}/api/workspaces/${id}/proposals?status=open&for_me=true`);
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { id: number }[]).length;
}

test("[S-0010-13] le compte à relire se voit sur la carte et dans la navigation, et baisse après la revue", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  expect((await request.post(`${CLAIRE}/api/workspaces/join`, { data: { remote_url: ws.remote } })).status()).toBe(201);
  const waiting = await forMe(request, CLAIRE, ws.id);
  expect(waiting).toBeGreaterThan(1); // plusieurs propositions de Finance attendent claire.m
  const card = page.getByRole("list", { name: "Espaces" }).getByRole("link").and(page.locator(`a[href$="#/w/${ws.id}/catalogue"]`));

  await relay(page, CLAIRE);
  await page.goto("/");
  await expect(card).toContainText(`${waiting} propositions en attente`);
  await expect(card.locator(".count-warn")).toBeVisible();

  await card.click();
  const nav = page.getByRole("navigation", { name: "Navigation de l'espace" });
  await expect(nav.getByRole("link", { name: /^Propositions/ }).locator(".nav-count")).toHaveText(`${waiting} en attente de votre revue`);

  // Claire approuve la surcharge DE : sa revue est faite, le compte baisse, ici et sur la carte.
  await nav.getByRole("link", { name: /^Propositions/ }).click();
  await page.getByRole("list", { name: "File des propositions" }).getByRole("link").filter({ hasText: "Revenu net · nordis-de" }).click();
  await page.getByRole("button", { name: "Approuver (0 / 2)" }).click();
  await expect(page.getByRole("button", { name: "Approuver (1 / 2)" })).toBeVisible();
  await expect(nav.getByRole("link", { name: /^Propositions/ }).locator(".nav-count")).toHaveText(`${waiting - 1} en attente de votre revue`);
  await page.getByRole("link", { name: /Espace\s*Groupe Nordis/ }).click();
  await expect(card).toContainText(`${waiting - 1} ${waiting - 1 > 1 ? "propositions" : "proposition"} en attente`);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("[S-0010-13] une autrice sans rôle de validation n'a pas de compte à relire, ni sur la carte ni dans la navigation", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  expect(await forMe(request, API, ws.id)).toBe(0);
  const card = page.getByRole("list", { name: "Espaces" }).getByRole("link").and(page.locator(`a[href$="#/w/${ws.id}/catalogue"]`));
  await page.goto("/");
  await expect(card).toContainText("Aucune proposition");
  await expect(card.locator(".count-warn")).toHaveCount(0);
  await card.click();
  await expect(page.getByRole("navigation", { name: "Navigation de l'espace" }).locator(".nav-count")).toHaveCount(0);
});

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { seriousViolations } from "./demo";
import { AUTH_API, git, isolatedDemo, relay, test } from "./isolation";

// ADR 0055. Le dépôt est isolé et joint au serveur de julien.h (8793), comme diff.spec.ts :
// Revenu net y passe en v5 par un commit étiqueté poussé directement sur le distant.
test.beforeEach(async ({ page }) => { await relay(page, AUTH_API); });

const tabs = (page: Page) => page.getByRole("navigation", { name: "Onglets de la fiche" });
/** Le fait « Référencé par » de l'onglet Définition. */
const incomingFact = (page: Page) => page.getByRole("definition").filter({ hasText: "Marge brute" });

test("[S-0055-01] les références épinglées sur Revenu net v4 sont signalées quand il passe en v5", async ({ page, request }) => {
  test.setTimeout(60_000);
  const ws = await isolatedDemo(request, AUTH_API);

  // Revenu net en v4 : Marge brute et Panier moyen sont à jour, aucune mention.
  for (const [id, name] of [["marge-brute", "Marge brute"], ["panier-moyen", "Panier moyen"]]) {
    await page.goto(`${ws.root}/fiche/${id}`);
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(page.getByRole("definition").filter({ hasText: "Revenu net (Finance)" })).toBeVisible();
    await expect(page.getByText(/version courante/)).toHaveCount(0);
    await tabs(page).getByRole("button", { name: "Dépendances" }).click();
    const references = page.getByRole("region", { name: "Références" });
    await expect(references.getByRole("link", { name: "Revenu net" })).toBeVisible();
    await expect(references).not.toContainText("épinglé");
  }
  await page.goto(`${ws.root}/fiche/revenu-net`);
  await expect(incomingFact(page)).toContainText("Panier moyen");
  await expect(incomingFact(page)).not.toContainText("épinglé");
  await tabs(page).getByRole("button", { name: "Dépendances" }).click();
  await expect(page.getByRole("region", { name: "Référencé par" }).getByRole("link", { name: "Panier moyen" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Référencé par" })).not.toContainText("épinglé");

  // Revenu net v5 : commit étiqueté doc/revenu-net/v5 poussé sur le distant, puis synchronisation.
  const path = join(ws.work, "kpis/revenu-net.yaml");
  writeFileSync(path, readFileSync(path, "utf8").replace("version: 4\n", "version: 5\n"));
  git(ws.work, "add", ".");
  git(ws.work, "commit", "-qm", "Revenu net v5");
  git(ws.work, "tag", "doc/revenu-net/v5");
  git(ws.work, "push", "origin", "main", "--tags");
  expect((await request.post(`${ws.api}/sync`)).ok()).toBe(true);

  // Sur les KPI qui référencent : la mention et le lien, dans la définition et dans Dépendances.
  for (const [id, name] of [["panier-moyen", "Panier moyen"], ["marge-brute", "Marge brute"]]) {
    await page.goto(`${ws.root}/fiche/${id}`);
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    const notice = page.getByText("Revenu net : épinglé v4, version courante v5", { exact: true });
    await expect(notice).toBeVisible();
    await expect(notice.getByRole("link", { name: "Revenu net" })).toHaveAttribute("href", `#/w/${ws.id}/fiche/revenu-net`);
    expect(await seriousViolations(page)).toEqual([]);
    await tabs(page).getByRole("button", { name: "Dépendances" }).click();
    const reference = page.getByRole("region", { name: "Références" }).getByRole("listitem")
      .filter({ has: page.getByRole("link", { name: "Revenu net" }) });
    await expect(reference).toContainText("épinglé v4, version courante v5");
    await expect(reference.getByRole("link", { name: "Revenu net" })).toHaveAttribute("href", `#/w/${ws.id}/fiche/revenu-net`);
    expect(await seriousViolations(page)).toEqual([]);
  }

  // Le lien de la mention mène à Revenu net, dont « Référencé par » porte le retard des deux.
  await tabs(page).getByRole("button", { name: "Définition" }).click();
  await page.getByText("Revenu net : épinglé v4, version courante v5", { exact: true }).getByRole("link", { name: "Revenu net" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Revenu net" })).toBeVisible();
  await expect(tabs(page).getByRole("button", { name: "Versions 5" })).toBeVisible();
  await expect(incomingFact(page)).toContainText("Marge brute (épinglé v4)");
  await expect(incomingFact(page)).toContainText("Panier moyen (épinglé v4)");
  await expect(page.getByText(/version courante/)).toHaveCount(0);
  expect(await seriousViolations(page)).toEqual([]);
  await tabs(page).getByRole("button", { name: "Dépendances" }).click();
  const incoming = page.getByRole("region", { name: "Référencé par" });
  for (const name of ["Marge brute", "Panier moyen"]) {
    await expect(incoming.getByRole("listitem").filter({ has: page.getByRole("link", { name }) })).toContainText("épinglé v4");
  }
  await expect(incoming).not.toContainText("version courante");
  expect(await seriousViolations(page)).toEqual([]);
});

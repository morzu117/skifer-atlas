import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { API } from "./demo";
import { git, isolatedDemo, relay, test } from "./isolation";

// Plan 0014, ce que la revue donne à voir en dehors du parcours nominal de
// propositions.spec.ts : le fil de commentaires, la demande de changements envoyée, et des
// refus de fusion que le dépôt provoque vraiment. Trois comptes, trois serveurs sur le
// même dépôt nu : anna.k (auteure de la surcharge DE), claire.m et marc.d (validateurs Finance).

const CLAIRE = "http://127.0.0.1:8798";
const MARC = "http://127.0.0.1:8797";

async function joinReviewer(request: APIRequestContext, remote: string, server: string) {
  expect((await request.post(`${server}/api/workspaces/join`, { data: { remote_url: remote } })).status()).toBe(201);
}

const entry = (page: Page, title: string) => page.getByRole("list", { name: "File des propositions" }).getByRole("link").filter({ hasText: title });
const selection = (page: Page) => page.getByRole("region", { name: "Proposition sélectionnée" });

test("[S-0014-10] un commentaire entre dans le fil, une demande de changements part avec son texte sans faire bouger le décompte", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await joinReviewer(request, ws.remote, CLAIRE);
  await relay(page, CLAIRE);
  await page.goto(`${ws.root}/propositions?n=5`);
  await expect(entry(page, "Revenu net · nordis-de")).toContainText("Validations : 0 / 2 (canonique requis)");
  const thread = selection(page).getByRole("region", { name: "Commentaires" });
  const seeded = "Le statut « expédiée » devrait-il devenir un point de variation du canonique ?"; // posé par le script de démonstration
  await expect(thread.getByRole("listitem")).toHaveCount(1);
  await expect(thread.getByRole("listitem")).toContainText(seeded);

  // Un commentaire vide est refusé sur le champ, sans rien envoyer.
  const posted: string[] = [];
  page.on("request", (r) => { if (r.method() === "POST") posted.push(new URL(r.url()).pathname); });
  await thread.getByRole("button", { name: "Envoyer", exact: true }).click();
  await expect(thread.getByText("Écrire un commentaire avant d'envoyer.")).toBeVisible();
  expect(posted).toEqual([]);

  await thread.getByLabel("Répondre").fill("Le fuseau horaire doit rester Europe/Paris.");
  await thread.getByRole("button", { name: "Envoyer", exact: true }).click();
  await expect(thread.getByRole("listitem")).toHaveCount(2);
  await expect(thread.getByRole("listitem").filter({ hasText: "Le fuseau horaire doit rester Europe/Paris." })).toContainText("Claire M.");
  await expect(thread.getByLabel("Répondre")).toHaveValue("");
  await expect(entry(page, "Revenu net · nordis-de")).toContainText("Validations : 0 / 2");

  // La demande de changements part avec son commentaire, le décompte ne bouge pas.
  await page.getByRole("button", { name: "Demander des changements" }).click();
  const form = page.getByRole("form", { name: "Demander des changements" });
  await form.getByLabel(/Ce qui doit changer/).fill("Reprendre n03 : le filtre doit exclure les avoirs.");
  await form.getByRole("button", { name: "Envoyer la demande" }).click();
  await expect(form).toHaveCount(0);
  const asked = thread.getByRole("listitem").filter({ hasText: "Reprendre n03 : le filtre doit exclure les avoirs." });
  await expect(asked).toContainText("Claire M. demande des changements");
  await expect(entry(page, "Revenu net · nordis-de")).toContainText("Validations : 0 / 2");
  await expect(page.getByRole("button", { name: "Approuver (0 / 2)" })).toBeVisible();

  // Après rechargement, le fil se relit tel quel, dans l'ordre.
  await page.reload();
  const items = selection(page).getByRole("region", { name: "Commentaires" }).getByRole("listitem");
  await expect(items).toHaveCount(3);
  await expect(items.nth(0)).toContainText("Le statut « expédiée »");
  await expect(items.nth(1)).toContainText("Le fuseau horaire doit rester Europe/Paris.");
  await expect(items.nth(2)).toContainText("Claire M. demande des changements");
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("[S-0014-08] un push refusé par le dépôt donne « Le dépôt a refusé la fusion », sans la sortie de git, et la branche principale reste intacte", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  for (const server of [CLAIRE, MARC]) {
    await joinReviewer(request, ws.remote, server);
    expect((await request.post(`${server}/api/workspaces/${ws.id}/proposals/5/reviews`, { data: { event: "approve" } })).ok()).toBe(true);
  }
  await relay(page, CLAIRE);
  await page.goto(`${ws.root}/propositions?n=5&status=open&domain=tous`);
  await expect(entry(page, "Revenu net · nordis-de")).toContainText("Validations : 2 / 2");

  // Le dépôt distant refuse tout push sur sa branche principale, avec un texte que l'écran ne doit pas montrer.
  const hook = join(ws.remote, "hooks", "pre-receive");
  writeFileSync(hook, "#!/bin/sh\necho 'remote: HOOK-SECRET-OUTPUT refus du dépôt' >&2\nexit 1\n");
  chmodSync(hook, 0o755);
  const head = git(ws.remote, "rev-parse", "main");

  await page.getByRole("button", { name: "Fusionner", exact: true }).click();
  const refusal = selection(page).getByRole("alert").filter({ hasText: "Le dépôt a refusé la fusion" });
  await expect(refusal).toContainText("Rien n'a été fusionné : relisez la proposition, puis réessayez.");
  await expect(refusal).not.toContainText("HOOK-SECRET-OUTPUT");
  await expect(page.getByText("L'opération a échoué")).toHaveCount(0);
  await expect(page.getByText("Proposition n° 5 fusionnée")).toHaveCount(0);
  expect(git(ws.remote, "rev-parse", "main")).toBe(head);
  await expect(entry(page, "Revenu net · nordis-de")).toBeVisible();
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("[S-0014-08] une proposition fusionnée ailleurs pendant l'affichage dit qu'elle n'est plus ouverte", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  for (const server of [CLAIRE, MARC]) {
    await joinReviewer(request, ws.remote, server);
    expect((await request.post(`${server}/api/workspaces/${ws.id}/proposals/5/reviews`, { data: { event: "approve" } })).ok()).toBe(true);
  }
  await relay(page, CLAIRE);
  await page.goto(`${ws.root}/propositions?n=5&status=open&domain=tous`);
  await expect(entry(page, "Revenu net · nordis-de")).toContainText("Validations : 2 / 2");

  // Marc la fusionne depuis son poste pendant que l'écran de Claire est resté ouvert.
  const merged = await request.post(`${MARC}/api/workspaces/${ws.id}/proposals/5/merge`);
  expect(merged.ok(), await merged.text()).toBe(true);

  await page.getByRole("button", { name: "Fusionner", exact: true }).click();
  const refusal = selection(page).getByRole("alert").filter({ hasText: "La proposition n'est plus ouverte" });
  await expect(refusal).toContainText("Elle a déjà été fusionnée ou fermée.");
  await expect(page.getByText("L'opération a échoué")).toHaveCount(0);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

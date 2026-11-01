import { join } from "node:path";
import { expect } from "@playwright/test";
import { AUTH_API, isolatedDemo, python, relay, test } from "./isolation";

// Le dépôt reste local : seule son adresse déclarée devient GitHub. Aucun clone privé,
// aucune requête vers github.com. Préparation par les fonctions Python existantes.
test("[S-0025-01] [S-0025-02] [S-0025-03] [S-0025-05] [S-0025-06] GitHub : code, refus, expiration, coffre isolé et déconnexion", async ({ page, request }) => {
  test.setTimeout(120_000);
  const first = await isolatedDemo(request, AUTH_API);
  const second = await isolatedDemo(request, AUTH_API);
  python(`import os,sys
from skifer_atlas.workspaces import get_workspace,update_workspace
os.environ['ATLAS_DATA_DIR']=sys.argv[1]
for ident in sys.argv[2:]:
 w=get_workspace(ident)
 update_workspace(w.model_copy(update={'git_remote':'https://github.com/nordis/'+ident+'.git'}))`, join(process.env.ATLAS_E2E_DATA!, "auth"), first.id, second.id);
  await relay(page, AUTH_API);
  const secrets: string[] = [];
  page.on("response", async response => {
    if (response.url().includes("/api/") && response.request().method() !== "OPTIONS") {
      try { secrets.push(await response.text()); } catch { /* page démontée */ }
    }
  });
  await page.goto(`${first.root}/connexions`);
  const section = page.getByRole("region", { name: "Dépôt de l'espace" });
  for (const action of ["Refuser", "Expirer", "Autoriser"]) {
    await section.getByRole("button", { name: "Se connecter à GitHub" }).click();
    await expect(section.getByRole("group", { name: "Connexion à GitHub" })).toContainText(/code sur GitHub/);
    await expect(section.getByRole("textbox")).toHaveCount(0);
    const opened = page.waitForEvent("popup");
    await section.getByRole("button", { name: "Ouvrir GitHub" }).click();
    const popup = await opened;
    await expect(popup).toHaveURL(/^http:\/\/127.0.0.1:8792\/login\/device\?code=/);
    await popup.getByRole("link", { name: action, exact: true }).click();
    await expect(popup.getByText("Autorisation enregistrée")).toBeVisible();
    await popup.close();
    if (action !== "Autoriser") {
      await expect(section.getByRole("alert")).toContainText(action === "Refuser" ? "refusée" : "expiré");
      await expect(section.getByRole("button", { name: "Se connecter à GitHub" })).toBeEnabled();
    }
  }
  // Compte rendu par /user du faux GitHub : message de connexion, puis état de l'accès
  // (« Connecté », puis « · @julien.h », le séparateur réservé aux lecteurs d'écran).
  await expect(section.getByRole("status")).toHaveText("Connecté à GitHub en tant que @julien.h.");
  await expect(section).toContainText(/Connecté\s*·\s*@julien\.h/);
  const status = await request.get(`${first.api}/github`);
  expect(await status.json()).toMatchObject({ state: "connected", source: "vault" });
  expect(await (await request.get(`${second.api}/github`)).json()).toMatchObject({ state: "absent" });
  await page.goto(`${second.root}/connexions`);
  await expect(section.getByText("Jamais connecté")).toBeVisible();
  await page.goto(`${first.root}/connexions`);
  await section.getByRole("button", { name: "Déconnecter GitHub" }).click();
  await expect(section.getByText(/Jeton retiré du coffre/)).toBeVisible();
  expect(await (await request.get(`${first.api}/github`)).json()).toMatchObject({ state: "absent" });
  expect([...secrets, await page.content()].join("\n")).not.toContain("gho_jeton-du-device-flow");
});

test("[S-0025-04] Rejoindre après échec du clone passe par le faux GitHub et reprend l'adhésion", async ({ page, request }) => {
  const ws = await isolatedDemo(request, AUTH_API);
  const remote = `https://github.com/nordis/${ws.id}.git`;
  await relay(page, AUTH_API);
  const calls: { remote_url: string; github_flow?: string }[] = [];
  await page.route("**/api/workspaces/join", async route => {
    const body = route.request().postDataJSON(); calls.push(body);
    if (!body.github_flow) {
      await route.fulfill({ status: 502, json: { detail: { code: "clone_failed", message: "Authentication failed" } } });
      return;
    }
    // Relevé du flux comme le fait l'app (POST) : la connexion est faite avant l'adhésion.
    const status = await request.post(`${AUTH_API}/api/github/device/${body.github_flow}`, { data: {} });
    expect(await status.json()).toMatchObject({ status: "connected" });
    // Le clone privé est remplacé par l'espace local ; aucune requête à github.com.
    const spaces = await (await request.get(`${AUTH_API}/api/workspaces`)).json();
    await route.fulfill({ status: 201, json: spaces.find((s: { id: string }) => s.id === ws.id) });
  });
  await page.goto("/#/");
  await page.getByRole("button", { name: "Rejoindre un espace" }).click();
  const dialog = page.getByRole("dialog", { name: "Rejoindre un espace" });
  await dialog.getByLabel(/Adresse du dépôt/).fill(remote);
  await dialog.getByRole("button", { name: "Cloner et ouvrir" }).click();
  await expect(dialog).toContainText("Si le dépôt est privé, connectez-vous à GitHub");
  await dialog.getByRole("button", { name: "Se connecter à GitHub" }).click();
  await expect(dialog.getByRole("group", { name: "Connexion à GitHub" })).toContainText(/code sur GitHub/);
  const opened = page.waitForEvent("popup");
  await dialog.getByRole("button", { name: "Ouvrir GitHub" }).click();
  const popup = await opened;
  await popup.getByRole("link", { name: "Autoriser", exact: true }).click();
  await popup.close();
  await expect(page).toHaveURL(`${ws.root}/catalogue`);
  await expect(page.getByRole("heading", { name: "Catalogue", exact: true })).toBeVisible();
  expect(calls).toHaveLength(2);
  expect(calls[0]).toEqual({ remote_url: remote });
  expect(calls[1]).toEqual({ remote_url: remote, github_flow: expect.stringMatching(/\S+/) });
});

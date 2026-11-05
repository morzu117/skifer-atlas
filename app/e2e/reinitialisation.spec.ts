import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { API, seriousViolations } from "./demo";
import { git, python, test, trackWorkspace } from "./isolation";

// Plan 0034 de bout en bout : un rattachement interrompu laisse le clone dans un état que
// l'écran sait défaire. Les états sont fabriqués avec git dans le clone de l'espace, sur le
// serveur principal (compte anna.k, dépôts nus locaux) : `origin` d'une autre adresse, et une
// publication d'Atlas déjà fusionnée en local (commit d'identité du créateur). Le dépôt
// distant ne doit jamais bouger.

const DATA = process.env.ATLAS_E2E_DATA!;
const unique = () => crypto.randomUUID().slice(0, 8);
const clone = (id: string) => join(DATA, "workspaces", id, "repo");
const refs = (bare: string) => git(bare, "for-each-ref", "--format=%(refname) %(objectname)");
const RESET = "Réinitialiser le rattachement";

function bareRepository(path: string) {
  mkdirSync(dirname(path), { recursive: true });
  execFileSync("git", ["init", "--bare", "--quiet", "--initial-branch=main", path]);
}

async function createSpace(page: Page, id: string) {
  await page.goto("/#/");
  await page.getByRole("button", { name: "Créer un espace" }).click();
  const dialog = page.getByRole("dialog", { name: "Créer un espace" });
  await dialog.getByLabel(/^Nom/).fill(`Réinitialisation ${id}`);
  await dialog.getByLabel(/^Identifiant/).fill(id);
  await dialog.getByLabel("Entités").fill("perrault-fr");
  await dialog.getByRole("button", { name: "Créer l'espace" }).click();
  await expect(page).toHaveURL(new RegExp(`#/w/${id}/catalogue$`));
  await page.goto(`/#/w/${id}/administration`);
  await expect(page.getByRole("heading", { level: 1, name: `Administration — Réinitialisation ${id}` })).toBeVisible();
}

const repository = (page: Page) => page.getByRole("region", { name: "Dépôt Git de l'espace" });
const attachment = (page: Page) => page.getByRole("group", { name: "Rattacher un dépôt distant" });

async function attach(page: Page, url: string) {
  const form = attachment(page);
  await form.getByLabel(/^Adresse du dépôt vide/).fill(url);
  await form.getByRole("button", { name: "Rattacher le dépôt" }).click();
}

/** La publication d'Atlas sous le login « claire-m », fusionnée en local ; le rattachement a échoué
 * ensuite. La gouvernance locale désigne claire-m, le registre garde anna.k. */
function mergeIdentity(repo: string, publication: string) {
  python(`import subprocess, sys
from pathlib import Path
from skifer_atlas.governance.model import dump_governance, rename_account
from skifer_atlas.repo.layout import read_governance
from skifer_atlas.repo.sync import _identity_message
repo = Path(sys.argv[1])
renamed = rename_account(read_governance(repo), sys.argv[2], sys.argv[3])
(repo / "governance.yaml").write_text(dump_governance(renamed), encoding="utf-8")
# La signature d'Atlas : le message exact du commit d'identité du rattachement.
subprocess.run(["git", "-C", str(repo), "commit", "-qam", _identity_message(sys.argv[2], sys.argv[3])], check=True)`, repo, "anna.k", "claire-m");
  git(repo, "push", "-q", publication, "main");
  git(repo, "remote", "add", "origin", publication);
  git(repo, "update-ref", "refs/remotes/origin/main", "HEAD");
  git(repo, "branch", "--set-upstream-to=origin/main", "main");
}

test("[S-0034-01] [S-0034-02] [S-0034-03] [S-0034-08] origin d'une autre adresse : confirmation, réinitialisation locale, puis rattachement ailleurs", async ({ page, request }) => {
  test.setTimeout(120_000);
  const id = `reinit-${unique()}`;
  const root = mkdtempSync(join(tmpdir(), "atlas-reinit-"));
  trackWorkspace(id, root);
  const residual = join(root, "residu.git");
  const wanted = join(root, "voulu.git");
  const other = join(root, "autre.git");
  for (const path of [residual, wanted, other]) bareRepository(path);
  const api = `${API}/api/workspaces/${id}`;

  await createSpace(page, id);
  // Un rattachement interrompu a laissé un origin d'une autre adresse, avec des adresses d'envoi.
  const repo = clone(id);
  git(repo, "remote", "add", "origin", residual);
  git(repo, "config", "--add", "remote.origin.pushurl", join(root, "envoi-1.git"));
  git(repo, "config", "--add", "remote.origin.pushurl", join(root, "envoi-2.git"));
  const head = git(repo, "rev-parse", "HEAD");
  const published = [refs(residual), refs(wanted), refs(other)];

  // [S-0034-01] Le refus dit pourquoi et propose la réinitialisation.
  await attach(page, wanted);
  const alert = attachment(page).getByRole("alert").first();
  await expect(alert).toContainText("Adresse origin différente");
  await expect(alert).not.toContainText(/gho_|x-access-token/);
  const trigger = alert.getByRole("button", { name: RESET });
  await expect(trigger).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);

  // [S-0034-02] La confirmation dit ce qui change et ce qui ne change pas ; rien n'est envoyé avant.
  let resets = 0;
  page.on("request", (req) => req.url().endsWith("/remote/reset") && resets++);
  await trigger.click();
  const dialog = page.getByRole("alertdialog", { name: "Réinitialiser le rattachement ?" });
  await expect(dialog).toContainText("Seule la copie locale de l'espace est réinitialisée");
  await expect(dialog).toContainText("Le dépôt distant n'est pas modifié");
  await expect(dialog).toContainText("il faudra peut-être le vider avant de le réutiliser");
  await expect(dialog.getByRole("button", { name: "Annuler" })).toBeFocused();
  expect(await seriousViolations(page)).toEqual([]);
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Confirmer la réinitialisation" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused(); // le focus revient au bouton qui l'avait ouverte
  await trigger.click();
  await dialog.getByRole("button", { name: "Annuler" }).click();
  await expect(dialog).toHaveCount(0);
  expect(resets).toBe(0);
  expect(git(repo, "remote")).toBe("origin"); // Annuler et Échap n'ont rien changé

  // [S-0034-03] Confirmée : l'espace est comme neuf, et le dépôt distant n'a pas bougé.
  await trigger.click();
  await dialog.getByRole("button", { name: "Confirmer la réinitialisation" }).click();
  const form = attachment(page);
  await expect(form.getByText("Rattachement réinitialisé. Seule la copie locale a changé : le dépôt distant n'a pas été modifié.")).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await expect(form.getByRole("alert")).toHaveCount(0);
  await expect(form.getByLabel(/^Adresse du dépôt vide/)).toHaveValue("");
  await expect(form.getByLabel(/^Adresse du dépôt vide/)).toBeFocused();
  await expect(repository(page).getByText("Pas encore de dépôt distant")).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
  expect(git(repo, "remote")).toBe("");
  expect(git(repo, "config", "--local", "--list")).not.toContain("remote.origin");
  expect(git(repo, "rev-parse", "HEAD")).toBe(head);
  expect([refs(residual), refs(wanted), refs(other)]).toEqual(published);
  expect(await (await request.get(api)).json()).toMatchObject({ git_remote: "", account: "anna.k", role: "referent" });

  // [S-0034-08] Un autre dépôt vide se rattache aussitôt ; l'espace rattaché n'est plus réinitialisable.
  await attach(page, other);
  await expect(repository(page).getByText(`Dépôt rattaché : l'espace est publié sur ${other}, sous le compte anna.k.`)).toBeVisible();
  expect(git(other, "log", "--format=%s", "main")).toBe(`Création de l'espace Réinitialisation ${id}`);
  expect(refs(residual)).toBe(published[0]);
  const refused = await request.post(`${api}/remote/reset`);
  expect(refused.status()).toBe(409);
  expect((await refused.json()).detail.code).toBe("remote_exists");
  expect(git(repo, "remote")).toBe("origin");
});

test("[S-0034-01] [S-0034-04] publication d'Atlas déjà fusionnée en local : la réinitialisation défait le commit d'identité, le créateur reste référent", async ({ page, request }) => {
  test.setTimeout(120_000);
  const id = `reinit-${unique()}`;
  const root = mkdtempSync(join(tmpdir(), "atlas-reinit-"));
  trackWorkspace(id, root);
  const publication = join(root, "publication.git");
  const other = join(root, "autre.git");
  bareRepository(publication);
  bareRepository(other);
  const api = `${API}/api/workspaces/${id}`;

  await createSpace(page, id);
  const repo = clone(id);
  const head = git(repo, "rev-parse", "HEAD");
  mergeIdentity(repo, publication);
  const published = refs(publication);
  expect(git(repo, "show", "HEAD:governance.yaml")).toContain("account: claire-m");

  await attach(page, publication);
  const alert = attachment(page).getByRole("alert").first();
  await expect(alert).toContainText("Rattachement interrompu");
  await expect(alert).toContainText("L'espace a été publié sous le compte « claire-m »");
  await alert.getByRole("button", { name: RESET }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Confirmer la réinitialisation" }).click();

  await expect(attachment(page).getByText(/Rattachement réinitialisé\. Seule la copie locale a changé/)).toBeVisible();
  await expect(repository(page).getByText("Pas encore de dépôt distant")).toBeVisible();
  // La gouvernance est relue : anna.k est de nouveau référent, claire-m n'y est plus.
  const members = page.getByRole("table", { name: "Utilisateurs et rôles" });
  await expect(members.getByRole("row", { name: /anna\.k/ })).toContainText("Référent");
  await expect(members.getByText("claire-m", { exact: true })).toHaveCount(0);
  await expect(page.locator(".sidebar-user")).toContainText("Référent d'annuaire");
  expect(await seriousViolations(page)).toEqual([]);
  // Le clone est un espace local neuf : un commit de retour ramène l'arbre d'avant l'identité, sans
  // réécrire l'historique ni perdre de commit ; le dépôt distant garde sa publication.
  expect(git(repo, "log", "-1", "--format=%s")).toBe("Identité du créateur : claire-m redevient anna.k");
  expect(git(repo, "rev-parse", "HEAD^{tree}")).toBe(git(repo, "rev-parse", `${head}^{tree}`));
  git(repo, "merge-base", "--is-ancestor", head, "HEAD");
  expect(git(repo, "remote")).toBe("");
  expect(git(repo, "for-each-ref", "refs/remotes")).toBe("");
  expect(git(repo, "show", "HEAD:governance.yaml")).toContain("account: anna.k");
  expect(git(repo, "status", "--porcelain")).toBe("");
  expect(refs(publication)).toBe(published);
  expect(await (await request.get(api)).json()).toMatchObject({ git_remote: "", account: "anna.k", role: "referent", space_referent: true });

  // Le rattachement à un autre dépôt vide aboutit, le créateur reste référent.
  await attach(page, other);
  await expect(repository(page).getByText(`Dépôt rattaché : l'espace est publié sur ${other}, sous le compte anna.k.`)).toBeVisible();
  expect(git(other, "rev-parse", "main")).toBe(git(repo, "rev-parse", "HEAD"));
  git(other, "merge-base", "--is-ancestor", head, "main");
  expect(refs(publication)).toBe(published);
  expect(await (await request.get(api)).json()).toMatchObject({ git_remote: other, role: "referent" });
});

test("[S-0034-10] un espace à moitié rattaché rouvert : la bannière de la coque, sans l'Administration, réinitialise et rend le rôle de référent", async ({ page, request }) => {
  test.setTimeout(120_000);
  const id = `reinit-${unique()}`;
  const root = mkdtempSync(join(tmpdir(), "atlas-reinit-"));
  trackWorkspace(id, root);
  const publication = join(root, "publication.git");
  bareRepository(publication);
  const api = `${API}/api/workspaces/${id}`;

  await createSpace(page, id);
  const repo = clone(id);
  const head = git(repo, "rev-parse", "HEAD");
  mergeIdentity(repo, publication);
  const published = refs(publication);

  // L'utilisateur a quitté l'écran : il rouvre l'espace. La gouvernance locale désigne claire-m.
  expect(await (await request.get(api)).json()).toMatchObject({ attachment: "interrupted", space_referent: false });
  expect((await request.get(`${api}/admin`)).status()).toBe(403);
  await page.goto("/#/");
  await page.goto(`/#/w/${id}/catalogue`);
  const banner = page.getByRole("alert").filter({ hasText: "Le rattachement de cet espace à un dépôt a été interrompu." });
  await expect(banner).toBeVisible();
  await expect(page.getByRole("link", { name: "Administration" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Reprendre le rattachement" })).toHaveCount(0);
  expect(await seriousViolations(page)).toEqual([]);

  // Au clavier : le bouton s'atteint, Entrée ouvre la confirmation, focus sur « Annuler ».
  const trigger = banner.getByRole("button", { name: RESET });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("alertdialog", { name: "Réinitialiser le rattachement ?" });
  await expect(dialog.getByRole("button", { name: "Annuler" })).toBeFocused();
  await expect(dialog).toContainText("Le dépôt distant n'est pas modifié");
  expect(await seriousViolations(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Enter");
  await dialog.getByRole("button", { name: "Confirmer la réinitialisation" }).click();

  await expect(page.getByText("Rattachement réinitialisé. Seule la copie locale a changé : le dépôt distant n'a pas été modifié.")).toBeVisible();
  await expect(banner).toHaveCount(0);
  await expect(page.locator(".sidebar-user")).toContainText("Référent d'annuaire");
  await expect(page.getByRole("link", { name: "Administration" })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
  // L'espace est local et neuf, le rôle est revenu après relecture, le dépôt distant n'a pas bougé.
  expect(await (await request.get(api)).json()).toMatchObject({ attachment: null, space_referent: true, git_remote: "" });
  expect((await request.get(`${api}/admin`)).status()).toBe(200);
  expect(git(repo, "remote")).toBe("");
  expect(git(repo, "rev-parse", "HEAD^{tree}")).toBe(git(repo, "rev-parse", `${head}^{tree}`));
  expect(refs(publication)).toBe(published);
  await page.reload();
  await expect(page.locator(".sidebar-user")).toContainText("Référent d'annuaire");
  await expect(page.getByRole("alert").filter({ hasText: "a été interrompu" })).toHaveCount(0);
});

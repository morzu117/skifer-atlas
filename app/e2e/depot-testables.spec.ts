import { chmodSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "@playwright/test";
import { AUTH_API, CORE, git, isolatedDemo, python, relay, test } from "./isolation";

function push(work: string, message: string) {
  git(work, "add", "."); git(work, "commit", "-qm", message); git(work, "push", "origin", "main");
}
function clonePath(id: string) {
  return python(`import os,sys
os.environ['ATLAS_DATA_DIR']=sys.argv[1]
from skifer_atlas.workspaces import repo_dir
print(repo_dir(sys.argv[2]))`, join(process.env.ATLAS_E2E_DATA!, "auth"), id).trim();
}

test("[S-0005-05] Un YAML invalide est indexé et filtré Invalide", async ({ page, request }) => {
  const ws = await isolatedDemo(request, AUTH_API);
  writeFileSync(join(ws.work, "kpis/invalide.yaml"), "schema_version: 1\nkind: kpi\ndata_product: {id: invalide, version: 1, owner: claire.m, domain: finance}\nlabel: Document invalide\ngraph: {nodes: [], output: n01}\n");
  push(ws.work, "Document invalide");
  expect((await request.post(`${ws.api}/sync`)).ok()).toBe(true);
  await relay(page, AUTH_API);
  await page.goto(`${ws.root}/catalogue`);
  // Le tableau n'a pas de colonne Statut (guide 10.1) : le statut se lit par son filtre.
  const status = page.getByRole("combobox", { name: "Statut", exact: true });
  await status.selectOption({ label: "Invalide" });
  await expect(status).toHaveValue("invalid");
  await expect(page.getByRole("row").filter({ hasText: "Document invalide" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Revenu net", exact: true })).toHaveCount(0);
  await page.goto(`${ws.root}/editeur?from=invalide`);
  await expect(page.getByRole("region", { name: "Validation du document" })).toContainText("Schéma invalide");
});

test("[S-0005-11] Une divergence au sync laisse le clone intact", async ({ page, request }) => {
  const ws = await isolatedDemo(request, AUTH_API);
  const clone = clonePath(ws.id);
  writeFileSync(join(clone, "locale.md"), "Note locale\n");
  git(clone, "add", "."); git(clone, "commit", "-qm", "Commit local");
  const before = git(clone, "rev-parse", "HEAD");
  writeFileSync(join(ws.work, "distante.md"), "Note distante\n");
  push(ws.work, "Commit distant");
  await relay(page, AUTH_API);
  await page.goto(`${ws.root}/administration`);
  await page.getByRole("button", { name: "Synchroniser", exact: true }).click();
  // julien.h est seul référent : le bandeau de la page est une autre alerte.
  await expect(page.getByRole("region", { name: "Dépôt Git de l'espace" }).getByRole("alert")).toContainText("Le dépôt local a divergé du dépôt distant");
  expect(git(clone, "rev-parse", "HEAD")).toBe(before);
  expect(git(clone, "status", "--porcelain")).toBe("");
  expect(git(clone, "ls-tree", "--name-only", "HEAD")).not.toContain("distante.md");
  expect(readFileSync(join(clone, "locale.md"), "utf8")).toBe("Note locale\n");
});

test("[S-0006-11] CODEOWNERS modifié à la main est signalé au sync", async ({ page, request }) => {
  const ws = await isolatedDemo(request, AUTH_API);
  mkdirSync(join(ws.work, ".github"), { recursive: true });
  writeFileSync(join(ws.work, ".github/CODEOWNERS"), "* @intrus\n");
  push(ws.work, "CODEOWNERS manuel");
  await relay(page, AUTH_API);
  await page.goto(`${ws.root}/administration`);
  await page.getByRole("button", { name: "Synchroniser", exact: true }).click();
  await expect(page.getByRole("region", { name: "Dépôt Git de l'espace" })).toContainText("CODEOWNERS a été modifié à la main");
});

test("[S-0020-03] Une poussée de tag refusée garde le tag local et affiche l'avertissement", async ({ page, request }) => {
  const ws = await isolatedDemo(request, AUTH_API);
  git(ws.work, "checkout", "-b", "version-externe");
  const path = join(ws.work, "kpis/revenu-net.yaml");
  writeFileSync(path, readFileSync(path, "utf8").replace("version: 4\n", "version: 5\n"));
  git(ws.work, "add", "."); git(ws.work, "commit", "-qm", "Version 5 externe");
  git(ws.work, "checkout", "main"); git(ws.work, "merge", "--no-ff", "version-externe", "-m", "Fusion externe");
  const commit = git(ws.work, "rev-parse", "HEAD");
  git(ws.work, "push", "origin", "main");
  const hook = join(ws.remote, "hooks/pre-receive");
  writeFileSync(hook, '#!/bin/sh\nwhile read old new ref; do\n case "$ref" in refs/tags/*) exit 1;; esac\ndone\nexit 0\n');
  chmodSync(hook, 0o755);
  await relay(page, AUTH_API); await page.goto(`${ws.root}/administration`);
  await page.getByRole("button", { name: "Synchroniser", exact: true }).click();
  await expect(page.getByRole("region", { name: "Dépôt Git de l'espace" })).toContainText("Les tags n'ont pas pu être poussés");
  expect(git(clonePath(ws.id), "rev-parse", "doc/revenu-net/v5^{}")).toBe(commit);
  expect(git(ws.remote, "tag", "--list", "doc/revenu-net/v5")).toBe("");
});

test("[S-0004-06] Les messages de résidu ne reprennent aucun littéral SQL", async ({ page, request }) => {
  const ws = await isolatedDemo(request, AUTH_API);
  copyFileSync(join(CORE, "tests/fixtures/sql/sentinelles.sql"), join(ws.work, "implementations/revenu-net/nordis-fr/databricks.sql"));
  push(ws.work, "SQL à sentinelles");
  expect((await request.post(`${ws.api}/sync`)).ok()).toBe(true);
  await relay(page, AUTH_API); await page.goto(`${ws.root}/fiche/revenu-net?tab=implementations`);
  const section = page.getByRole("region", { name: "nordis-fr · Databricks" });
  await expect(section).toContainText("ZQX_SECRET"); // témoin : c'est bien le SQL semé
  await section.getByRole("button", { name: "Extraire et comparer au canonique" }).click();
  const residues = section.locator(".extraction > .fact-warn, .extraction-residues li");
  await expect(residues.first()).toBeVisible();
  expect(await residues.count()).toBeGreaterThan(0);
  expect((await residues.allTextContents()).join("\n")).not.toMatch(/zqx|987654321/i);
});

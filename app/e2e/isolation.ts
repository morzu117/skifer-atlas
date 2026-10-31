import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { API, demoRemote } from "./demo";

export const AUTH_API = "http://127.0.0.1:8793";
export const CORE = fileURLToPath(new URL("../../core", import.meta.url));
export function git(repo: string, ...args: string[]) {
  return execFileSync("git", ["-C", repo, "-c", "user.name=Scénarios Atlas", "-c", "user.email=e2e@example.invalid", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8" }).trim();
}
export function python(script: string, ...args: string[]) {
  return execFileSync("uv", ["run", "--project", CORE, "python", "-c", script, ...args], { encoding: "utf8" });
}
/** Chaque manipulation de dépôt possède un distant et un identifiant propres. */
export async function isolatedDemo(request: APIRequestContext, server: string) {
  const remote = demoRemote();
  const work = mkdtempSync(join(tmpdir(), "atlas-scenario-"));
  git(work, "clone", remote, ".");
  const id = `scenario-${Date.now().toString(36)}`;
  python("import sys,yaml; from pathlib import Path; p=Path(sys.argv[1])/'atlas.yaml'; d=yaml.safe_load(p.read_text()); d['id']=sys.argv[2]; p.write_text(yaml.safe_dump(d,allow_unicode=True,sort_keys=False))", work, id);
  git(work, "add", "atlas.yaml");
  git(work, "commit", "-qm", "Espace isolé pour le scénario");
  git(work, "push", "origin", "main");
  const response = await request.post(`${server}/api/workspaces/join`, { data: { remote_url: remote } });
  expect(response.status(), await response.text()).toBe(201);
  return { id, remote, work, api: `${server}/api/workspaces/${id}`, root: `/#/w/${id}` };
}
/** L'app parle au serveur `server` : ses requêtes vers le serveur principal y sont relayées.
 * Un relais encore en vol à la fin du test (relevés de la coque) est abandonné sans erreur ;
 * un serveur injoignable se voit comme une connexion refusée, comme sans relais. */
export async function relay(page: Page, server: string) {
  await page.route(`${API}/**`, async (route) => {
    let response;
    try {
      response = await route.fetch({ url: route.request().url().replace(API, server) });
    } catch {
      await route.abort("connectionrefused").catch(() => undefined);
      return;
    }
    await route.fulfill({ response }).catch(() => undefined);
  });
}

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test as base, type APIRequestContext, type Page } from "@playwright/test";
import { API, demoRemote } from "./demo";

// Dossiers de données des serveurs de playwright.config.ts : un espace isolé peut avoir été
// rejoint par plusieurs comptes (relecteurs des propositions, par exemple).
const DATA = process.env.ATLAS_E2E_DATA!;
const SERVER_DATA = [DATA, ...["claire.m", "marc.d", "julien.h", "auth", "accueil"].map((dir) => join(DATA, dir))];
const temporary = new Set<string>();
const joined = new Set<string>();

/** Après chaque test, même en échec : la page est fermée (plus de relevés de la coque), puis
 * les dépôts temporaires sont supprimés et les espaces isolés retirés du registre de chaque
 * serveur. Sans ce retrait, chaque serveur accumule les espaces des scénarios : la liste
 * des espaces, relue par la coque à chaque écran, s'allonge (compteurs de chaque espace),
 * et le serveur principal affiche plusieurs « Groupe Nordis » aux scénarios suivants.
 *
 * Un `test.afterEach` déclaré dans ce module ne s'appliquerait qu'au premier fichier qui
 * l'importe dans un worker (module mis en cache) : d'où une fixture automatique, et les
 * fichiers qui isolent leurs scénarios importent `test` d'ici. */
export const test = base.extend<{ isolation: void }>({
  isolation: [async ({ page }, use) => {
    await use();
    await page.close();
    forget([...joined], [...temporary]);
    joined.clear();
    temporary.clear();
  }, { auto: true }],
});

/** Retire les espaces `ids` du registre de chaque serveur et supprime les dossiers `paths`. */
function forget(ids: string[], paths: string[]) {
  if (ids.length) {
    python(`import sys,shutil,yaml
from pathlib import Path
ids=set(sys.argv[2:])
for root in sys.argv[1].split("\\n"):
    registry=Path(root)/"workspaces.yaml"
    if registry.exists():
        data=yaml.safe_load(registry.read_text(encoding="utf-8")) or {}
        kept=[w for w in data.get("workspaces",[]) if w.get("id") not in ids]
        if len(kept)!=len(data.get("workspaces",[])):
            data["workspaces"]=kept
            registry.write_text(yaml.safe_dump(data,allow_unicode=True,sort_keys=False),encoding="utf-8")
    for ident in ids:
        shutil.rmtree(Path(root)/"workspaces"/ident,ignore_errors=True)`, SERVER_DATA.join("\n"), ...ids);
  }
  for (const path of paths) rmSync(path, { recursive: true, force: true });
}

export const AUTH_API = "http://127.0.0.1:8793";
export const CORE = fileURLToPath(new URL("../../core", import.meta.url));
export function git(repo: string, ...args: string[]) {
  return execFileSync("git", ["-C", repo, "-c", "user.name=Scénarios Atlas", "-c", "user.email=e2e@example.invalid", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8" }).trim();
}
export function python(script: string, ...args: string[]) {
  return execFileSync("uv", ["run", "--project", CORE, "python", "-c", script, ...args], { encoding: "utf8" });
}
type Demo = { id: string; remote: string; work: string; api: string; root: string };
async function createDemo(request: APIRequestContext, server: string, track: (id: string, ...paths: string[]) => void): Promise<Demo> {
  const remote = demoRemote();
  const work = mkdtempSync(join(tmpdir(), "atlas-scenario-"));
  const id = `scenario-${crypto.randomUUID()}`;
  track(id, work, dirname(remote));
  git(work, "clone", remote, ".");
  python("import sys,yaml; from pathlib import Path; p=Path(sys.argv[1])/'atlas.yaml'; d=yaml.safe_load(p.read_text()); d['id']=sys.argv[2]; p.write_text(yaml.safe_dump(d,allow_unicode=True,sort_keys=False))", work, id);
  git(work, "add", "atlas.yaml");
  git(work, "commit", "-qm", "Espace isolé pour le scénario");
  git(work, "push", "origin", "main");
  const response = await request.post(`${server}/api/workspaces/join`, { data: { remote_url: remote } });
  expect(response.status(), await response.text()).toBe(201);
  return { id, remote, work, api: `${server}/api/workspaces/${id}`, root: `/#/w/${id}` };
}
/** Chaque manipulation de dépôt possède un distant et un identifiant propres, oubliés à la
 * fin du test. */
export async function isolatedDemo(request: APIRequestContext, server: string) {
  return createDemo(request, server, (id, ...paths) => {
    joined.add(id);
    for (const path of paths) temporary.add(path);
  });
}
/** Un espace isolé partagé par les tests d'un fichier qui ne modifient ni le dépôt ni
 * l'espace (brouillons à identifiant unique, vérifications) : créé dans `beforeAll`, rendu
 * par `releaseSharedDemo` dans `afterAll`. */
const shared = new Map<string, string[]>();
export async function sharedDemo(request: APIRequestContext, server: string) {
  return createDemo(request, server, (id, ...paths) => { shared.set(id, paths); });
}
export function releaseSharedDemo(ws: Demo | undefined) {
  if (!ws) return;
  forget([ws.id], shared.get(ws.id) ?? []);
  shared.delete(ws.id);
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

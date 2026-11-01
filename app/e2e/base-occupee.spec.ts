import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { AUTH_API, CORE, isolatedDemo, python, relay, test } from "./isolation";

// Plan 0028 de bout en bout : un autre processus Atlas (la CLI, par exemple) tient la base
// DuckDB de l'espace pendant que l'app lit le catalogue.

/** Base DuckDB de l'espace `id` sur le serveur AUTH_API (workspaces.index_path). */
function databasePath(id: string) {
  return python(`import os,sys
os.environ['ATLAS_DATA_DIR']=sys.argv[1]
from skifer_atlas.workspaces import index_path
print(index_path(sys.argv[2]))`, join(process.env.ATLAS_E2E_DATA!, "auth"), id).trim();
}

type Holder = { process: ChildProcess; running: () => boolean; ended: Promise<void> };
const holders = new Set<Holder>();

/** Un autre processus ouvre la base, la garde `seconds` secondes, puis la ferme. Rendu une
 * fois la base ouverte (ligne « ouverte »). Groupe de processus à part : `uv run` et son
 * Python s'arrêtent ensemble en fin de test. */
async function holdDatabase(path: string, seconds: number): Promise<Holder> {
  const script = `import sys,time,duckdb
connection=duckdb.connect(sys.argv[1])
print("ouverte",flush=True)
time.sleep(float(sys.argv[2]))
connection.close()`;
  const child = spawn("uv", ["run", "--project", CORE, "python", "-c", script, path, String(seconds)], {
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let done = false;
  const ended = new Promise<void>((resolve) => child.once("exit", () => { done = true; resolve(); }));
  const holder: Holder = { process: child, running: () => !done, ended };
  holders.add(holder);
  let errors = "";
  child.stderr!.on("data", (chunk) => { errors += chunk; });
  await new Promise<void>((resolve, reject) => {
    let out = "";
    child.stdout!.on("data", (chunk) => {
      out += chunk;
      if (out.includes("ouverte")) resolve();
    });
    child.once("exit", (code) => reject(new Error(`La base n'a pas été ouverte (code ${code}) : ${errors}`)));
    child.once("error", reject);
  });
  return holder;
}

// Même en échec : le processus qui tient la base est arrêté.
test.afterEach(async () => {
  for (const holder of holders) {
    if (holder.running() && holder.process.pid) {
      try { process.kill(-holder.process.pid, "SIGKILL"); } catch { /* déjà terminé */ }
      await holder.ended;
    }
  }
  holders.clear();
});

const table = (page: Page) => page.getByRole("table", { name: "Concepts et KPI" });
const revenuNet = (page: Page) => table(page).getByRole("link", { name: "Revenu net", exact: true });
const busy = (page: Page) => page.getByRole("alert").filter({ hasText: "Base de l'espace occupée" });

test("[S-0028-01] La base tenue quelques secondes par un autre processus : le catalogue attend, puis se charge", async ({ page, request }) => {
  const ws = await isolatedDemo(request, AUTH_API);
  // Index construit d'avance : l'attente mesurée est celle de la base, pas de l'indexation.
  expect((await request.get(`${ws.api}/catalog`)).ok()).toBe(true);
  const holder = await holdDatabase(databasePath(ws.id), 3);
  await relay(page, AUTH_API);
  await page.goto(`${ws.root}/catalogue`);
  // Tant que la base est tenue, rien ne peut se lire : le catalogue n'est pas encore là.
  expect(holder.running()).toBe(true);
  await expect(revenuNet(page)).toHaveCount(0);
  await expect(revenuNet(page)).toBeVisible({ timeout: 15_000 });
  await expect(table(page)).toHaveAttribute("aria-busy", "false");
  await expect(busy(page)).toHaveCount(0);
  await expect(page.getByText("Base de l'espace occupée")).toHaveCount(0);
});

test("[S-0028-02] La base tenue plus de 10 s : le catalogue l'explique, puis se recharge une fois libérée", async ({ page, request }) => {
  test.setTimeout(60_000);
  const ws = await isolatedDemo(request, AUTH_API);
  expect((await request.get(`${ws.api}/catalog`)).ok()).toBe(true);
  const holder = await holdDatabase(databasePath(ws.id), 15);
  await relay(page, AUTH_API);
  await page.goto(`${ws.root}/catalogue`);
  // L'API attend 10 s, puis répond 503 index_busy : l'écran dit pourquoi et quoi faire.
  await expect(busy(page)).toBeVisible({ timeout: 20_000 });
  await expect(busy(page)).toContainText("Réessayez quand il aura fini");
  expect(holder.running()).toBe(true);
  await expect(revenuNet(page)).toHaveCount(0);
  // Le catalogue n'a pas de bouton « Réessayer » : on recharge l'écran une fois la base libérée.
  await holder.ended;
  await page.reload();
  await expect(revenuNet(page)).toBeVisible();
  await expect(busy(page)).toHaveCount(0);
});

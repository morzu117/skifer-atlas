import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import type { APIRequestContext, Page } from "@playwright/test";

// Outils communs aux tests de bout en bout : dépôt de démonstration, accessibilité.

export const API = "http://127.0.0.1:8799";
const SCRIPT = fileURLToPath(new URL("../../examples/depot-nordis.sh", import.meta.url));
const PROPOSALS = fileURLToPath(new URL("../../examples/propositions-nordis.py", import.meta.url));
const CORE = fileURLToPath(new URL("../../core", import.meta.url));

/** Le dépôt de démonstration et l'historique de Revenu net, en dépôt nu « distant »
 * (examples/depot-nordis.sh), avec ses cinq propositions ouvertes
 * (examples/propositions-nordis.py). */
export function demoRemote(): string {
  const root = mkdtempSync(join(tmpdir(), "atlas-demo-"));
  execFileSync("bash", [SCRIPT, root]);
  const remote = join(root, "distant.git");
  execFileSync("uv", ["run", "--project", CORE, "python", PROPOSALS, remote]);
  return remote;
}

/** Groupe Nordis au registre du serveur, rejoint ici s'il ne l'est pas déjà. */
export async function ensureNordis(request: APIRequestContext) {
  const listed = (await (await request.get(`${API}/api/workspaces`)).json()) as { id: string }[];
  if (listed.some((ws) => ws.id === "groupe-nordis")) return;
  const joined = await request.post(`${API}/api/workspaces/join`, { data: { remote_url: demoRemote() } });
  if (!joined.ok()) throw new Error(await joined.text());
}

/** Violations axe sérieuses ou critiques, contraste compris (ADR 0014). */
export async function seriousViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  return violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({ id: v.id, nodes: v.nodes.map((node) => node.html) }));
}

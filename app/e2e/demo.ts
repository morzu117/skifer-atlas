import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import type { APIRequestContext, Page } from "@playwright/test";

// Outils communs aux tests de bout en bout : dépôt de démonstration, accessibilité.

export const API = "http://127.0.0.1:8799";
const EXAMPLE = fileURLToPath(new URL("../../examples/espace-nordis", import.meta.url));

/** Le dépôt de démonstration, en dépôt nu « distant » (examples/espace-nordis/README.md). */
export function demoRemote(): string {
  const root = mkdtempSync(join(tmpdir(), "atlas-demo-"));
  const work = join(root, "travail");
  cpSync(EXAMPLE, work, { recursive: true });
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", ["-c", "user.name=Démo", "-c", "user.email=demo@exemple.invalid", ...args], { cwd });
  git(work, "init", "-q", "-b", "main");
  git(work, "add", "-A");
  git(work, "commit", "-qm", "Espace Groupe Nordis");
  const bare = join(root, "distant.git");
  git(root, "clone", "-q", "--bare", work, bare);
  return bare;
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

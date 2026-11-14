import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

// Script de démonstration (examples/demo/lancer-demo.sh, README de examples/demo) : en
// `DEMO_SANS_APP=1`, il prépare l'espace Groupe Nordis dans le dossier donné, le fait rejoindre
// par un serveur éphémère, puis s'arrête avec le code 0. C'est le test de fumée que le README
// annonce (« Avec `DEMO_SANS_APP=1`, le script s'arrête après la préparation »).
//
// Le script tourne comme depuis un terminal : sans les variables que playwright.config.ts pose
// pour ses propres serveurs (ATLAS_ALLOW_LOCAL_GIT, ATLAS_E2E_DATA, ports…), qui masqueraient
// ce que le script doit fournir lui-même. Il ne touche ni aux vraies données ni au trousseau :
// dossier temporaire, ATLAS_VAULT=memory posé par le script.

const SCRIPT = fileURLToPath(new URL("../../examples/demo/lancer-demo.sh", import.meta.url));

test("[S-UI-DEMO-01] « DEMO_SANS_APP=1 lancer-demo.sh <dossier> » prépare la démonstration et sort avec le code 0", async () => {
  test.setTimeout(240_000);
  const root = mkdtempSync(join(tmpdir(), "atlas-lancer-demo-"));
  const demo = join(root, "demo"); // absent : le script le crée
  try {
    const env: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (!key.startsWith("ATLAS_") && !key.startsWith("SF_") && !key.startsWith("PLAYWRIGHT") && !key.startsWith("GIT_CONFIG")) env[key] = value;
    }
    env.DEMO_SANS_APP = "1";
    const run = spawnSync("bash", [SCRIPT, demo], { env, encoding: "utf8", timeout: 220_000 });
    const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
    expect(run.status, `code de sortie ${run.status}, sortie :\n${output}`).toBe(0);
    expect(run.stdout).toContain("Préparation terminée");
    // L'espace a été rejoint : son clone est dans le dossier de données de la démonstration.
    expect(existsSync(join(demo, "donnees", "workspaces", "groupe-nordis"))).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

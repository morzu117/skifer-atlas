// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// ADR 0041 : la fenêtre Tauri applique la CSP de tauri.conf.json. Aucun test de rendu ne la
// voit (Vite en développement n'envoie pas d'en-tête) : ce contrôle garde au moins sa forme.

const CONFIG = fileURLToPath(new URL("../src-tauri/tauri.conf.json", import.meta.url));
const { app } = JSON.parse(readFileSync(CONFIG, "utf-8")) as { app: { security: { csp: string; devCsp: string } } };

function directives(policy: string): Record<string, string[]> {
  return Object.fromEntries(
    policy.split(";").map((part) => {
      const [name, ...sources] = part.trim().split(/\s+/);
      return [name, sources];
    }),
  );
}

describe("CSP de la fenêtre Tauri", () => {
  const csp = directives(app.security.csp);

  it("[S-0019-09] ne charge que depuis l'application", () => {
    expect(csp["default-src"]).toEqual(["'self'"]);
    expect(csp["script-src"]).toEqual(["'self'"]);
    expect(csp["font-src"]).toEqual(["'self'"]);
    expect(csp["object-src"]).toEqual(["'none'"]);
    expect(csp["frame-src"]).toEqual(["'none'"]);
    expect(csp["base-uri"]).toEqual(["'none'"]);
  });

  it("[S-0019-09] n'ouvre aucun script inline ni eval", () => {
    for (const [name, sources] of Object.entries(csp)) {
      if (name === "style-src") continue; // styles de CodeMirror et attributs style de React
      expect(sources, name).not.toContain("'unsafe-inline'");
    }
    expect(app.security.csp).not.toContain("'unsafe-eval'");
  });

  it("[S-0019-09] ne joint que le serveur local et le canal de Tauri", () => {
    expect(csp["connect-src"]).toEqual(["'self'", "ipc:", "http://ipc.localhost", "http://127.0.0.1:*"]);
    expect(csp["img-src"]).toEqual(["'self'", "data:"]);
  });

  it("[S-0019-09] aucune source distante, hors la boucle locale", () => {
    const remote = [app.security.csp, app.security.devCsp].flatMap((policy) =>
      policy.split(/\s+/).filter((source) => /^(https?|wss?):\/\//.test(source) && !/^(https?|wss?):\/\/(127\.0\.0\.1|localhost|ipc\.localhost)/.test(source)),
    );
    expect(remote).toEqual([]);
  });

  it("[S-0019-09] la CSP de développement ne desserre que le serveur de Vite", () => {
    const dev = directives(app.security.devCsp);
    expect(dev["connect-src"]).toEqual(expect.arrayContaining(["ws://localhost:1420", "http://localhost:1420"]));
    expect(dev["default-src"]).toEqual(["'self'"]);
    expect(dev["object-src"]).toEqual(["'none'"]);
  });
});

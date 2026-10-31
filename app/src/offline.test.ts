// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Critère 4 (plan 0019) : hors ligne, l'interface ne charge rien d'ailleurs que du
// sidecar local. Ni police, ni feuille de style, ni script distant ; les polices sont
// des fichiers du dépôt.

const SRC = fileURLToPath(new URL(".", import.meta.url));
const INDEX = fileURLToPath(new URL("../index.html", import.meta.url));
const REMOTE = /https?:\/\/(?!127\.0\.0\.1|localhost)/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(css|ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("hors ligne", () => {
  it("aucune ressource distante dans index.html ni dans les feuilles de style", () => {
    const sheets = files(SRC).filter((path) => path.endsWith(".css"));
    const offenders = [INDEX, ...sheets].filter((path) => REMOTE.test(readFileSync(path, "utf-8")));
    expect(offenders.map((path) => relative(SRC, path))).toEqual([]);
  });

  it("aucun import de module ni chargement distant dans le code", () => {
    const loads = /(?:import\s*\(|from\s+|fetch\(|new URL\(|src=|href=)\s*["'`]https?:\/\/(?!127\.0\.0\.1|localhost)/;
    const offenders = files(SRC).filter((path) => loads.test(readFileSync(path, "utf-8")));
    expect(offenders.map((path) => relative(SRC, path))).toEqual([]);
  });

  it("les polices déclarées sont dans le dépôt", () => {
    const sheet = join(SRC, "fonts.css");
    const urls = [...readFileSync(sheet, "utf-8").matchAll(/url\("([^"]+)"\)/g)].map((m) => m[1]);
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.filter((url) => !existsSync(join(dirname(sheet), url)))).toEqual([]);
  });
});

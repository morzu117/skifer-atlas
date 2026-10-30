// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Critère 8 (plan 0010) : aucune couleur ni taille en dur hors des tokens.

const SRC = fileURLToPath(new URL(".", import.meta.url));
const TOKENS = "tokens.css";

// Exceptions explicites, chacune justifiée.
const EXCEPTIONS: Record<string, string> = {
  "tokens.test.ts": "ce test contient les motifs qu'il cherche",
  "test/fakeServer.ts": "données de test",
};

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(css|ts|tsx)$/.test(name) ? [path] : [];
  });
}

function offenders(pattern: RegExp): string[] {
  return files(SRC)
    .map((path) => relative(SRC, path))
    .filter((path) => path !== TOKENS && !(path in EXCEPTIONS) && !path.endsWith(".test.tsx"))
    .flatMap((path) =>
      readFileSync(join(SRC, path), "utf-8")
        .split("\n")
        .flatMap((line, index) => (pattern.test(line) ? [`${path}:${index + 1}: ${line.trim()}`] : [])),
    );
}

describe("tokens", () => {
  it("aucune couleur hexadécimale hors tokens.css", () => {
    expect(offenders(/#[0-9a-fA-F]{3,8}\b/)).toEqual([]);
  });

  it("aucune taille en px hors tokens.css", () => {
    expect(offenders(/\d+(\.\d+)?px\b/)).toEqual([]);
  });

  it("app/src/tokens.css est la copie exacte de docs/design/tokens.css", () => {
    const design = readFileSync(join(SRC, "../../docs/design/tokens.css"), "utf-8");
    expect(readFileSync(join(SRC, TOKENS), "utf-8")).toBe(design);
  });

  it("aucune police chargée depuis le réseau", () => {
    expect(offenders(/fonts\.googleapis|fonts\.gstatic/)).toEqual([]);
  });
});

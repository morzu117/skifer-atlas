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

  it("réserve les tokens teal décoratifs aux usages autres que le texte", () => {
    const css = readFileSync(join(SRC, "styles.css"), "utf-8").replace(/\/\*[\s\S]*?\*\//g, "");
    // Ajouter ici un sélecteur et sa justification uniquement pour un fond sombre vérifié.
    const darkBackgroundExceptions: Record<string, string> = {};
    const violations = Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g)).flatMap(([, selector, body]) => {
      const rule = selector.trim();
      if (rule in darkBackgroundExceptions) return [];
      return body.split(";").flatMap((declaration) =>
        /^\s*color\s*:[\s\S]*\bvar\(\s*--atlas-(?:mid|ok|node-ref)\s*[,)]/i.test(declaration)
          ? [`${rule}: ${declaration.trim()}`]
          : [],
      );
    });
    expect(violations).toEqual([]);
  });

  it("le texte teal contraste avec les fonds clairs", () => {
    const css = readFileSync(join(SRC, TOKENS), "utf-8");
    const luminance = (name: string): number => {
      const hex = css.match(new RegExp(`--atlas-${name}:\\s*#([0-9a-f]{6})\\b`, "i"))?.[1];
      if (!hex) throw new Error(`Token de couleur introuvable : ${name}`);
      const channels = [0, 2, 4].map((offset) => {
        const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const text = luminance("mid-text");
    for (const background of ["ground", "panel", "pale", "warn-bg", "warn-cell", "bad-bg"]) {
      const bg = luminance(background);
      expect((Math.max(text, bg) + 0.05) / (Math.min(text, bg) + 0.05), background).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("aucune police chargée depuis le réseau", () => {
    expect(offenders(/fonts\.googleapis|fonts\.gstatic/)).toEqual([]);
  });
});

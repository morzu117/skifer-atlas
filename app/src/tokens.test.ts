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

  it("les déclarations CSS utilisent des tokens pour les couleurs et dimensions", () => {
    const css = readFileSync(join(SRC, "styles.css"), "utf-8").replace(/\/\*[\s\S]*?\*\//g, "");
    // Dimensions relatives nécessaires à la structure, au placement des ports et à l'animation.
    const structural: Record<string, string[]> = {
      "min-height": ["100%", "100vh"], height: ["100%", "100vh"], width: ["100%"],
      "max-width": ["100%"], "border-radius": ["50%"], top: ["40%", "75%", "calc(100% + var(--atlas-space-1))"],
      transform: ["translateY(-50%)"], "background-size": ["200% 100%"],
      "background-position": ["100% 0", "-100% 0"],
      "grid-template-columns": ["repeat(auto-fill, minmax(var(--atlas-card-min-w), 1fr))", "repeat(auto-fit, minmax(var(--atlas-card-min-w), 1fr))", "repeat(2, minmax(0, 1fr))", "repeat(auto-fit, minmax(min(100%, var(--atlas-diff-col-min)), 1fr))", "repeat(auto-fit, minmax(min(100%, var(--atlas-queue-basis)), 1fr))", "repeat(auto-fit, minmax(min(100%, var(--atlas-admin-col-min)), 1fr))"],
    };
    // transparent et currentColor sont des mots-clés de composition, pas des couleurs de palette.
    const colors = /\b(?:aliceblue|antiquewhite|aqua|aquamarine|azure|beige|bisque|black|blanchedalmond|blue|blueviolet|brown|burlywood|cadetblue|chartreuse|chocolate|coral|cornflowerblue|cornsilk|crimson|cyan|darkblue|darkcyan|darkgoldenrod|darkgray|darkgreen|darkgrey|darkkhaki|darkmagenta|darkolivegreen|darkorange|darkorchid|darkred|darksalmon|darkseagreen|darkslateblue|darkslategray|darkslategrey|darkturquoise|darkviolet|deeppink|deepskyblue|dimgray|dimgrey|dodgerblue|firebrick|floralwhite|forestgreen|fuchsia|gainsboro|ghostwhite|gold|goldenrod|gray|green|greenyellow|grey|honeydew|hotpink|indianred|indigo|ivory|khaki|lavender|lavenderblush|lawngreen|lemonchiffon|lightblue|lightcoral|lightcyan|lightgoldenrodyellow|lightgray|lightgreen|lightgrey|lightpink|lightsalmon|lightseagreen|lightskyblue|lightslategray|lightslategrey|lightsteelblue|lightyellow|lime|limegreen|linen|magenta|maroon|mediumaquamarine|mediumblue|mediumorchid|mediumpurple|mediumseagreen|mediumslateblue|mediumspringgreen|mediumturquoise|mediumvioletred|midnightblue|mintcream|mistyrose|moccasin|navajowhite|navy|oldlace|olive|olivedrab|orange|orangered|orchid|palegoldenrod|palegreen|paleturquoise|palevioletred|papayawhip|peachpuff|peru|pink|plum|powderblue|purple|rebeccapurple|red|rosybrown|royalblue|saddlebrown|salmon|sandybrown|seagreen|seashell|sienna|silver|skyblue|slateblue|slategray|slategrey|snow|springgreen|steelblue|tan|teal|thistle|tomato|turquoise|violet|wheat|white|whitesmoke|yellow|yellowgreen)\b/i;
    const violations: string[] = [];
    for (const [, body] of css.matchAll(/\{([^{}]*)\}/g)) {
      for (const declaration of body.split(";")) {
        const match = declaration.trim().match(/^([\w-]+)\s*:\s*([\s\S]+)$/);
        if (!match) continue;
        const [, property, value] = match;
        const bare = value.replace(/var\([^)]*\)/g, "");
        if (colors.test(bare) || /\b(?:rgb|rgba|hsl|hsla)\s*\(/i.test(bare) ||
            (/(?:\d*\.)?\d+(?:px|em|rem|vh|vw|fr|%)(?![\w-])/i.test(bare) && !structural[property]?.includes(value))) {
          violations.push(`${property}: ${value}`);
        }
      }
    }
    expect(violations).toEqual([]);
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

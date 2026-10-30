import { describe, expect, it } from "vitest";
import { initials, plural, slugify, WORKSPACE_ID } from "./format";
import { parse } from "./router";

describe("formats", () => {
  it("initiales", () => {
    expect([initials("Groupe Nordis"), initials("Acme"), initials("julien.h"), initials("")]).toEqual([
      "GN",
      "AC",
      "JH",
      "?",
    ]);
  });

  it("pluriel", () => {
    expect([plural(0, "entité"), plural(1, "entité"), plural(3, "entité")]).toEqual(["0 entité", "1 entité", "3 entités"]);
  });

  it("identifiant dérivé du nom, conforme au motif de l'API", () => {
    expect(slugify("Altavia Énergie")).toBe("altavia-energie");
    expect(slugify("  L'Œuvre & Cie  ")).toBe("l-uvre-cie");
    expect(slugify("x".repeat(70) + " fin")).toHaveLength(64);
    for (const name of ["Groupe Nordis", "Maison Perrault 2026"]) expect(WORKSPACE_ID.test(slugify(name))).toBe(true);
  });
});

describe("routes", () => {
  it.each([
    ["", { name: "home" }],
    ["#/", { name: "home" }],
    ["#/w/groupe-nordis", { name: "workspace", ws: "groupe-nordis", view: "catalogue" }],
    ["#/w/groupe-nordis/propositions", { name: "workspace", ws: "groupe-nordis", view: "propositions" }],
    ["#/w/groupe-nordis/inconnue", { name: "workspace", ws: "groupe-nordis", view: "catalogue" }],
  ])("%s", (hash, route) => {
    expect(parse(hash)).toEqual(route);
  });
});

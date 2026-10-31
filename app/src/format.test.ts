import { describe, expect, it } from "vitest";
import { ago, convergence, initials, longDate, percent, plural, slugify, tolerance, WORKSPACE_ID } from "./format";
import { href, parse } from "./router";

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

describe("catalogue", () => {
  it("convergence", () => {
    expect(
      ["converged", "candidates:1", "candidates:2", "divergences:1", "divergences:3", "never_compared"].map(
        (value) => convergence(value),
      ),
    ).toEqual([
      { tone: "ok", label: "Convergé" },
      { tone: "warn", label: "1 candidate" },
      { tone: "warn", label: "2 candidates" },
      { tone: "bad", label: "1 divergence" },
      { tone: "bad", label: "3 divergences" },
      { tone: "none", label: "Jamais comparé" },
    ]);
    expect(convergence(null)).toBeNull();
  });

  it("pourcentage et ancienneté", () => {
    expect([percent(93.75), percent(93.2), percent(99.6), percent(100)]).toEqual(["94 %", "93 %", "99 %", "100 %"]);
    const now = new Date("2026-10-30T12:00:00Z");
    expect(
      ["2026-10-30T11:59:40", "2026-10-30T11:15:00", "2026-10-30T07:00:00Z", "2026-10-27T10:00:00+00:00"].map((t) =>
        ago(t, now),
      ),
    ).toEqual(["à l'instant", "il y a 45 min", "il y a 5 h", "il y a 3 j"]);
  });
});

describe("fiche", () => {
  it("date de version, telle qu'écrite dans le commit", () => {
    expect(longDate("2026-10-12T09:00:00+02:00")).toBe("12 oct. 2026");
    expect(longDate("2026-01-01T00:30:00+14:00")).toBe("1 janv. 2026");
  });

  it("tolérance", () => {
    expect(tolerance(1.5)).toBe("1,5 %");
    expect(tolerance(1)).toBe("1 %");
  });
});

describe("routes", () => {
  const ws = { name: "workspace", ws: "groupe-nordis", params: {} };
  it.each([
    ["", { name: "home" }],
    ["#/", { name: "home" }],
    ["#/w/groupe-nordis", { ...ws, view: "catalogue" }],
    ["#/w/groupe-nordis/propositions", { ...ws, view: "propositions" }],
    ["#/w/groupe-nordis/inconnue", { ...ws, view: "catalogue" }],
    ["#/w/groupe-nordis/catalogue?q=ca%20net&kind=kpi", { ...ws, view: "catalogue", params: { q: "ca net", kind: "kpi" } }],
    ["#/w/groupe-nordis/fiche/revenu-net", { ...ws, view: "fiche", doc: "revenu-net" }],
    ["#/w/groupe-nordis/fiche", { ...ws, view: "catalogue" }],
    ["#/w/groupe-nordis/editeur", { ...ws, view: "editeur" }],
    ["#/w/groupe-nordis/fiche/revenu-net?tab=versions&base=3&other=4", {
      ...ws, view: "fiche", doc: "revenu-net", params: { tab: "versions", base: "3", other: "4" },
    }],
    ["#/w/groupe-nordis/editeur?from=revenu-net", { ...ws, view: "editeur", params: { from: "revenu-net" } }],
  ])("%s", (hash, route) => {
    expect(parse(hash)).toEqual(route);
  });

  it("paramètres vides absents de l'adresse", () => {
    expect(href.view("groupe-nordis", "catalogue", { q: "", domain: "finance" })).toBe(
      "#/w/groupe-nordis/catalogue?domain=finance",
    );
    expect(href.view("groupe-nordis")).toBe("#/w/groupe-nordis/catalogue");
    expect(href.document("groupe-nordis", "revenu-net", { tab: "" })).toBe("#/w/groupe-nordis/fiche/revenu-net");
    expect(href.editor("groupe-nordis", { from: "revenu-net" })).toBe("#/w/groupe-nordis/editeur?from=revenu-net");
  });
});

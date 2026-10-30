import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiffReport, DocumentSheet, GraphLayout, GraphNode, Version, Workspace } from "../api";
import { positions } from "../components/GraphView";
import { useRoute } from "../router";
import { fakeServer, workspace } from "../test/fakeServer";
import { mockReactFlow } from "../test/reactFlow";
import { Editor } from "./Editor";
import { Fiche } from "./Fiche";

const DOC = "/api/workspaces/groupe-nordis/documents/revenu-net";

const SHEET: DocumentSheet = {
  id: "revenu-net",
  kind: "kpi",
  label: "Revenu net",
  domain: "finance",
  domain_label: "Finance",
  owner: "claire.m",
  owner_name: "Claire M.",
  version: 4,
  status: "validated",
  description: "Chiffre d'affaires facturé, taxes déduites.",
  synonyms: ["CA net", "net revenue"],
  variation_points: [{ node_id: "n03", label: "déduction des taxes" }],
  referenced_by: [],
  last_comparison: null,
  validated_at: "2026-10-12T09:00:00+02:00",
  validators_required: 2,
  version_count: 4,
  has_graph: true,
  semantics: [
    { key: "calendar", value: "fiscal-nordis 2026.1", variation: false },
    { key: "timezone", value: "Europe/Paris", variation: true },
  ],
  entity: null,
  variants: [
    { id: "revenu-net--nordis-de", entity: "nordis-de", mode: "override", version: 3, override_count: 3, undeclared_count: 2, justification: "TVA à 19 %." },
    { id: "revenu-net--nordis-es", entity: "nordis-es", mode: "from_scratch", version: 1, override_count: 0, undeclared_count: 0, justification: null },
    { id: "revenu-net--nordis-fr", entity: "nordis-fr", mode: "override", version: 2, override_count: 2, undeclared_count: 0, justification: null },
  ],
  dependencies: {
    references: [],
    referenced_by: [
      { id: "marge-brute", kind: "kpi_ref", version: 4, document_kind: "kpi", label: "Marge brute", status: "validated", domain: "finance", domain_label: "Finance" },
    ],
    impact: 2,
  },
  implementations: [],
  scopes: [],
  tolerance: { percent: 1.5 },
  workspace_tolerance: { percent: 1 },
};

function node(id: string, layer: number, rank: number, overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    type: "filter",
    type_label: "Filtre",
    family: "rows",
    title: `titre ${id}`,
    detail: `détail ${id}`,
    variation: false,
    output: false,
    layer,
    rank,
    ...overrides,
  };
}

const LAYOUT: GraphLayout = {
  output: "n03",
  nodes: [
    node("n01", 0, 0, { type: "source", type_label: "Source", family: "source", title: "Factures" }),
    node("n02", 1, 0, { variation: true, type_label: "Calcul" }),
    node("n03", 2, 0, { type: "aggregate", type_label: "Agrégation", family: "result", output: true }),
  ],
  edges: [
    { id: "n01-n02", source: "n01", target: "n02", side: null },
    { id: "n02-n03", source: "n02", target: "n03", side: null },
  ],
  overrides: [],
};

const VERSIONS: Version[] = [3, 4].map((version) => ({
  version,
  commit: `c${version}`,
  date: `2026-0${version}-02T09:00:00+02:00`,
  author: "Claire M.",
  message: `Revenu net v${version}`,
}));

const REPORT: DiffReport = {
  identical: false,
  relation: "version",
  base: { id: "revenu-net", version: 3, fingerprint: "a" },
  other: { id: "revenu-net", version: 4, fingerprint: "b" },
  differences: [
    {
      kind: "modified",
      node_ref: { base: "n02", other: "n02" },
      node_type: "filter",
      changes: [{ field: "column", before: "date_facture", after: "date_comptable" }],
      classification: "to_verify",
      severity: "warn",
      message: "Filtre : column modifié(s). À vérifier.",
    },
    {
      kind: "added",
      node_ref: { base: null, other: "n04" },
      node_type: "source",
      changes: [],
      classification: "critical",
      severity: "critical",
      message: "Source : nœud ajouté. Le résultat change.",
    },
  ],
  summary: { by_classification: {}, by_severity: { info: 0, warn: 1, critical: 1 } },
};

function sheetServer(sheet: DocumentSheet = SHEET) {
  return fakeServer(({ path }) => {
    if (path === `${DOC}/sheet`) return { json: sheet };
    if (path === "/api/workspaces/groupe-nordis/documents/commande/sheet") return { json: sheet };
    if (path === `${DOC}/layout`) return { json: LAYOUT };
    if (path === `${DOC}/layout?version=3`) return { json: LAYOUT };
    if (path === `${DOC}/layout?version=4`) {
      return { json: { ...LAYOUT, nodes: [...LAYOUT.nodes, node("n04", 0, 1, { type: "source", family: "source" })] } };
    }
    if (path === `${DOC}/versions`) return { json: VERSIONS };
    if (path === `${DOC}/diff?base=3&other=4`) return { json: REPORT };
    if (path === `${DOC}/draft`) {
      return { json: { id: "revenu-net", kind: "kpi", label: "Revenu net", base_version: 4, version: 5, content: "data_product:\n  version: 5\n" } };
    }
    return undefined;
  });
}

function Harness({ ws, editor = false }: { ws: Workspace; editor?: boolean }) {
  const route = useRoute();
  const heading = useRef<HTMLHeadingElement>(null);
  if (route.name !== "workspace") return null;
  if (editor) return <Editor ws={ws} params={route.params} heading={heading} />;
  return <Fiche ws={ws} id={route.doc ?? ""} params={route.params} heading={heading} />;
}

const fiche = (ws: Workspace = workspace()) => render(<Harness ws={ws} />);
const tabs = () => screen.getByRole("navigation", { name: "Onglets de la fiche" });

beforeEach(() => {
  mockReactFlow();
  window.location.hash = "#/w/groupe-nordis/fiche/revenu-net";
});
afterEach(() => vi.unstubAllGlobals());

describe("fiche", () => {
  it("en-tête : badges, date de validation, propriétaire, validateurs, synonymes", async () => {
    sheetServer();
    fiche();
    expect(await screen.findByRole("heading", { level: 1, name: "Revenu net" })).toBeInTheDocument();
    expect(screen.getByText("KPI")).toBeInTheDocument();
    expect(screen.getByText("Finance")).toBeInTheDocument();
    expect(screen.getByText("v4 · validée le 12 oct. 2026")).toBeInTheDocument();
    expect(
      screen.getByText("Propriétaire : Claire M. · Validateurs : 2 requis (canonique) · Synonymes : CA net, net revenue"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Lancer une comparaison" })).toHaveAttribute(
      "href",
      "#/w/groupe-nordis/comparaison?kpi=revenu-net",
    );
    expect(screen.getByRole("link", { name: "Proposer une modification" })).toHaveAttribute(
      "href",
      "#/w/groupe-nordis/editeur?from=revenu-net",
    );
    expect(screen.getByRole("link", { name: "Catalogue" })).toHaveAttribute("href", "#/w/groupe-nordis/catalogue?sel=revenu-net");
  });

  it("onglets et compteurs (critère 2) ; un lecteur ne propose pas de modification", async () => {
    sheetServer();
    fiche(workspace({ role: "lecteur" }));
    await screen.findByRole("heading", { level: 1, name: "Revenu net" });
    expect(within(tabs()).getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Définition",
      "Déclinaisons3",
      "Versions4",
      "Dépendances",
      "Implémentations",
      "Scope et comparaisons",
    ]);
    expect(within(tabs()).getByRole("link", { name: "Définition" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("link", { name: "Proposer une modification" })).not.toBeInTheDocument();
  });

  it("graphe en lecture : cartes, point de variation, résultat (critère 1)", async () => {
    sheetServer();
    fiche();
    const graph = await screen.findByRole("figure", { name: "Graphe de Revenu net" });
    await waitFor(() => expect(graph.querySelectorAll(".graph-card")).toHaveLength(3));
    const cards = [...graph.querySelectorAll(".graph-card")].map((card) => ({
      classes: card.className,
      text: card.textContent,
    }));
    expect(cards).toMatchInlineSnapshot(`
      [
        {
          "classes": "graph-card",
          "text": "Sourcen01Facturesdétail n01",
        },
        {
          "classes": "graph-card is-variation",
          "text": "Calcul · variationn02titre n02détail n02",
        },
        {
          "classes": "graph-card is-output",
          "text": "Agrégationn03titre n03détail n03",
        },
      ]
    `);
    expect(screen.getByText("Europe/Paris (variation)")).toBeInTheDocument();
    expect(screen.getByText("À la restitution")).toBeInTheDocument();
    expect(screen.getByText("From scratch · candidate")).toBeInTheDocument();
    expect(screen.getByText("Surcharge · 3")).toBeInTheDocument();
    expect(screen.getByText("Une nouvelle version touchera 2 documents.")).toBeInTheDocument();
  });

  it("positions : colonnes par couche, rangs centrés, identiques d'un calcul à l'autre (critère 6)", () => {
    const layout = { ...LAYOUT, nodes: [...LAYOUT.nodes, node("n04", 0, 1)] };
    const first = positions(layout);
    expect(positions(layout)).toEqual(first);
    const at = Object.fromEntries(first.placed.map((p) => [p.id, [p.x, p.y]]));
    expect(at.n01[0]).toBe(at.n04[0]);
    expect(at.n01[1]).toBeLessThan(at.n04[1]);
    expect(at.n02[1]).toBe((at.n01[1] + at.n04[1]) / 2); // seul dans sa couche : centré
    expect(at.n02[0]).toBeGreaterThan(at.n01[0]);
  });

  it("déclinaisons : surcharges hors points déclarés, candidate", async () => {
    window.location.hash = "#/w/groupe-nordis/fiche/revenu-net?tab=declinaisons";
    sheetServer();
    fiche();
    const row = (await screen.findByRole("rowheader", { name: "nordis-de" })).closest("tr")!;
    expect(row).toHaveTextContent("3, dont 2 hors points déclarés");
    expect(row).toHaveTextContent("TVA à 19 %.");
    expect(screen.getByRole("rowheader", { name: "nordis-es" }).closest("tr")).toHaveTextContent("Oui");
  });

  it("versions : deux versions choisies, puis la liste des écarts et les graphes surlignés (critère 3)", async () => {
    window.location.hash = "#/w/groupe-nordis/fiche/revenu-net?tab=versions";
    const server = sheetServer();
    fiche();
    expect(await screen.findByRole("rowheader", { name: /^v4/ })).toHaveTextContent("v4 · courante");
    expect(screen.getByRole("combobox", { name: "De" })).toHaveValue("3");
    expect(screen.getByRole("combobox", { name: "À" })).toHaveValue("4");
    await userEvent.click(screen.getByRole("button", { name: "Afficher les écarts" }));
    await waitFor(() => expect(window.location.hash).toBe("#/w/groupe-nordis/fiche/revenu-net?tab=versions&base=3&other=4"));

    const diff = await screen.findByRole("region", { name: "Écarts de v3 à v4" });
    expect(within(diff).getByText("2 écarts")).toBeInTheDocument();
    const items = within(diff).getAllByRole("listitem").filter((item) => item.classList.contains("diff-item"));
    expect(items.map((item) => item.className)).toEqual(["diff-item diff-warn", "diff-item diff-bad"]);
    expect(items[0]).toHaveTextContent("À examiner");
    expect(items[1]).toHaveTextContent("Divergence critique");
    expect(server.calls.some((c) => c.path === `${DOC}/diff?base=3&other=4`)).toBe(true);

    const after = screen.getByRole("figure", { name: "Graphe de la version 4" });
    await waitFor(() => expect(after.querySelector(".mark-added")).toHaveTextContent("ajouté"));
    const before = screen.getByRole("figure", { name: "Graphe de la version 3" });
    expect(before.querySelector(".mark-modified")).toHaveTextContent("n02");
  });

  it("concept : sans onglets propres aux KPI ni comparaison (critère 7)", async () => {
    window.location.hash = "#/w/groupe-nordis/fiche/commande?tab=scope";
    sheetServer({
      ...SHEET,
      id: "commande",
      kind: "concept",
      label: "Commande",
      has_graph: false,
      variants: [],
      version_count: 1,
      entity: { key: ["commande_id"], attributes: [{ name: "statut", type: "string" }] },
    });
    fiche();
    await screen.findByRole("heading", { level: 1, name: "Commande" });
    expect(within(tabs()).getAllByRole("link").map((link) => link.textContent)).toEqual(["Définition", "Versions1", "Dépendances"]);
    expect(within(tabs()).getByRole("link", { name: "Définition" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("link", { name: "Lancer une comparaison" })).not.toBeInTheDocument();
    expect(screen.queryByRole("figure")).not.toBeInTheDocument();
    expect(screen.getByText("commande_id")).toBeInTheDocument();
  });

  it("document introuvable", async () => {
    fakeServer(() => undefined);
    fiche();
    expect(await screen.findByRole("heading", { level: 1, name: "Fiche introuvable" })).toBeInTheDocument();
  });
});

describe("éditeur", () => {
  it("« Proposer une modification » : copie en brouillon, version incrémentée (critère 5)", async () => {
    window.location.hash = "#/w/groupe-nordis/editeur?from=revenu-net";
    sheetServer();
    render(<Harness ws={workspace()} editor />);
    expect(await screen.findByRole("heading", { level: 1, name: "Nouvelle version de Revenu net" })).toBeInTheDocument();
    expect(screen.getByText("Brouillon")).toBeInTheDocument();
    expect(screen.getByText("v5 · copie de la v4")).toBeInTheDocument();
    expect(screen.getByText(/version: 5/)).toBeInTheDocument();
  });
});

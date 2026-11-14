import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiffReport, DocumentSheet, GraphLayout, GraphNode, Version, Workspace } from "../api";
import { positions } from "../components/GraphView";
import { useRoute } from "../router";
import { expectAccessibleLandmarks } from "../test/accessibility";
import { fakeServer, workspace } from "../test/fakeServer";
import { mockReactFlow } from "../test/reactFlow";
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

function Harness({ ws }: { ws: Workspace }) {
  const route = useRoute();
  const heading = useRef<HTMLHeadingElement>(null);
  if (route.name !== "workspace") return null;
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
  it("évite les repères dupliqués et rend les tableaux accessibles", async () => {
    sheetServer();
    fiche();
    await userEvent.click(await screen.findByRole("button", { name: /Déclinaisons/ }));
    expect(screen.getByRole("group", { name: "Tableau : Déclinaisons" })).toBeInTheDocument();
    await expectAccessibleLandmarks();
    await userEvent.click(screen.getByRole("button", { name: /Versions/ }));
    await screen.findByRole("group", { name: "Tableau : Versions" });
    await expectAccessibleLandmarks();
  });

  it("propose de créer une déclinaison depuis le KPI aux contributeurs", async () => {
    sheetServer();
    fiche(workspace({ role: "contributeur" }));
    await userEvent.click(await screen.findByRole("button", { name: /Déclinaisons/ }));
    expect(screen.getByRole("link", { name: "Créer une déclinaison" })).toHaveAttribute(
      "href", "#/w/groupe-nordis/editeur?variant_of=revenu-net",
    );
  });

  it("ne propose pas la création d'une déclinaison aux lecteurs", async () => {
    sheetServer();
    fiche(workspace({ role: "lecteur" }));
    await userEvent.click(await screen.findByRole("button", { name: /Déclinaisons/ }));
    expect(screen.queryByRole("link", { name: "Créer une déclinaison" })).toBeNull();
  });

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
    expect(within(tabs()).getAllByRole("button").map((link) => link.textContent)).toEqual([
      "Définition",
      "Déclinaisons3",
      "Versions4",
      "Dépendances",
      "Implémentations",
      "Scope et comparaisons",
    ]);
    expect(within(tabs()).getByRole("button", { name: "Définition" })).toHaveAttribute("aria-current", "page");
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

  it("[S-0055-01] signale les références en retard dans les deux sens", async () => {
    sheetServer({ ...SHEET, dependencies: {
      references: [
        { id: "revenu-net", kind: "kpi_ref", version: 4, current_version: 5, outdated: true, document_kind: "kpi", label: "Revenu net", status: "validated", domain: "finance", domain_label: "Finance" },
        { id: "autre", kind: "kpi_ref", version: 2, current_version: 2, outdated: false, document_kind: "kpi", label: "Autre", status: "validated", domain: null, domain_label: null },
      ],
      referenced_by: [
        { ...SHEET.dependencies.referenced_by[0], current_version: 5, outdated: true },
        { ...SHEET.dependencies.referenced_by[0], id: "panier-moyen", label: "Panier moyen", version: 5, current_version: 5, outdated: false },
      ], impact: 2,
    } });
    fiche();
    const notice = (await screen.findByText(/version courante v5/)).closest("div")!;
    expect(notice).toHaveTextContent("Revenu net : épinglé v4, version courante v5");
    expect(within(notice).getByRole("link", { name: "Revenu net" })).toHaveAttribute("href", "#/w/groupe-nordis/fiche/revenu-net");
    const marge = screen.getByRole("link", { name: /^Marge brute$/ });
    expect(marge.parentElement).toHaveTextContent("Marge brute (épinglé v4) (Finance)");
    const panier = screen.getByRole("link", { name: /^Panier moyen$/ });
    expect(panier.parentElement).toHaveTextContent("Panier moyen (Finance)");
    expect(panier.parentElement).not.toHaveTextContent("épinglé");
    await userEvent.click(screen.getByRole("button", { name: "Dépendances" }));
    const references = screen.getByRole("region", { name: "Références" });
    expect(within(references).getByText("épinglé v4, version courante v5")).toBeInTheDocument();
    expect(within(references).getByRole("link", { name: "Revenu net" })).toHaveAttribute("href", "#/w/groupe-nordis/fiche/revenu-net");
    const incoming = screen.getByRole("region", { name: "Référencé par" });
    expect(within(incoming).getByText("épinglé v4").closest("li")).toHaveTextContent("Marge brute");
    expect(within(incoming).getByRole("link", { name: "Panier moyen" }).closest("li")).not.toHaveTextContent("épinglé");
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
    expect(within(tabs()).getAllByRole("button").map((link) => link.textContent)).toEqual(["Définition", "Versions1", "Dépendances"]);
    expect(within(tabs()).getByRole("button", { name: "Définition" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("link", { name: "Lancer une comparaison" })).not.toBeInTheDocument();
    expect(screen.queryByRole("figure")).not.toBeInTheDocument();
    expect(screen.getByText("commande_id")).toBeInTheDocument();
  });

  it("déclinaison : diff au canonique, nœud divergent entouré (plan 0015, critère 2)", async () => {
    const VARIANT = "/api/workspaces/groupe-nordis/documents/revenu-net--nordis-de";
    window.location.hash = "#/w/groupe-nordis/fiche/revenu-net--nordis-de?diff=canonique&node=n02";
    const variantReport: DiffReport = {
      ...REPORT,
      relation: "override",
      differences: [{ ...REPORT.differences[0], classification: "override_undeclared", severity: "critical" }],
    };
    const titled = { ...LAYOUT, nodes: LAYOUT.nodes.map((n) => (n.id === "n02" ? { ...n, title: "Factures validées ou expédiées" } : n)) };
    fakeServer(({ path }) => {
      if (path === `${VARIANT}/sheet`) {
        return { json: { ...SHEET, id: "revenu-net--nordis-de", kind: "variant", label: "Revenu net — nordis-de", has_graph: false, variants: [] } };
      }
      if (path === `${VARIANT}/canonical-diff`) {
        return {
          json: {
            base: { ...LAYOUT, label: "Canonique v4" },
            other: { ...titled, label: "Déclinaison nordis-de v3", overrides: ["n02"] },
            report: variantReport,
          },
        };
      }
      return undefined;
    });
    fiche();
    expect(await screen.findByRole("heading", { level: 2, name: "Écarts au canonique" })).toBeInTheDocument();
    expect(await screen.findByText(/Nœud sélectionné/)).toHaveTextContent("Nœud sélectionné : n02 · Factures validées ou expédiées");
    const diff = screen.getByRole("region", { name: "Diff de Revenu net — nordis-de au canonique" });
    const other = within(diff).getByRole("figure", { name: "Graphe : Déclinaison nordis-de v3" });
    await waitFor(() => expect(other.querySelectorAll(".graph-card")).toHaveLength(3));
    const selected = other.querySelector(".graph-card.is-selected")!;
    expect(selected).toHaveTextContent("Factures validées ou expédiées");
    expect(selected).toHaveClass("mark-modified");
    expect(within(diff).getByRole("figure", { name: "Graphe : Canonique v4" }).querySelector(".graph-card.is-selected")).not.toBeNull();
    expect(screen.queryByRole("link", { name: "Comparer au canonique" })).not.toBeInTheDocument();
  });

  it("déclinaison : lien « Comparer au canonique » quand le diff est fermé", async () => {
    window.location.hash = "#/w/groupe-nordis/fiche/revenu-net--nordis-de";
    fakeServer(({ path }) =>
      path.endsWith("/revenu-net--nordis-de/sheet")
        ? { json: { ...SHEET, id: "revenu-net--nordis-de", kind: "variant", label: "Revenu net — nordis-de", has_graph: false, variants: [] } }
        : undefined,
    );
    fiche();
    const link = await screen.findByRole("link", { name: "Comparer au canonique" });
    expect(link).toHaveAttribute("href", "#/w/groupe-nordis/fiche/revenu-net--nordis-de?diff=canonique");
  });

  it("document introuvable", async () => {
    fakeServer(() => undefined);
    fiche();
    expect(await screen.findByRole("heading", { level: 1, name: "Fiche introuvable" })).toBeInTheDocument();
  });
});

it("relit la fiche après une avance sans démonter son titre", async () => {
  const sheet = { ...SHEET };
  const other = sheetServer(sheet);
  const heading = { current: null };
  const rendered = render(<Fiche ws={workspace()} id="revenu-net" params={{}} heading={heading} revision={0} />);
  await screen.findByText(/v4 · validée/);
  const title = screen.getByRole("heading", { name: "Revenu net" });
  title.focus();
  sheet.version = 5;
  rendered.rerender(<Fiche ws={workspace()} id="revenu-net" params={{}} heading={heading} revision={1} />);
  await screen.findByText(/v5 · validée/);
  expect(title).toHaveFocus();
  expect(other.calls.filter((call) => call.path === `${DOC}/sheet`)).toHaveLength(2);
});

// --- onglets et états restants (implémentations, scope, versions, dépendances) -------------

const COMPARISONS = "/api/workspaces/groupe-nordis/comparisons?kpi=revenu-net&limit=3";
type Reply = ReturnType<Parameters<typeof fakeServer>[0]>;

/** Fiche avec des routes en plus : elles passent avant celles de `sheetServer`. */
function routes(sheet: DocumentSheet, extra: Record<string, Reply>) {
  return fakeServer(({ path }) => {
    if (path in extra) return extra[path];
    if (path === `${DOC}/sheet`) return { json: sheet };
    if (path === `${DOC}/layout`) return { json: LAYOUT };
    return undefined;
  });
}

function pending<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

const IMPLEMENTATIONS: DocumentSheet["implementations"] = [
  { entity: "nordis-de", platform: "databricks", path: "implementations/revenu-net/nordis-de.databricks.sql", sql: "SELECT SUM(montant) FROM f", extractable: true },
  { entity: "nordis-fr", platform: "oracle", path: "implementations/revenu-net/nordis-fr.oracle.sql", sql: "SELECT 1 FROM dual", extractable: false },
];
const EXTRACT = `${DOC}/implementations/nordis-de/databricks/extract`;

describe("fiche : implémentations", () => {
  it("sans fichier, l'onglet dit où les poser", async () => {
    window.location.hash = "#/w/groupe-nordis/fiche/revenu-net?tab=implementations";
    sheetServer();
    fiche();
    expect(await screen.findByRole("heading", { level: 2, name: "Implémentations" })).toBeInTheDocument();
    expect(screen.getByText(/Aucun fichier sous/)).toHaveTextContent("Aucun fichier sous implementations/revenu-net/.");
  });

  it("chaque fichier montre son SQL ; une plateforme sans extraction n'a pas de bouton", async () => {
    window.location.hash = "#/w/groupe-nordis/fiche/revenu-net?tab=implementations";
    routes({ ...SHEET, implementations: IMPLEMENTATIONS }, {});
    fiche();
    const de = await screen.findByRole("region", { name: "nordis-de · Databricks" });
    expect(within(de).getByText("SELECT SUM(montant) FROM f")).toBeInTheDocument();
    expect(within(de).getByText("implementations/revenu-net/nordis-de.databricks.sql")).toBeInTheDocument();
    expect(within(de).getByRole("button", { name: "Extraire et comparer au canonique" })).toBeEnabled();
    // Plateforme inconnue : son identifiant brut reste lisible.
    const fr = screen.getByRole("region", { name: "nordis-fr · oracle" });
    expect(within(fr).getByText("Plateforme sans extraction")).toBeInTheDocument();
    expect(within(fr).queryByRole("button")).toBeNull();
  });

  it("extrait puis compare : attente, résidus bloquants ou à revoir, fidélité, écarts", async () => {
    window.location.hash = "#/w/groupe-nordis/fiche/revenu-net?tab=implementations";
    const reply = pending<{ json: unknown }>();
    const server = routes({ ...SHEET, implementations: IMPLEMENTATIONS }, { [EXTRACT]: reply.promise });
    fiche();
    const card = await screen.findByRole("region", { name: "nordis-de · Databricks" });
    const button = within(card).getByRole("button", { name: "Extraire et comparer au canonique" });
    await userEvent.click(button);
    expect(within(card).getByRole("status")).toHaveTextContent("Extraction et comparaison en cours…");
    expect(button).toBeDisabled();
    expect(server.calls.find((c) => c.path === EXTRACT)?.method).toBe("POST");

    reply.resolve({
      json: {
        file: "nordis-de.databricks.sql",
        residues: [{ code: "comment", message: "Commentaire ignoré en tête de fichier." }],
        statements: [
          {
            id: "s1", line: 3, status: "ok", roundtrip: { status: "verified" }, draft: "",
            residues: [
              { code: "udf", message: "Fonction maison non traduite.", blocking: true },
              { code: "cast", message: "Conversion implicite à vérifier.", blocking: false },
            ],
            diff: REPORT,
          },
          { id: "s2", line: 12, status: "ok", roundtrip: { status: "differs" }, draft: "", residues: [], diff: null },
        ],
      },
    });
    expect(await within(card).findByText("Commentaire ignoré en tête de fichier.")).toHaveClass("fact-warn");
    expect(button).toBeEnabled();
    expect(within(card).getByText(/Requête ligne 3/)).toHaveTextContent("Requête ligne 3 : brouillon s1, fidélité au SQL vérifiée.");
    expect(within(card).getByText(/Requête ligne 12/)).toHaveTextContent("fidélité au SQL écarts au SQL source.");
    const blocking = within(card).getByText("Fonction maison non traduite.", { exact: false }).closest("li")!;
    expect(within(blocking).getByText("Bloquant")).toHaveClass("tone-bad");
    const review = within(card).getByText("Conversion implicite à vérifier.", { exact: false }).closest("li")!;
    expect(within(review).getByText("À revoir")).toHaveClass("tone-warn");
    const diff = within(card).getByRole("region", { name: "Écarts au canonique" });
    expect(within(diff).getByText("Écarts au canonique v3")).toBeInTheDocument();
    expect(within(diff).getByText("2 écarts")).toBeInTheDocument();
    expect(within(diff).getAllByRole("listitem").filter((li) => li.classList.contains("diff-item"))).toHaveLength(2);
    expect(within(card).getByText("Brouillon à corriger avant de le comparer.")).toBeInTheDocument();
  });

  it("un diff identique ne liste aucun écart ; un échec d'extraction s'affiche dans la carte", async () => {
    window.location.hash = "#/w/groupe-nordis/fiche/revenu-net?tab=implementations";
    let fail = true;
    fakeServer(({ path }) => {
      if (path === `${DOC}/sheet`) return { json: { ...SHEET, implementations: IMPLEMENTATIONS } };
      if (path === EXTRACT) {
        if (fail) return { status: 500, json: { detail: "Extraction impossible." } };
        return { json: { file: "f", residues: [], statements: [{ id: "s1", line: 1, status: "ok", roundtrip: { status: "skipped" }, draft: "", residues: [], diff: { ...REPORT, identical: true, differences: [] } }] } };
      }
      return undefined;
    });
    fiche();
    const card = await screen.findByRole("region", { name: "nordis-de · Databricks" });
    await userEvent.click(within(card).getByRole("button", { name: "Extraire et comparer au canonique" }));
    expect(await within(card).findByText("Extraction impossible.")).toBeInTheDocument();
    fail = false;
    await userEvent.click(within(card).getByRole("button", { name: "Extraire et comparer au canonique" }));
    expect(await within(card).findByText("Aucun écart : les deux graphes sont identiques.")).toBeInTheDocument();
    expect(within(card).queryByText("Extraction impossible.")).toBeNull();
    expect(within(card).getByText(/fidélité au SQL non vérifiée/)).toBeInTheDocument();
    expect(card.querySelector(".diff-list")).toBeNull();
  });
});

describe("fiche : scope et comparaisons", () => {
  beforeEach(() => {
    window.location.hash = "#/w/groupe-nordis/fiche/revenu-net?tab=scope";
  });

  it("tolérance propre, scopes déclarés et dernières comparaisons (lien seulement pour une comparaison terminée)", async () => {
    routes(
      {
        ...SHEET,
        scopes: [
          { id: "exercice", period: { calendar_period: "FY2026" }, granularity: ["mois", "entité"] },
          { id: "s1", period: { from: "2026-01-01", to: "2026-06-30" } },
          { id: "tout" },
        ],
      },
      {
        [COMPARISONS]: {
          json: [
            {
              id: 7, kpi_version: 4, status: "done", started_at: "2026-11-01T10:00:00Z", finished_at: "2026-11-01T10:05:00Z", tolerance_pct: 1.5, scope: null,
              results: [
                { variant_id: "revenu-net--nordis-de", entity: "nordis-de", validation_pct: 99.9, max_gap_pct: 0.2 },
                { variant_id: "revenu-net--nordis-fr", entity: "nordis-fr", validation_pct: null, max_gap_pct: null },
              ],
            },
            { id: 8, kpi_version: 3, status: "failed", started_at: "2026-11-02T10:00:00Z", finished_at: null, tolerance_pct: 1, scope: null, results: [] },
            { id: 9, kpi_version: 4, status: "étrange", started_at: "2026-11-02T10:00:00Z", finished_at: null, tolerance_pct: 1, scope: null, results: [] },
          ],
        },
      },
    );
    fiche();
    expect(await screen.findByText("1,5 % (propre au KPI)")).toBeInTheDocument();
    const scopes = screen.getByRole("group", { name: "Scopes déclarés" });
    expect(within(scopes).getByRole("rowheader", { name: "exercice" }).closest("tr")).toHaveTextContent("exerciceFY2026mois, entité");
    expect(within(scopes).getByRole("rowheader", { name: "s1" }).closest("tr")).toHaveTextContent("s12026-01-01 → 2026-06-30—");
    expect(within(scopes).getByRole("rowheader", { name: "tout" }).closest("tr")).toHaveTextContent("tout——");

    const runs = await screen.findByRole("group", { name: "Comparaisons" });
    const done = within(runs).getByRole("link", { name: "7" });
    expect(done).toHaveAttribute("href", "#/w/groupe-nordis/comparaison?kpi=revenu-net&id=7&variant=nordis-de");
    const row7 = done.closest("tr")!;
    expect(row7).toHaveTextContent("v4");
    expect(row7).toHaveTextContent("Terminée");
    expect(row7).toHaveTextContent("nordis-de 99 % · nordis-fr —");
    const row8 = within(runs).getByRole("rowheader", { name: "8" }).closest("tr")!;
    expect(within(row8).queryByRole("link")).toBeNull();
    expect(row8).toHaveTextContent("Échouée");
    expect(row8.lastElementChild).toHaveTextContent(/^—$/);
    expect(within(runs).getByRole("rowheader", { name: "9" }).closest("tr")).toHaveTextContent("étrange");
  });

  it("sans tolérance propre, celle de l'espace ; sans scope ni comparaison, des messages explicites", async () => {
    routes({ ...SHEET, tolerance: null }, { [COMPARISONS]: { json: [] } });
    fiche();
    expect(await screen.findByText("1 % (défaut de l'espace)")).toBeInTheDocument();
    expect(screen.getByText(/Aucun scope déclaré/)).toBeInTheDocument();
    expect(await screen.findByText("Aucune comparaison chiffrée pour ce KPI.")).toBeInTheDocument();
  });

  it("sans aucune tolérance : un tiret ; comparaisons en chargement puis en échec", async () => {
    const reply = pending<{ status: number; json: unknown }>();
    routes({ ...SHEET, tolerance: {}, workspace_tolerance: null }, { [COMPARISONS]: reply.promise });
    fiche();
    const tolerance = (await screen.findByText("Tolérance")).closest(".card")!;
    expect(tolerance.querySelector("p")).toHaveTextContent(/^—$/);
    expect(screen.getByText("Chargement des comparaisons…")).toHaveAttribute("role", "status");
    reply.resolve({ status: 500, json: { detail: "Historique illisible." } });
    expect(await screen.findByText("Historique illisible.")).toBeInTheDocument();
    expect(screen.queryByText("Chargement des comparaisons…")).toBeNull();
  });
});

describe("fiche : états vides et échecs", () => {
  it("statut non validé, propriétaire inconnu, sans validateurs ni synonymes ni domaine", async () => {
    sheetServer({ ...SHEET, status: "draft", owner: null, owner_name: null, validators_required: null, synonyms: [], domain: null, domain_label: null });
    fiche();
    expect(await screen.findByText("v4 · Brouillon")).toBeInTheDocument();
    expect(screen.getByText("Propriétaire : —")).toBeInTheDocument();
    expect(screen.queryByText("Finance")).toBeNull();
  });

  it("validé sans date de validation : le libellé du statut seul", async () => {
    sheetServer({ ...SHEET, validated_at: null });
    fiche();
    expect(await screen.findByText("v4 · Validé")).toBeInTheDocument();
  });

  it("un KPI sans déclinaison le dit dans la définition et dans l'onglet", async () => {
    sheetServer({ ...SHEET, variants: [] });
    fiche();
    expect(await screen.findByText("Aucune déclinaison.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Déclinaisons/ }));
    expect(await screen.findByText(/Ce KPI n'a pas de déclinaison/)).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Tableau : Déclinaisons" })).toBeNull();
  });

  it("le graphe en échec affiche un bandeau, le reste de la fiche reste lisible", async () => {
    routes(SHEET, { [`${DOC}/layout`]: { status: 500, json: { detail: "Graphe illisible." } } });
    fiche();
    expect(await screen.findByText("Graphe illisible.")).toBeInTheDocument();
    expect(screen.queryByRole("figure")).toBeNull();
    expect(screen.getByText("Une nouvelle version touchera 2 documents.")).toBeInTheDocument();
  });

  it("sans version taguée, ni tableau ni formulaire de comparaison", async () => {
    window.location.hash = "#/w/groupe-nordis/fiche/revenu-net?tab=versions";
    routes(SHEET, { [`${DOC}/versions`]: { json: [] } });
    fiche();
    expect(await screen.findByText(/Aucune version taguée/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Afficher les écarts" })).toBeNull();
  });

  it("les listes De / À choisissent les versions comparées", async () => {
    window.location.hash = "#/w/groupe-nordis/fiche/revenu-net?tab=versions";
    sheetServer();
    fiche();
    const base = await screen.findByRole("combobox", { name: "De" });
    await userEvent.selectOptions(base, "4");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "À" }), "3");
    await userEvent.click(screen.getByRole("button", { name: "Afficher les écarts" }));
    await waitFor(() => expect(window.location.hash).toBe("#/w/groupe-nordis/fiche/revenu-net?tab=versions&base=4&other=3"));
  });

  it("un diff de versions en échec s'affiche à la place des écarts", async () => {
    window.location.hash = "#/w/groupe-nordis/fiche/revenu-net?tab=versions&base=3&other=4";
    routes(SHEET, {
      [`${DOC}/versions`]: { json: VERSIONS },
      [`${DOC}/diff?base=3&other=4`]: { status: 500, json: { detail: "Diff impossible." } },
      [`${DOC}/layout?version=3`]: { json: LAYOUT },
      [`${DOC}/layout?version=4`]: { json: LAYOUT },
    });
    fiche();
    expect(await screen.findByText("Diff impossible.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /Écarts de v3 à v4/ })).toBeNull();
  });

  it("les versions en échec affichent un bandeau", async () => {
    window.location.hash = "#/w/groupe-nordis/fiche/revenu-net?tab=versions";
    routes(SHEET, { [`${DOC}/versions`]: { status: 500, json: { detail: "Historique Git illisible." } } });
    fiche();
    expect(await screen.findByText("Historique Git illisible.")).toBeInTheDocument();
  });

  it("dépendances : listes vides, et référence introuvable sans lien", async () => {
    window.location.hash = "#/w/groupe-nordis/fiche/revenu-net?tab=dependances";
    sheetServer({
      ...SHEET,
      dependencies: {
        references: [{ id: "fantome", kind: "kpi_ref", version: 2, found: false, document_kind: "kpi", label: null, status: null, domain: null, domain_label: null }],
        referenced_by: [],
        impact: 0,
      },
    });
    fiche();
    const references = await screen.findByRole("region", { name: "Références" });
    expect(within(references).getByText("fantome (introuvable)")).toBeInTheDocument();
    expect(within(references).queryByRole("link")).toBeNull();
    expect(within(references).getByText("KPI · v2")).toBeInTheDocument();
    const incoming = screen.getByRole("region", { name: "Référencé par" });
    expect(within(incoming).getByText("Référencé par (0)")).toBeInTheDocument();
    expect(within(incoming).getByText("Aucun document ne le référence.")).toBeInTheDocument();
    expect(screen.getByText("Aucun document n'en dépend.")).toBeInTheDocument();
  });

  it("le diff au canonique en échec s'affiche à la place des graphes", async () => {
    const VARIANT = "/api/workspaces/groupe-nordis/documents/revenu-net--nordis-de";
    window.location.hash = "#/w/groupe-nordis/fiche/revenu-net--nordis-de?diff=canonique";
    fakeServer(({ path }) => {
      if (path === `${VARIANT}/sheet`) return { json: { ...SHEET, id: "revenu-net--nordis-de", kind: "variant", label: "Revenu net — nordis-de", has_graph: false, variants: [] } };
      if (path === `${VARIANT}/canonical-diff`) return { status: 500, json: { detail: "Canonique introuvable." } };
      return undefined;
    });
    fiche();
    expect(await screen.findByText("Canonique introuvable.")).toBeInTheDocument();
    expect(screen.queryByRole("figure")).toBeNull();
  });
});

import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CheckResult, EditorDocument, Issue } from "../api";
import { useRoute } from "../router";
import { Editor } from "../screens/Editor";
import { fakeServer, settle, workspace } from "../test/fakeServer";
import { mockReactFlow } from "../test/reactFlow";
import { YamlView } from "./YamlView";

// Vue YAML plein écran (guide 10.3, « Éditer en YAML ») avec le vrai CodeMirror : le texte
// initial s'affiche, chaque modification remonte en entier, la vue garde la main ensuite.
// Puis le parcours dans l'éditeur : erreur de YAML signalée, retour au graphe refusé tant
// qu'elle reste, accepté une fois corrigée.

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false }));

// CodeMirror mesure ses lignes : jsdom n'a pas de géométrie pour les Range.
beforeAll(() => {
  const empty = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect;
  Object.assign(Range.prototype, {
    getClientRects: () => Object.assign([], { item: () => null }) as unknown as DOMRectList,
    getBoundingClientRect: empty,
  });
});

/** Le contenu éditable porte le libellé ; la vue CodeMirror se retrouve depuis lui. */
const content = (label: string) => screen.getByRole("textbox", { name: label });
const viewOf = (label: string) => EditorView.findFromDOM(content(label))!;

/** Remplace tout le texte, comme une saisie qui réécrit le document. */
function retype(label: string, text: string) {
  const view = viewOf(label);
  act(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, userEvent: "input.type" }));
}

describe("YamlView", () => {
  it("affiche le texte initial dans un éditeur libellé, qui prend le focus", () => {
    render(<YamlView initial={"label: Revenu net\nkind: kpi\n"} onChange={vi.fn()} label="YAML de Revenu net" />);
    const editor = content("YAML de Revenu net");
    expect(editor).toHaveAttribute("contenteditable", "true");
    expect(editor).toHaveTextContent("label: Revenu net");
    expect(editor).toHaveTextContent("kind: kpi");
    expect(viewOf("YAML de Revenu net").state.doc.toString()).toBe("label: Revenu net\nkind: kpi\n");
    expect(viewOf("YAML de Revenu net").hasFocus).toBe(true);
  });

  it("chaque modification remonte le texte entier", () => {
    const onChange = vi.fn();
    render(<YamlView initial="label: A" onChange={onChange} label="YAML" />);
    const view = viewOf("YAML");
    act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: "\nowner: claire.m" } }));
    expect(onChange).toHaveBeenLastCalledWith("label: A\nowner: claire.m");
    expect(content("YAML")).toHaveTextContent("owner: claire.m");
  });

  it("un déplacement du curseur seul ne signale aucune modification", () => {
    const onChange = vi.fn();
    render(<YamlView initial="label: A" onChange={onChange} label="YAML" />);
    act(() => viewOf("YAML").dispatch({ selection: EditorSelection.cursor(3) }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("appelle le dernier rappel fourni, sans recréer l'éditeur", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<YamlView initial="a: 1" onChange={first} label="YAML" />);
    const view = viewOf("YAML");
    rerender(<YamlView initial="a: 1" onChange={second} label="YAML" />);
    expect(viewOf("YAML")).toBe(view);
    retype("YAML", "a: 2");
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith("a: 2");
  });

  it("le texte initial n'est lu qu'à l'ouverture : la saisie en cours n'est pas écrasée", () => {
    const { rerender } = render(<YamlView initial="a: 1" onChange={vi.fn()} label="YAML" />);
    retype("YAML", "a: saisi");
    rerender(<YamlView initial="a: venu du serveur" onChange={vi.fn()} label="YAML" />);
    expect(viewOf("YAML").state.doc.toString()).toBe("a: saisi");
  });

  it("fermer la vue détruit l'éditeur : plus aucune modification ne remonte", () => {
    const onChange = vi.fn();
    const { unmount, container } = render(<YamlView initial="a: 1" onChange={onChange} label="YAML" />);
    const view = viewOf("YAML");
    unmount();
    expect(container.querySelector(".cm-editor")).toBeNull();
    view.dispatch({ changes: { from: 0, insert: "x" } });
    expect(onChange).not.toHaveBeenCalled();
  });
});

// --- parcours dans l'éditeur ------------------------------------------------------------

const EDITOR = "/api/workspaces/groupe-nordis/editor";
const DOCUMENT = {
  schema_version: 1,
  kind: "kpi",
  data_product: { id: "revenu-net", version: 5, owner: "claire.m", domain: "finance" },
  label: "Revenu net",
  graph: {
    nodes: [
      { id: "n01", type: "source", platform: "databricks", table: "gold.finance.f", owner: "claire.m", columns: [{ name: "statut", type: "string" }] },
      { id: "n02", type: "filter", inputs: ["n01"], condition: "statut:equals:validée", nulls: "keep" },
    ],
    output: "n02",
  },
};
const YAML = "label: Revenu net\ngraph:\n  nodes: 2\n";
const BROKEN = "label: [Revenu net\n";
const FIXED = "label: Revenu net corrigé\n";
const SYNTAX: Issue = { path: "/", node_id: null, code: "yaml_syntax", message: "YAML illisible ligne 1 : crochet non fermé.", severity: "error" };

function opened(): EditorDocument {
  return {
    id: "revenu-net", mode: "canonical", kind: "kpi", base_version: 4, document: structuredClone(DOCUMENT), canonical: null,
    highest: 2, positions: { n01: { x: 24, y: 24 }, n02: { x: 288, y: 24 } }, draft: null, calendars: [], domains: [],
    vocabulary: { operators: [], aggregates: [], platforms: ["databricks"], column_types: ["string"] },
  };
}

function checked(document: { graph?: { nodes: unknown[] } }): CheckResult {
  return {
    yaml: YAML, fragments: {}, issues: [], columns: {}, submittable: true,
    status: { schema: true, acyclic: true, cycle: null, compilable: { databricks: { status: "ok", sql: `-- ${document.graph?.nodes.length ?? 0} nœuds`, node_sql: null } } },
  };
}

function server() {
  return fakeServer(({ path, method, body }) => {
    if (path === `${EDITOR}/documents/revenu-net` && method === "GET") return { json: opened() };
    if (path === `${EDITOR}/check`) return { json: checked((body as { document: { graph?: { nodes: unknown[] } } }).document) };
    if (path === `${EDITOR}/parse`) {
      const { text } = body as { text: string };
      if (text === BROKEN) return { json: { document: null, issues: [SYNTAX] } };
      if (text === FIXED) return { json: { document: { ...structuredClone(DOCUMENT), label: "Revenu net corrigé" }, issues: [] } };
      return { json: { document: structuredClone(DOCUMENT), issues: [] } };
    }
    if (path === `${EDITOR}/documents/revenu-net/draft`) return { json: { saved_at: "2026-11-14T10:00:00+00:00" } };
    if (path.startsWith("/api/workspaces/groupe-nordis/catalog")) return { json: [] };
    return undefined;
  });
}

function Harness() {
  const route = useRoute();
  const heading = useRef<HTMLHeadingElement>(null);
  if (route.name !== "workspace") return null;
  return <Editor ws={workspace({ account: "anna.k", role: "contributeur" })} params={route.params} heading={heading} />;
}

describe("vue YAML dans l'éditeur", () => {
  beforeEach(() => {
    mockReactFlow();
    window.location.hash = "#/w/groupe-nordis/editeur?from=revenu-net";
  });
  afterEach(async () => {
    await settle();
    vi.unstubAllGlobals();
  });

  it("affiche le YAML du serveur, signale une erreur de syntaxe, refuse le retour puis l'accepte une fois corrigé", async () => {
    const { calls } = server();
    render(<Harness />);
    await screen.findByText("Schéma valide");
    await userEvent.click(screen.getByRole("button", { name: "Éditer en YAML" }));

    // Affichage : le texte vient de la validation du serveur, pas d'une sérialisation locale.
    await waitFor(() => expect(content("YAML de Revenu net")).toHaveTextContent("label: Revenu net"));
    expect(viewOf("YAML de Revenu net").state.doc.toString()).toBe(YAML);
    expect(screen.queryByRole("group", { name: /^Graphe de/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Soumettre la proposition" })).toHaveAttribute("aria-disabled", "true");

    // Erreur : la syntaxe cassée part à l'analyse et le problème s'affiche en bas.
    retype("YAML de Revenu net", BROKEN);
    const bottom = screen.getByRole("region", { name: "Validation du document" });
    expect(await within(bottom).findByText(SYNTAX.message, {}, { timeout: 2000 })).toBeInTheDocument();
    expect(within(bottom).getByText("ERREUR")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revenir au canevas" })).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(screen.getByRole("button", { name: "Revenir au canevas" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("YAML illisible : corriger l'erreur signalée pour revenir au canevas.");
    expect(content("YAML de Revenu net")).toBeInTheDocument();

    // Correction : le retour au graphe applique le document analysé.
    retype("YAML de Revenu net", FIXED);
    await waitFor(() => expect(within(bottom).queryByText(SYNTAX.message)).not.toBeInTheDocument(), { timeout: 2000 });
    await userEvent.click(screen.getByRole("button", { name: "Revenir au canevas" }));
    expect(await screen.findByRole("group", { name: "Graphe de Revenu net corrigé" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /^YAML de/ })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Revenu net corrigé");
    expect(calls.filter((c) => c.path === `${EDITOR}/parse`).map((c) => (c.body as { text: string }).text)).toContain(FIXED);

    // Le document corrigé part au brouillon local, et l'écriture se termine.
    await waitFor(() => {
      const saved = calls.filter((c) => c.method === "PUT").map((c) => (c.body as { document: { label?: string } }).document.label);
      expect(saved).toContain("Revenu net corrigé");
      expect(screen.getByText(/^Enregistré .* \(local\)$/)).toBeInTheDocument();
    }, { timeout: 2000 });
  });
});

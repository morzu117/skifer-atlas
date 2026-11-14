import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { ReactFlowProvider, useStoreApi } from "@xyflow/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mockReactFlow } from "../test/reactFlow";
import { Canvas, LARGE_GRAPH, type CanvasProps } from "./Canvas";
import type { NodeRaw, Positions } from "./model";
import { summary } from "./summary";

// Plan 0024 : sur un grand graphe, un déplacement ne redessine que la carte déplacée, et
// seules les cartes de la zone visible sont dessinées. `summary` est appelée une fois par
// rendu de carte : elle sert de compteur.

vi.mock("./summary", async (original) => {
  const actual = await original<typeof import("./summary")>();
  return { summary: vi.fn(actual.summary) };
});

beforeAll(mockReactFlow);
beforeEach(() => {
  vi.mocked(summary).mockClear();
});

function chain(count: number): NodeRaw[] {
  const nodes: NodeRaw[] = [{ id: "n001", type: "source", table: "gold.finance.f", columns: [] }];
  for (let i = 2; i <= count; i++) {
    const id = `n${String(i).padStart(3, "0")}`;
    nodes.push({ id, type: "compute", inputs: [nodes[nodes.length - 1].id], column: `c${i}`, expr: "a - b" });
  }
  return nodes;
}

function layout(nodes: NodeRaw[]): Positions {
  return Object.fromEntries(nodes.map((node, i) => [node.id, { x: 24 + (i % 10) * 264, y: 24 + Math.floor(i / 10) * 168 }]));
}

function props(nodes: NodeRaw[], overrides: Partial<CanvasProps> = {}): CanvasProps {
  return {
    nodes,
    positions: layout(nodes),
    selected: null,
    pending: null,
    output: nodes[nodes.length - 1].id,
    variation: [],
    overridden: [],
    locked: false,
    issues: [],
    tool: "select",
    label: "Graphe",
    onSelect: () => undefined,
    onMove: () => undefined,
    onConnect: () => undefined,
    onDisconnect: () => undefined,
    onRemove: () => undefined,
    onDrop: () => undefined,
    ...overrides,
  };
}

const view = (p: CanvasProps) => (
  <ReactFlowProvider>
    <Canvas {...p} />
  </ReactFlowProvider>
);

/** Identifiants des cartes redessinées depuis le dernier `mockClear`. */
const redrawn = () => vi.mocked(summary).mock.calls.map(([node]) => node.id);

describe("Canvas sur un grand graphe (plan 0024)", () => {
  const nodes = chain(LARGE_GRAPH);
  const base = props(nodes);

  it("[S-0024-01] déplacer un nœud ne redessine que sa carte", () => {
    const { rerender, container } = render(view(base));
    expect(container.querySelectorAll("[data-node-id]")).toHaveLength(LARGE_GRAPH);
    vi.mocked(summary).mockClear();
    rerender(view({ ...base, positions: { ...base.positions, n007: { x: 600, y: 600 } } }));
    expect(new Set(redrawn())).toEqual(new Set(["n007"]));
  });

  it("un document recopié à l'identique ne redessine rien", () => {
    const { rerender } = render(view(base));
    vi.mocked(summary).mockClear();
    rerender(view({ ...base, nodes: structuredClone(nodes), issues: [] }));
    expect(redrawn()).toEqual([]);
  });

  it("[S-0024-02] changer la sélection ne redessine que les deux cartes concernées", () => {
    const { rerender } = render(view({ ...base, selected: "n003" }));
    vi.mocked(summary).mockClear();
    rerender(view({ ...base, selected: "n004" }));
    expect(new Set(redrawn())).toEqual(new Set(["n003", "n004"]));
  });

  it("[S-0024-02] une modification ne redessine que le nœud modifié", () => {
    const { rerender } = render(view(base));
    vi.mocked(summary).mockClear();
    const edited = structuredClone(nodes);
    edited[9] = { ...edited[9], expr: "a + b" };
    rerender(view({ ...base, nodes: edited }));
    expect(new Set(redrawn())).toEqual(new Set([edited[9].id]));
  });

  it("au-delà de LARGE_GRAPH nœuds, seules les cartes visibles sont dessinées", () => {
    const large = chain(200);
    const { container } = render(view(props(large)));
    const drawn = container.querySelectorAll("[data-node-id]").length;
    expect(drawn).toBeGreaterThan(0);
    expect(drawn).toBeLessThan(large.length);
  });
});


describe("sélection et suppression au clavier", () => {
  it.each(["Backspace", "bouton"])("supprime une arête sélectionnée : %s", async (action) => {
    const onDisconnect = vi.fn();
    render(view(props(chain(2), { onDisconnect })));
    const edge = await screen.findByLabelText("Edge from n001 to n002");
    fireEvent.keyDown(edge, { key: "Enter", code: "Enter" });
    fireEvent.keyUp(edge, { key: "Enter", code: "Enter" });
    const button = await screen.findByRole("button", { name: "Supprimer l'arête" });
    if (action === "bouton") fireEvent.click(button);
    else {
      fireEvent.keyDown(edge, { key: "Backspace", code: "Backspace" });
      await waitFor(() => expect(onDisconnect).toHaveBeenCalledWith("n001", "n002", undefined));
      fireEvent.keyUp(edge, { key: "Backspace", code: "Backspace" });
    }
    await waitFor(() => expect(onDisconnect).toHaveBeenCalledWith("n001", "n002", undefined));
  });

  it("répercute la sélection clavier d’un nœud et sa suppression", async () => {
    const onRemove = vi.fn();
    const nodes = chain(2);
    function Controlled() {
      const [selected, setSelected] = useState<string | null>(null);
      return view(props(nodes, { selected, onSelect: setSelected, onRemove }));
    }
    render(<Controlled />);
    const node = screen.getByRole("group", { name: "Calcul de colonne n002" });
    fireEvent.keyDown(node, { key: "Enter", code: "Enter" });
    fireEvent.keyUp(node, { key: "Enter", code: "Enter" });
    await waitFor(() => expect(node).toHaveClass("selected"));
    fireEvent.keyDown(document, { key: "Delete", code: "Delete" });
    await waitFor(() => expect(onRemove).toHaveBeenCalledWith("n002"));
    fireEvent.keyUp(document, { key: "Delete", code: "Delete" });
  });
});

// --- cartes, glisser-déposer, arêtes -------------------------------------------------------

const JOINED: NodeRaw[] = [
  { id: "n01", type: "source", table: "gold.finance.factures", columns: [] },
  { id: "n02", type: "source", table: "gold.ref.clients" },
  { id: "n03", type: "join", inputs: { left: "n01" }, keys: [["client_id", "id"]], how: "left", label: "Factures × clients" },
  { id: "n04", type: "filter", inputs: ["n03"], condition: "pays:equals:FR", nulls: "keep" },
];
const card = (container: HTMLElement, id: string) => container.querySelector(`[data-node-id="${id}"]`) as HTMLElement;

describe("cartes du canevas (guide 4)", () => {
  it("type, identifiant, résumé, libellé, sortie et premier problème non informatif", async () => {
    const { container } = render(view(props(JOINED, {
      output: "n04",
      variation: ["n03"],
      issues: [
        { path: "/a", node_id: "n04", code: "info", message: "Simple information.", severity: "info" },
        { path: "/b", node_id: "n04", code: "x", message: "Valeur manquante.", severity: "error" },
        { path: "/c", node_id: "n04", code: "y", message: "Second problème.", severity: "warning" },
      ],
    })));
    await waitFor(() => expect(card(container, "n03")).not.toBeNull());
    const join = card(container, "n03");
    expect(join).toHaveClass("edit-node", "band-combine", "is-join");
    expect(join).toHaveTextContent("Jointure");
    expect(join).toHaveTextContent("Variation");
    expect(join).toHaveTextContent("client_id = id");
    expect(join).toHaveTextContent("left");
    expect(join).toHaveTextContent("Factures × clients");
    const filter = card(container, "n04");
    expect(filter).toHaveTextContent("pays = FR");
    expect(filter).toHaveTextContent("sortie du graphe");
    expect(filter.querySelector(".edit-node-issue")).toHaveClass("issue-error");
    expect(filter.querySelector(".edit-node-issue")).toHaveTextContent("Valeur manquante.");
    expect(filter).not.toHaveTextContent("Second problème.");
    expect(card(container, "n01")).not.toHaveTextContent("sortie du graphe");
  });

  it("une jointure a deux ports d'entrée « gauche » et « droite » ; une source n'en a aucun", async () => {
    const { container } = render(view(props(JOINED)));
    await waitFor(() => expect(card(container, "n03")).not.toBeNull());
    const join = card(container, "n03");
    expect(join.querySelector(".port-label-left")).toHaveTextContent("gauche");
    expect(join.querySelector(".port-label-right")).toHaveTextContent("droite");
    expect([...join.querySelectorAll(".react-flow__handle.target")].map((h) => h.getAttribute("data-handleid"))).toEqual(["left", "right"]);
    expect(card(container, "n01").querySelectorAll(".react-flow__handle.target")).toHaveLength(0);
    expect(card(container, "n04").querySelectorAll(".react-flow__handle.target")).toHaveLength(1);
    expect(card(container, "n01").querySelectorAll(".react-flow__handle.source")).toHaveLength(1);
  });

  it("mode surcharge : nœuds verrouillés sauf ceux surchargés, nœud en attente d'arête marqué", async () => {
    const { container } = render(view(props(JOINED, { locked: true, overridden: ["n04"], pending: "n01" })));
    await waitFor(() => expect(card(container, "n04")).not.toBeNull());
    expect(card(container, "n03")).toHaveClass("is-locked");
    expect(card(container, "n04")).not.toHaveClass("is-locked");
    expect(card(container, "n04")).toHaveClass("is-overridden");
    expect(card(container, "n04")).toHaveTextContent("Surcharge");
    expect(card(container, "n01")).toHaveClass("is-pending");
  });

  // Contrôle : un ReactFlow qui applique les changements « dimensions » dessine ses nœuds
  // dans la mini-carte sous jsdom ; Canvas les ignore, la mini-carte reste vide.
  // bug : Canvas.tsx:168-176, onNodesChange ne retient que « select » et « position » : les nœuds
  // passés à React Flow n'ont jamais de `measured`, et la MiniMap ne dessine que les nœuds mesurés
  // (nodeHasDimensions sur le nœud utilisateur). La mini-carte du guide 10.3 est donc vide.
  it("mesurer les nœuds ne déplace aucun nœud", async () => {
    const onMove = vi.fn();
    const initial = props(JOINED, { onMove });
    const { container } = render(view(initial));
    await waitFor(() => expect(container.querySelectorAll(".react-flow__minimap-node")).toHaveLength(4));
    expect(onMove).not.toHaveBeenCalled();
    expect(initial.positions).toEqual(layout(JOINED));
  });

  it("la mini-carte dessine chaque nœud, coloré selon sa famille", async () => {
    const { container } = render(view(props(JOINED)));
    const minimap = await screen.findByLabelText("Mini-carte du graphe");
    await waitFor(() => expect(container.querySelectorAll(".react-flow__minimap-node")).toHaveLength(4), { timeout: 500 });
    expect([...minimap.querySelectorAll(".react-flow__minimap-node")].map((n) => (n as SVGElement).style.fill)).toEqual([
      "var(--atlas-node-source)", "var(--atlas-node-source)", "var(--atlas-node-combine)", "var(--atlas-node-rows)",
    ]);
  });
});

describe("palette glissée sur le canevas", () => {
  const drop = (target: Element, type: string, effect = { dropEffect: "none" }) => {
    const dataTransfer = Object.assign(effect, { getData: (format: string) => (format === "application/x-atlas-node" ? type : "") });
    const over = fireEvent.dragOver(target, { dataTransfer, clientX: 300, clientY: 120 });
    const dropped = fireEvent.drop(target, { dataTransfer, clientX: 300, clientY: 120 });
    return { over, dropped, dataTransfer };
  };

  it("déposer un type de nœud l'ajoute à la position du canevas", () => {
    const onDrop = vi.fn();
    render(view(props(JOINED, { onDrop })));
    const canvas = screen.getByRole("group", { name: "Graphe" });
    const { over, dataTransfer } = drop(canvas, "aggregate");
    expect(over).toBe(false); // preventDefault : le dépôt est accepté
    expect(dataTransfer.dropEffect).toBe("copy");
    expect(onDrop).toHaveBeenCalledWith("aggregate", { x: expect.any(Number), y: expect.any(Number) });
  });

  it("un glisser étranger à la palette est ignoré", () => {
    const onDrop = vi.fn();
    render(view(props(JOINED, { onDrop })));
    drop(screen.getByRole("group", { name: "Graphe" }), "");
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("mode surcharge : ni dépôt accepté, ni nœud ajouté", () => {
    const onDrop = vi.fn();
    render(view(props(JOINED, { onDrop, locked: true })));
    const { over } = drop(screen.getByRole("group", { name: "Graphe" }), "filter");
    expect(over).toBe(true);
    expect(onDrop).not.toHaveBeenCalled();
  });
});

describe("sélection et arêtes", () => {
  // Relier au clic (connectOnClick) : React Flow cherche le port sous le pointeur.
  beforeEach(() => {
    Object.assign(document, { elementFromPoint: () => null });
  });
  afterEach(() => {
    delete (document as unknown as Record<string, unknown>).elementFromPoint;
  });

  it("cliquer le fond désélectionne le nœud et l'arête", async () => {
    const onSelect = vi.fn();
    const { container } = render(view(props(chain(2), { onSelect, selected: "n002" })));
    const edge = await screen.findByLabelText("Edge from n001 to n002");
    fireEvent.keyDown(edge, { key: "Enter", code: "Enter" });
    fireEvent.keyUp(edge, { key: "Enter", code: "Enter" });
    await screen.findByRole("button", { name: "Supprimer l'arête" });
    fireEvent.click(container.querySelector(".react-flow__pane")!);
    expect(onSelect).toHaveBeenLastCalledWith(null);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Supprimer l'arête" })).not.toBeInTheDocument());
  });

  it("cliquer une carte la sélectionne", async () => {
    const onSelect = vi.fn();
    const { container } = render(view(props(chain(2), { onSelect })));
    await waitFor(() => expect(card(container, "n001")).not.toBeNull());
    fireEvent.click(card(container, "n001"));
    expect(onSelect).toHaveBeenCalledWith("n001");
  });

  it("verrouillé : une arête sélectionnée ne se supprime pas", async () => {
    const onDisconnect = vi.fn();
    render(view(props(chain(2), { onDisconnect, locked: true })));
    const edge = await screen.findByLabelText("Edge from n001 to n002");
    fireEvent.keyDown(edge, { key: "Enter", code: "Enter" });
    fireEvent.keyUp(edge, { key: "Enter", code: "Enter" });
    fireEvent.keyDown(edge, { key: "Backspace", code: "Backspace" });
    fireEvent.keyUp(edge, { key: "Backspace", code: "Backspace" });
    expect(screen.queryByRole("button", { name: "Supprimer l'arête" })).not.toBeInTheDocument();
    expect(onDisconnect).not.toHaveBeenCalled();
  });

  it.each([
    ["gauche", "left"],
    ["droite", "right"],
  ] as const)("relier deux ports au clic transmet le côté de la jointure : %s", async (_, side) => {
    const onConnect = vi.fn();
    const { container } = render(view(props(JOINED, { onConnect })));
    await waitFor(() => expect(card(container, "n03")).not.toBeNull());
    fireEvent.click(card(container, "n02").querySelector(".react-flow__handle.source")!);
    fireEvent.click(card(container, "n03").querySelector(`.react-flow__handle.target[data-handleid="${side}"]`)!);
    expect(onConnect).toHaveBeenCalledWith("n02", "n03", side);
  });

  it("relier vers un nœud à entrée unique ne transmet pas de côté", async () => {
    const onConnect = vi.fn();
    const { container } = render(view(props(JOINED, { onConnect })));
    await waitFor(() => expect(card(container, "n04")).not.toBeNull());
    fireEvent.click(card(container, "n01").querySelector(".react-flow__handle.source")!);
    fireEvent.click(card(container, "n04").querySelector(".react-flow__handle.target")!);
    expect(onConnect).toHaveBeenCalledWith("n01", "n04", undefined);
  });
});

describe("poignées pendant une relecture", () => {
  // Dans un navigateur, ResizeObserver ne répond qu'à l'image suivante : on retient ses
  // réponses pour voir le graphe entre le rendu et la mesure.
  const pending: (() => void)[] = [];
  class LateResizeObserver {
    constructor(private readonly callback: (entries: { target: Element; contentRect: DOMRect }[], observer: unknown) => void) {}
    observe(target: Element) { pending.push(() => this.callback([{ target, contentRect: target.getBoundingClientRect() }], this)); }
    unobserve() {}
    disconnect() {}
  }
  const measure = () => act(() => { pending.splice(0).forEach((answer) => answer()); });

  it("un nœud dont le contenu change garde ses poignées et reste visible avant sa nouvelle mesure", () => {
    // Le résultat de la validation arrivait pendant le glisser d'une liaison : React Flow
    // oubliait la taille et les poignées de la carte jusqu'à la mesure suivante, la cachait,
    // et le relâchement sur sa poignée ne reliait rien (S-UI-103-01 sous WebKit).
    const original = globalThis.ResizeObserver;
    globalThis.ResizeObserver = LateResizeObserver as unknown as typeof ResizeObserver;
    try {
      let store: ReturnType<typeof useStoreApi> | null = null;
      function Probe() { store = useStoreApi(); return null; }
      const base = props(chain(2));
      const graph = (p: CanvasProps) => <ReactFlowProvider><Canvas {...p} /><Probe /></ReactFlowProvider>;
      const { rerender, container } = render(graph(base));
      measure();
      measure();
      const handles = () => store!.getState().nodeLookup.get("n002")?.internals.handleBounds;
      const card = () => container.querySelector<HTMLElement>('.react-flow__node[data-id="n002"]')!;
      expect(handles()?.target).toHaveLength(1);

      rerender(graph({ ...base, issues: [{ path: "graph.nodes[1].inputs", node_id: "n002", code: "required", message: "Champ requis manquant : « inputs ».", severity: "error" }] }));
      expect(screen.getByText("Champ requis manquant : « inputs ».")).toBeInTheDocument();
      expect(handles()?.target).toHaveLength(1);
      expect(card().style.visibility).not.toBe("hidden");
    } finally {
      globalThis.ResizeObserver = original;
    }
  });
});

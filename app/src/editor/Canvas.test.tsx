import { render } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

  it("déplacer un nœud ne redessine que sa carte", () => {
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

  it("changer la sélection ne redessine que les deux cartes concernées", () => {
    const { rerender } = render(view({ ...base, selected: "n003" }));
    vi.mocked(summary).mockClear();
    rerender(view({ ...base, selected: "n004" }));
    expect(new Set(redrawn())).toEqual(new Set(["n003", "n004"]));
  });

  it("une modification ne redessine que le nœud modifié", () => {
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

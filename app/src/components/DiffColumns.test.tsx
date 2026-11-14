import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { DiffReport, GraphLayout, GraphNode } from "../api";
import { mockReactFlow } from "../test/reactFlow";
import { DiffColumns } from "./DiffColumns";

// Diff deux colonnes (guide 4) : défiler un graphe fait défiler l'autre, le nœud désigné
// est amené dans la zone visible, la liste des écarts suit les graphes.

beforeAll(mockReactFlow);

function node(id: string, layer: number): GraphNode {
  return { id, type: "filter", type_label: "Filtre", family: "rows", title: `titre ${id}`, detail: "", variation: false, output: false, layer, rank: 0 };
}

const LAYOUT: GraphLayout = {
  output: "n02",
  nodes: [node("n01", 0), node("n02", 1)],
  edges: [{ id: "n01-n02", source: "n01", target: "n02", side: null }],
  overrides: [],
};

const REPORT: DiffReport = {
  identical: false,
  relation: "version",
  base: { id: "k", version: 3, fingerprint: "a" },
  other: { id: "k", version: 4, fingerprint: "b" },
  differences: [{
    kind: "modified", node_ref: { base: "n02", other: "n02" }, node_type: "filter",
    changes: [{ field: "column", before: "a", after: "b" }], classification: "to_verify", severity: "warn",
    message: "Filtre : column modifié(s). À vérifier.",
  }],
  summary: { by_classification: {}, by_severity: { info: 0, warn: 1, critical: 0 } },
};

const columns = (props: Partial<Parameters<typeof DiffColumns>[0]> = {}) =>
  render(
    <DiffColumns
      base={{ ...LAYOUT, label: "Version 3" }}
      other={{ ...LAYOUT, label: "Version 4" }}
      report={REPORT}
      label="Diff"
      {...props}
    />,
  );

describe("DiffColumns", () => {
  it("défiler un graphe aligne l'autre, une seule fois par image", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
    columns();
    const left = screen.getByRole("figure", { name: "Graphe : Version 3" });
    const right = screen.getByRole("figure", { name: "Graphe : Version 4" });
    left.scrollLeft = 120;
    fireEvent.scroll(left);
    expect(right.scrollLeft).toBe(120);
    // L'écho du défilement provoqué n'est pas renvoyé tant que l'image n'est pas passée.
    right.scrollLeft = 40;
    fireEvent.scroll(right);
    expect(left.scrollLeft).toBe(120);
    frames.forEach((frame) => frame(0));
    fireEvent.scroll(right);
    expect(left.scrollLeft).toBe(40);
    vi.unstubAllGlobals();
  });

  it("un défilement interne à une carte (hors figure) ne synchronise rien", () => {
    columns();
    const left = screen.getByRole("figure", { name: "Graphe : Version 3" });
    const right = screen.getByRole("figure", { name: "Graphe : Version 4" });
    const inner = left.firstElementChild as HTMLElement;
    inner.scrollLeft = 80;
    fireEvent.scroll(inner);
    expect(right.scrollLeft).toBe(0);
  });

  it("amène le nœud désigné dans la zone visible", () => {
    const scrolled = vi.fn();
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scrolled;
    try {
      columns({ selected: "n02" });
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
    expect(scrolled).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
    expect(scrolled.mock.contexts[0]).toHaveClass("is-selected");
  });

  it("sans référence ni rapport : une seule colonne, pas de liste d'écarts", () => {
    columns({ base: null, report: null });
    expect(screen.getAllByRole("figure")).toHaveLength(1);
    expect(screen.queryByText("Écarts")).toBeNull();
  });

  it("un rapport identique résume sans lister d'écart", () => {
    columns({ report: { ...REPORT, identical: true, differences: [] } });
    const region = screen.getByRole("region", { name: "Diff" });
    expect(within(region).getByText("Écarts")).toBeInTheDocument();
    expect(region.querySelector(".diff-item")).toBeNull();
  });
});

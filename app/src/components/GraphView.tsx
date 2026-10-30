import { Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { GraphLayout, GraphNode } from "../api";

// Graphe en lecture (guide 4, « Nœud en lecture ») : cartes de 150 de large placées par
// la disposition du serveur (couche, rang), sans zoom ni déplacement. Un graphe plus large
// que la zone défile dans son conteneur, comme un tableau. Réutilisé par le diff (0012,
// 0014) : `marks` surligne les nœuds modifiés, ajoutés, retirés ou surchargés, `notes`
// écrit à droite la classification de l'écart.

export type Mark = "modified" | "added" | "removed" | "overridden";

const MARK_LABELS: Record<Mark, string> = { modified: "modifié", added: "ajouté", removed: "retiré", overridden: "surchargé" };

// Pas de la grille, en unités du canevas : carte (--atlas-node-read-w) plus l'espace des arêtes.
const COLUMN = 206;
const ROW = 150;
const PAD = 24;

type CardData = { node: GraphNode; mark?: Mark; note?: string };
type CardNode = Node<CardData, "card">;

function Card({ data }: NodeProps<CardNode>) {
  const { node, mark, note } = data;
  const classes = [
    "graph-card",
    node.variation && "is-variation",
    node.output && "is-output",
    mark && `mark-${mark}`,
  ].filter(Boolean);
  return (
    <div className={classes.join(" ")}>
      {node.type === "join" ? (
        <>
          <Handle id="left" type="target" position={Position.Left} isConnectable={false} style={{ top: "35%" }} />
          <Handle id="right" type="target" position={Position.Left} isConnectable={false} style={{ top: "65%" }} />
        </>
      ) : (
        <Handle type="target" position={Position.Left} isConnectable={false} />
      )}
      <span className="graph-card-type">
        <span className={`graph-family family-${node.family}`} aria-hidden="true" />
        <span>
          {node.type_label}
          {node.variation && " · variation"}
        </span>
        <span className="graph-card-id mono">{node.id}</span>
      </span>
      <span className="graph-card-title">{node.title}</span>
      <span className="graph-card-detail">{node.detail}</span>
      {mark && (
        <span className="graph-card-mark">
          <span>{MARK_LABELS[mark]}</span>
          {note && <span className="graph-card-note">{note}</span>}
        </span>
      )}
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}

const NODE_TYPES = { card: Card };

/** Positions des cartes : colonnes par couche, rangs centrés verticalement. */
export function positions(layout: GraphLayout) {
  const counts = new Map<number, number>();
  layout.nodes.forEach((node) => counts.set(node.layer, (counts.get(node.layer) ?? 0) + 1));
  const rows = Math.max(1, ...counts.values());
  const layers = Math.max(0, ...layout.nodes.map((node) => node.layer)) + 1;
  const placed = layout.nodes.map((node) => ({
    id: node.id,
    x: PAD + node.layer * COLUMN,
    y: PAD + (node.rank + (rows - (counts.get(node.layer) ?? 1)) / 2) * ROW,
  }));
  return { placed, width: 2 * PAD + layers * COLUMN, height: 2 * PAD + rows * ROW };
}

export function GraphView({
  layout,
  label,
  marks = {},
  notes = {},
}: {
  layout: GraphLayout;
  label: string;
  marks?: Record<string, Mark>;
  notes?: Record<string, string>;
}) {
  const { placed, width, height } = positions(layout);
  const at = new Map(placed.map((p) => [p.id, p]));
  const nodes: CardNode[] = layout.nodes.map((node) => ({
    id: node.id,
    type: "card",
    position: { x: at.get(node.id)!.x, y: at.get(node.id)!.y },
    data: { node, mark: marks[node.id], note: notes[node.id] },
    draggable: false,
    selectable: false,
    focusable: false,
  }));
  const edges: Edge[] = layout.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    targetHandle: edge.side ?? undefined,
    type: "smoothstep",
    markerEnd: { type: MarkerType.ArrowClosed, color: "var(--atlas-node-source)" },
    focusable: false,
    selectable: false,
  }));
  return (
    // Focalisable : un graphe plus large que la zone défile aussi au clavier.
    <figure className="graph" aria-label={label} tabIndex={0}>
      <div style={{ width, height }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          nodesDraggable={false}
          nodesConnectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          elementsSelectable={false}
          panOnDrag={false}
          panOnScroll={false}
          zoomOnScroll={false}
          zoomOnPinch={false}
          zoomOnDoubleClick={false}
          preventScrolling={false}
          defaultViewport={{ x: 0, y: 0, zoom: 1 }}
          proOptions={{ hideAttribution: true }}
        />
      </div>
    </figure>
  );
}

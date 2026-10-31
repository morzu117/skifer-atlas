import {
  Background,
  BackgroundVariant,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  useReactFlow,
  type Connection,
  type Edge as FlowEdge,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { memo, useMemo, type DragEvent } from "react";
import type { Issue } from "../api";
import { Icon } from "../components/Icon";
import { useStable } from "../stable";
import { edgesOf, typeInfo, type NodeRaw, type NodeType, type Positions, type Side } from "./model";
import { summary } from "./summary";

// Canevas de l'éditeur (guide 4, « Nœud en édition ») : nœuds de 184 px (200 px pour une
// jointure et ses deux ports « gauche » / « droite »), arêtes orthogonales, trame de
// 24 px, mini-carte. L'en-tête porte la couleur de famille en bandeau et en pastille,
// avec un texte foncé : le blanc sur la couleur des lignes ne passerait pas 4,5:1 (ADR 0017).
// Au-delà de LARGE_GRAPH nœuds, seuls ceux de la zone visible sont dessinés (ADR 0028).

export type Tool = "select" | "pan" | "edge";
export const DRAG_TYPE = "application/x-atlas-node";
export const LARGE_GRAPH = 50;

type CardData = {
  node: NodeRaw;
  variation: boolean;
  output: boolean;
  issue?: Issue;
  locked: boolean;
  overridden: boolean;
  pending: boolean;
};
type CardNode = Node<CardData, "card">;

// Mémoïsée : une carte ne se redessine que si ses `data` ou sa sélection changent.
const Card = memo(function Card({ data, selected }: NodeProps<CardNode>) {
  const { node, variation, output, issue, locked, overridden, pending } = data;
  const info = typeInfo(node.type);
  const text = summary(node);
  const classes = [
    "edit-node",
    `band-${info.family}`,
    node.type === "join" && "is-join",
    selected && "is-selected",
    locked && "is-locked",
    overridden && "is-overridden",
    pending && "is-pending",
  ].filter(Boolean);
  const inputs = node.type !== "source" && node.type !== "kpi_ref";
  return (
    <div className={classes.join(" ")} data-node-id={node.id}>
      {node.type === "join" ? (
        <>
          <Handle id="left" type="target" position={Position.Left} className="port port-left" />
          <span className="port-label port-label-left">gauche</span>
          <Handle id="right" type="target" position={Position.Left} className="port port-right" />
          <span className="port-label port-label-right">droite</span>
        </>
      ) : (
        inputs && <Handle type="target" position={Position.Left} className="port" />
      )}
      <span className="edit-node-head">
        <span className={`edit-node-swatch family-${info.family}`} aria-hidden="true" />
        <span className="edit-node-type">{info.short}</span>
        {variation && <span className="edit-node-chip">Variation</span>}
        {overridden && <span className="edit-node-chip">Surcharge</span>}
        <span className="edit-node-id mono">{node.id}</span>
      </span>
      <span className="edit-node-body">
        <span className="edit-node-main mono">{text.main}</span>
        {text.meta && <span className="edit-node-meta">{text.meta}</span>}
        {typeof node.label === "string" && node.label && <span className="edit-node-meta">{node.label}</span>}
        {output && <span className="edit-node-meta edit-node-output">sortie du graphe</span>}
        {issue && (
          <span className={`edit-node-issue issue-${issue.severity}`}>
            <Icon name="alert" className="icon-xs" />
            {issue.message}
          </span>
        )}
      </span>
      <Handle type="source" position={Position.Right} className="port" />
    </div>
  );
});

const NODE_TYPES = { card: Card };

const nodeColor = (node: Node) => `var(--atlas-node-${typeInfo((node.data as CardData).node.type).family})`;

export type CanvasProps = {
  nodes: NodeRaw[];
  positions: Positions;
  selected: string | null;
  pending: string | null;
  output?: string;
  variation: string[];
  overridden: string[];
  locked: boolean; // mode surcharge : pas d'ajout, de suppression ni d'arête
  issues: Issue[];
  tool: Tool;
  label: string;
  onSelect: (id: string | null) => void;
  onMove: (id: string, position: { x: number; y: number }) => void;
  onConnect: (source: string, target: string, side?: Side) => void;
  onDisconnect: (source: string, target: string, side?: Side) => void;
  onRemove: (id: string) => void;
  onDrop: (type: NodeType, position: { x: number; y: number }) => void;
};

export function Canvas(props: CanvasProps) {
  const { nodes, positions, selected, pending, output, variation, overridden, locked, issues, tool } = props;
  const flow = useReactFlow();

  const byNode = useMemo(() => {
    const found = new Map<string, Issue>();
    for (const issue of issues) {
      if (issue.node_id && issue.severity !== "info" && !found.has(issue.node_id)) found.set(issue.node_id, issue);
    }
    return found;
  }, [issues]);

  const flowNodes = useStable<CardNode>(nodes.map((node) => ({
    id: node.id,
    type: "card",
    position: positions[node.id] ?? { x: 0, y: 0 },
    selected: node.id === selected,
    draggable: tool === "select",
    connectable: !locked,
    deletable: !locked,
    ariaLabel: `${typeInfo(node.type).label} ${node.id}`,
    data: {
      node,
      variation: variation.includes(node.id),
      output: node.id === output,
      issue: byNode.get(node.id),
      locked: locked && !overridden.includes(node.id),
      overridden: overridden.includes(node.id),
      pending: node.id === pending,
    },
  })));

  const flowEdges = useStable<FlowEdge>(edgesOf(nodes).map((edge) => ({
    id: `${edge.source}-${edge.target}-${edge.side ?? "in"}`,
    source: edge.source,
    target: edge.target,
    targetHandle: edge.side ?? undefined,
    type: "smoothstep",
    deletable: !locked,
    data: { side: edge.side },
    markerEnd: { type: MarkerType.ArrowClosed, color: "var(--atlas-node-source)" },
  })));

  const onNodesChange = (changes: NodeChange<CardNode>[]) => {
    for (const change of changes) {
      if (change.type === "position" && change.position) props.onMove(change.id, change.position);
    }
  };

  const onConnect = (connection: Connection) => {
    if (!connection.source || !connection.target) return;
    const side = connection.targetHandle === "left" || connection.targetHandle === "right" ? connection.targetHandle : undefined;
    props.onConnect(connection.source, connection.target, side);
  };

  const onDragOver = (event: DragEvent) => {
    if (locked) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const onDrop = (event: DragEvent) => {
    const type = event.dataTransfer.getData(DRAG_TYPE) as NodeType;
    if (!type || locked) return;
    event.preventDefault();
    props.onDrop(type, flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
  };

  return (
    <div className={`canvas tool-${tool}`} onDragOver={onDragOver} onDrop={onDrop} aria-label={props.label} role="group">
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={NODE_TYPES}
        onNodesChange={onNodesChange}
        onConnect={onConnect}
        onNodeClick={(_, node) => props.onSelect(node.id)}
        onPaneClick={() => props.onSelect(null)}
        onNodesDelete={(deleted) => deleted.forEach((node) => props.onRemove(node.id))}
        onEdgesDelete={(deleted) =>
          deleted.forEach((edge) => props.onDisconnect(edge.source, edge.target, (edge.data?.side as Side | undefined) ?? undefined))
        }
        nodesConnectable={!locked}
        panOnDrag={tool === "pan" ? true : [1, 2]}
        selectionOnDrag={false}
        deleteKeyCode={locked ? null : ["Delete", "Backspace"]}
        snapToGrid
        snapGrid={[24, 24]}
        minZoom={0.25}
        maxZoom={2}
        onlyRenderVisibleElements={nodes.length > LARGE_GRAPH}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Lines} gap={24} />
        <MiniMap
          pannable
          zoomable
          ariaLabel="Mini-carte du graphe"
          nodeColor={nodeColor}
        />
      </ReactFlow>
    </div>
  );
}

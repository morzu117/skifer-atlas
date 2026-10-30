// Modèle de l'éditeur (plan 0013). L'état est le document YAML analysé (JSON) ; le
// canevas n'en est qu'une projection. Chaque modification est une opération pure
// appliquée au document : la pile d'annulation porte sur ces opérations, et les positions
// du canevas restent à part, jamais dans le YAML.

export type Raw = Record<string, unknown>;
export type NodeRaw = Raw & { id: string; type: NodeType };
export type NodeType =
  | "source"
  | "kpi_ref"
  | "filter"
  | "deduplicate"
  | "compute"
  | "temporal"
  | "join"
  | "union"
  | "aggregate"
  | "metric_op";
export type Family = "source" | "ref" | "rows" | "combine" | "result";
export type Side = "left" | "right";
export type Mode = "canonical" | "override" | "from_scratch";
export type Path = (string | number)[];

export const TYPES: { type: NodeType; label: string; short: string; family: Family }[] = [
  { type: "source", label: "Source", short: "Source", family: "source" },
  { type: "kpi_ref", label: "Référence à un KPI", short: "Réf. KPI", family: "ref" },
  { type: "filter", label: "Filtre", short: "Filtre", family: "rows" },
  { type: "deduplicate", label: "Dédoublonnage", short: "Dédoublonnage", family: "rows" },
  { type: "compute", label: "Calcul de colonne", short: "Calcul", family: "rows" },
  { type: "temporal", label: "Opération temporelle", short: "Temporel", family: "rows" },
  { type: "join", label: "Jointure", short: "Jointure", family: "combine" },
  { type: "union", label: "Union", short: "Union", family: "combine" },
  { type: "aggregate", label: "Agrégation", short: "Agrégation", family: "result" },
  { type: "metric_op", label: "Opération entre métriques", short: "Métriques", family: "result" },
];

export const PALETTE: { label: string; types: NodeType[] }[] = [
  { label: "Entrées", types: ["source", "kpi_ref"] },
  { label: "Lignes", types: ["filter", "deduplicate", "compute", "temporal"] },
  { label: "Combinaison", types: ["join", "union"] },
  { label: "Résultat", types: ["aggregate", "metric_op"] },
];

export const typeInfo = (type: string) => TYPES.find((t) => t.type === type) ?? TYPES[0];

const isRaw = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const clone = <T>(value: T): T => structuredClone(value);

// --- lecture -------------------------------------------------------------------------------

export function nodesOf(doc: Raw): NodeRaw[] {
  const graph = isRaw(doc.graph) ? doc.graph : {};
  return list(graph.nodes).filter((n): n is NodeRaw => isRaw(n) && typeof n.id === "string");
}

export function outputOf(doc: Raw): string | undefined {
  const graph = isRaw(doc.graph) ? doc.graph : {};
  return typeof graph.output === "string" ? graph.output : undefined;
}

export function inputsOf(node: Raw): string[] {
  const inputs = node.inputs;
  if (isRaw(inputs)) return [inputs.left, inputs.right].filter((v): v is string => typeof v === "string");
  return list(inputs).filter((v): v is string => typeof v === "string");
}

export type Edge = { source: string; target: string; side?: Side };

export function edgesOf(nodes: NodeRaw[]): Edge[] {
  const ids = new Set(nodes.map((n) => n.id));
  const edges: Edge[] = [];
  for (const node of nodes) {
    if (node.type === "join" && isRaw(node.inputs)) {
      for (const side of ["left", "right"] as const) {
        const source = node.inputs[side];
        if (typeof source === "string" && ids.has(source)) edges.push({ source, target: node.id, side });
      }
    } else {
      for (const source of inputsOf(node)) if (ids.has(source)) edges.push({ source, target: node.id });
    }
  }
  return edges;
}

export const variationPoints = (doc: Raw): string[] =>
  list(doc.variation_points).filter((v): v is string => typeof v === "string");

/** Nœuds dont `id` dépend, directement ou non. */
export function ancestors(nodes: NodeRaw[], id: string): Set<string> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const pending = [...inputsOf(byId.get(id) ?? {})];
  while (pending.length > 0) {
    const next = pending.pop()!;
    if (seen.has(next)) continue;
    seen.add(next);
    pending.push(...inputsOf(byId.get(next) ?? {}));
  }
  return seen;
}

/** Chemin de `from` à `to` en suivant les arêtes, s'il existe (pour nommer un cycle). */
function pathBetween(nodes: NodeRaw[], from: string, to: string): string[] | null {
  const consumers = new Map<string, string[]>();
  for (const edge of edgesOf(nodes)) consumers.set(edge.source, [...(consumers.get(edge.source) ?? []), edge.target]);
  const queue: string[][] = [[from]];
  const seen = new Set([from]);
  while (queue.length > 0) {
    const path = queue.shift()!;
    const last = path[path.length - 1];
    if (last === to) return path;
    for (const next of consumers.get(last) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push([...path, next]);
      }
    }
  }
  return null;
}

export const NO_INPUT: NodeType[] = ["source", "kpi_ref"];
export const MULTI_INPUT: NodeType[] = ["union"];

// --- identifiants --------------------------------------------------------------------------

export const nodeNumber = (id: string): number => {
  const match = /^n([0-9]{2,4})$/.exec(id);
  return match ? Number(match[1]) : 0;
};

/** Plus grand existant + 1, jamais un identifiant déjà attribué : `highest` retient le
 *  dernier attribué, versions antérieures et suppressions comprises (ADR 0017). */
export function nextId(doc: Raw, highest: number): { id: string; highest: number } {
  const max = Math.max(highest, ...nodesOf(doc).map((n) => nodeNumber(n.id)), 0);
  const next = max + 1;
  return { id: `n${String(next).padStart(2, "0")}`, highest: next };
}

// --- opérations ------------------------------------------------------------------------------

export type Op =
  | { kind: "add_node"; type: NodeType; id: string }
  | { kind: "remove"; id: string }
  | { kind: "duplicate"; id: string; copy: string }
  | { kind: "connect"; source: string; target: string; side?: Side }
  | { kind: "disconnect"; source: string; target: string; side?: Side }
  | { kind: "set_field"; id: string; path: Path; value: unknown }
  | { kind: "set_doc"; path: Path; value: unknown }
  | { kind: "set_variation"; id: string; on: boolean }
  | { kind: "set_output"; id: string }
  | { kind: "override"; id: string; node: NodeRaw }
  | { kind: "remove_override"; id: string }
  | { kind: "replace"; document: Raw };

export class OpError extends Error {}

/** Où vit un nœud modifiable : le graphe, ou le `replace` d'une surcharge. */
function location(doc: Raw, id: string): Path | null {
  const nodes = list(isRaw(doc.graph) ? doc.graph.nodes : undefined);
  const index = nodes.findIndex((n) => isRaw(n) && n.id === id);
  if (index >= 0) return ["graph", "nodes", index];
  const overrides = list(doc.overrides);
  const at = overrides.findIndex((o) => isRaw(o) && o.node === id && isRaw(o.replace));
  return at >= 0 ? ["overrides", at, "replace"] : null;
}

function getAt(value: unknown, path: Path): unknown {
  let current = value;
  for (const part of path) {
    if (Array.isArray(current) && typeof part === "number") current = current[part];
    else if (isRaw(current) && typeof part === "string") current = current[part];
    else return undefined;
  }
  return current;
}

/** Écrit `value` à `path` (ou retire la clé si `value` est undefined), en créant les
 *  mappings manquants. Mute `target`, qui est déjà une copie. */
function setAt(target: Raw, path: Path, value: unknown) {
  let current: unknown = target;
  for (let i = 0; i < path.length - 1; i++) {
    const part = path[i];
    const nextIsIndex = typeof path[i + 1] === "number";
    if (Array.isArray(current) && typeof part === "number") {
      if (current[part] === undefined) current[part] = nextIsIndex ? [] : {};
      current = current[part];
    } else if (isRaw(current) && typeof part === "string") {
      if (!isRaw(current[part]) && !Array.isArray(current[part])) current[part] = nextIsIndex ? [] : {};
      current = current[part];
    }
  }
  const last = path[path.length - 1];
  if (Array.isArray(current) && typeof last === "number") {
    if (value === undefined) current.splice(last, 1);
    else current[last] = value;
  } else if (isRaw(current) && typeof last === "string") {
    if (value === undefined) delete current[last];
    else current[last] = value;
  }
}

export const getField = (doc: Raw, id: string, path: Path): unknown => {
  const at = location(doc, id);
  return at ? getAt(doc, [...at, ...path]) : undefined;
};

export const nodeById = (doc: Raw, id: string): NodeRaw | undefined => {
  const at = location(doc, id);
  const found = at ? getAt(doc, at) : undefined;
  return isRaw(found) ? (found as NodeRaw) : undefined;
};

function ensureGraph(doc: Raw): Raw & { nodes: unknown[] } {
  if (!isRaw(doc.graph)) doc.graph = { nodes: [] };
  const graph = doc.graph as Raw;
  if (!Array.isArray(graph.nodes)) graph.nodes = [];
  return graph as Raw & { nodes: unknown[] };
}

function sinks(nodes: NodeRaw[]): string[] {
  const consumed = new Set(edgesOf(nodes).map((e) => e.source));
  return nodes.filter((n) => !consumed.has(n.id)).map((n) => n.id);
}

function connect(doc: Raw, source: string, target: string, side?: Side) {
  const nodes = nodesOf(doc);
  const node = nodeById(doc, target);
  if (!node || !nodes.some((n) => n.id === source)) throw new OpError("Nœud introuvable.");
  if (NO_INPUT.includes(node.type)) {
    throw new OpError(`${target} est une entrée du graphe : il ne reçoit pas d'arête.`);
  }
  if (source === target) throw new OpError(`Une arête de ${source} vers lui-même créerait un cycle.`);
  const loop = pathBetween(nodes, target, source);
  if (loop) {
    throw new OpError(`Arête refusée : elle créerait un cycle ${[...loop, target].join(" → ")}.`);
  }
  const at = location(doc, target)!;
  if (node.type === "join") {
    const inputs: Raw = isRaw(node.inputs) ? node.inputs : {};
    const next: Raw = { ...inputs, [side ?? (inputs.left === undefined ? "left" : "right")]: source };
    const clean: Raw = {};
    for (const key of ["left", "right"]) if (next[key] !== undefined) clean[key] = next[key];
    setAt(doc, [...at, "inputs"], clean);
  } else if (MULTI_INPUT.includes(node.type)) {
    const inputs = inputsOf(node);
    if (!inputs.includes(source)) setAt(doc, [...at, "inputs"], [...inputs, source]);
  } else {
    setAt(doc, [...at, "inputs"], [source]);
  }
  // On prolonge la chaîne : la sortie suit le nouveau nœud final.
  const graph = ensureGraph(doc);
  if (graph.output === source && sinks(nodesOf(doc)).includes(target)) graph.output = target;
}

function disconnect(doc: Raw, source: string, target: string, side?: Side) {
  const node = nodeById(doc, target);
  const at = location(doc, target);
  if (!node || !at) return;
  if (node.type === "join" && isRaw(node.inputs)) {
    const inputs = { ...node.inputs };
    for (const key of side ? [side] : (["left", "right"] as const)) if (inputs[key] === source) delete inputs[key];
    setAt(doc, [...at, "inputs"], inputs);
  } else {
    const kept = inputsOf(node).filter((s) => s !== source);
    setAt(doc, [...at, "inputs"], kept.length > 0 ? kept : undefined);
  }
}

function remove(doc: Raw, id: string) {
  const graph = ensureGraph(doc);
  graph.nodes = graph.nodes.filter((n) => !(isRaw(n) && n.id === id));
  for (const node of nodesOf(doc)) if (inputsOf(node).includes(id)) disconnect(doc, id, node.id);
  if (Array.isArray(doc.variation_points)) {
    doc.variation_points = variationPoints(doc).filter((p) => p !== id);
    if ((doc.variation_points as string[]).length === 0) delete doc.variation_points;
  }
  if (graph.output === id) {
    const left = sinks(nodesOf(doc));
    if (left.length > 0) graph.output = left[left.length - 1];
    else delete graph.output;
  }
  if (graph.nodes.length === 0) delete doc.graph;
}

export function apply(document: Raw, op: Op): Raw {
  const doc = clone(document);
  switch (op.kind) {
    case "add_node": {
      const graph = ensureGraph(doc);
      graph.nodes.push({ id: op.id, type: op.type });
      if (graph.output === undefined) graph.output = op.id;
      else {
        // `output` reste après `nodes`, comme dans le YAML canonique.
        const output = graph.output;
        delete graph.output;
        graph.output = output;
      }
      return doc;
    }
    case "remove":
      remove(doc, op.id);
      return doc;
    case "duplicate": {
      const original = nodeById(doc, op.id);
      if (!original) throw new OpError("Nœud introuvable.");
      const graph = ensureGraph(doc);
      const copy = clone(original);
      copy.id = op.copy;
      graph.nodes.push(copy);
      const output = graph.output;
      delete graph.output;
      if (output !== undefined) graph.output = output;
      return doc;
    }
    case "connect":
      connect(doc, op.source, op.target, op.side);
      return doc;
    case "disconnect":
      disconnect(doc, op.source, op.target, op.side);
      return doc;
    case "set_field": {
      const at = location(doc, op.id);
      if (!at) throw new OpError("Nœud introuvable.");
      setAt(doc, [...at, ...op.path], op.value);
      return doc;
    }
    case "set_doc":
      setAt(doc, op.path, op.value);
      if (op.path.length === 2 && isRaw(doc[op.path[0] as string]) && Object.keys(doc[op.path[0] as string] as Raw).length === 0) {
        delete doc[op.path[0] as string];
      }
      return doc;
    case "set_variation": {
      const points = variationPoints(doc).filter((p) => p !== op.id);
      const next = op.on ? [...points, op.id].sort() : points;
      if (next.length > 0) doc.variation_points = next;
      else delete doc.variation_points;
      return doc;
    }
    case "set_output":
      ensureGraph(doc).output = op.id;
      return doc;
    case "override": {
      const overrides = list(doc.overrides).filter((o) => !(isRaw(o) && o.node === op.id));
      doc.overrides = [...overrides, { node: op.id, replace: clone(op.node) }];
      return doc;
    }
    case "remove_override":
      doc.overrides = list(doc.overrides).filter((o) => !(isRaw(o) && o.node === op.id));
      return doc;
    case "replace":
      return clone(op.document);
  }
}

// --- vue du graphe ---------------------------------------------------------------------------

/** Nœuds affichés : le graphe du document, ou le canonique dont les nœuds surchargés sont
 *  remplacés (mode surcharge). */
export function viewNodes(doc: Raw, mode: Mode, canonical: Raw | null): NodeRaw[] {
  if (mode !== "override" || !canonical) return nodesOf(doc);
  const replaced = new Map<string, NodeRaw>();
  for (const override of list(doc.overrides)) {
    if (isRaw(override) && isRaw(override.replace) && typeof override.node === "string") {
      replaced.set(override.node, override.replace as NodeRaw);
    }
  }
  return nodesOf(canonical).map((n) => replaced.get(n.id) ?? n);
}

export const overriddenIds = (doc: Raw): string[] =>
  list(doc.overrides)
    .filter((o): o is Raw => isRaw(o) && isRaw(o.replace) && typeof o.node === "string")
    .map((o) => o.node as string);

export function overrideIndex(doc: Raw, id: string): number {
  return list(doc.overrides).findIndex((o) => isRaw(o) && o.node === id);
}

// --- historique ------------------------------------------------------------------------------

export type Entry = { op: Op; before: Raw; after: Raw };
export type History = { past: Entry[]; future: Entry[] };

export const emptyHistory = (): History => ({ past: [], future: [] });

/** Ajoute une opération. Les frappes successives sur un même champ se fondent en une seule
 *  entrée : annuler revient au champ d'avant la saisie, pas lettre par lettre. */
export function record(history: History, entry: Entry): History {
  const last = history.past[history.past.length - 1];
  const sameField =
    last &&
    last.op.kind === "set_field" &&
    entry.op.kind === "set_field" &&
    last.op.id === entry.op.id &&
    JSON.stringify(last.op.path) === JSON.stringify(entry.op.path) &&
    typeof entry.op.value === "string";
  const sameDoc =
    last &&
    last.op.kind === "set_doc" &&
    entry.op.kind === "set_doc" &&
    JSON.stringify(last.op.path) === JSON.stringify(entry.op.path) &&
    typeof entry.op.value === "string";
  if (sameField || sameDoc) {
    return { past: [...history.past.slice(0, -1), { op: entry.op, before: last.before, after: entry.after }], future: [] };
  }
  return { past: [...history.past, entry], future: [] };
}

export function undo(history: History): { history: History; document: Raw } | null {
  const last = history.past[history.past.length - 1];
  if (!last) return null;
  return { history: { past: history.past.slice(0, -1), future: [last, ...history.future] }, document: last.before };
}

export function redo(history: History): { history: History; document: Raw } | null {
  const next = history.future[0];
  if (!next) return null;
  return { history: { past: [...history.past, next], future: history.future.slice(1) }, document: next.after };
}

// --- disposition -----------------------------------------------------------------------------

export type Positions = Record<string, { x: number; y: number }>;

// Pas de la grille, en unités du canevas : nœud (184 ou 200) plus l'espace des arêtes.
export const COLUMN = 264;
export const ROW = 144;
export const GRID = 24;

/** Disposition automatique : même règle que le graphe en lecture (ADR 0016), couche du
 *  plus long chemin depuis une entrée, rang par identifiant. */
export function autoLayout(nodes: NodeRaw[]): Positions {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const layer = new Map<string, number>();
  const visiting = new Set<string>();
  const depth = (id: string): number => {
    if (layer.has(id)) return layer.get(id)!;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const inputs = inputsOf(byId.get(id) ?? {}).filter((s) => byId.has(s));
    const value = inputs.length === 0 ? 0 : 1 + Math.max(...inputs.map(depth));
    visiting.delete(id);
    layer.set(id, value);
    return value;
  };
  nodes.forEach((n) => depth(n.id));
  const rows = new Map<number, string[]>();
  for (const id of [...byId.keys()].sort()) {
    const l = layer.get(id)!;
    rows.set(l, [...(rows.get(l) ?? []), id]);
  }
  const positions: Positions = {};
  for (const [l, ids] of rows) ids.forEach((id, rank) => (positions[id] = { x: GRID + l * COLUMN, y: GRID + rank * ROW }));
  return positions;
}

export const snap = (positions: Positions): Positions =>
  Object.fromEntries(
    Object.entries(positions).map(([id, p]) => [id, { x: Math.round(p.x / GRID) * GRID, y: Math.round(p.y / GRID) * GRID }]),
  );

/** Place à droite du nœud de référence, ou dans la première colonne libre. */
export function placeNear(positions: Positions, anchor?: string): { x: number; y: number } {
  const taken = Object.values(positions);
  const base = anchor && positions[anchor] ? { x: positions[anchor].x + COLUMN, y: positions[anchor].y } : { x: GRID, y: GRID };
  let candidate = base;
  while (taken.some((p) => Math.abs(p.x - candidate.x) < COLUMN / 2 && Math.abs(p.y - candidate.y) < ROW / 2)) {
    candidate = { x: candidate.x, y: candidate.y + ROW };
  }
  return candidate;
}

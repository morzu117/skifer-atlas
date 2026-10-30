// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  apply,
  autoLayout,
  COLUMN,
  edgesOf,
  emptyHistory,
  GRID,
  nextId,
  nodesOf,
  OpError,
  outputOf,
  overriddenIds,
  record,
  redo,
  ROW,
  undo,
  variationPoints,
  viewNodes,
  type History,
  type Op,
  type Raw,
} from "./model";

const KPI: Raw = { schema_version: 1, kind: "kpi", data_product: { id: "x", version: 1 }, label: "X" };

function run(doc: Raw, ops: Op[]): Raw {
  return ops.reduce(apply, doc);
}

/** n01 source → n02 filtre → n03 calcul, n04 source. */
const chain = () =>
  run(KPI, [
    { kind: "add_node", type: "source", id: "n01" },
    { kind: "add_node", type: "filter", id: "n02" },
    { kind: "connect", source: "n01", target: "n02" },
    { kind: "add_node", type: "compute", id: "n03" },
    { kind: "connect", source: "n02", target: "n03" },
    { kind: "add_node", type: "source", id: "n04" },
  ]);

describe("opérations", () => {
  it("la sortie suit le bout de la chaîne et reste après les nœuds", () => {
    const doc = chain();
    expect(outputOf(doc)).toBe("n03");
    expect(Object.keys(doc.graph as Raw)).toEqual(["nodes", "output"]);
    expect(edgesOf(nodesOf(doc))).toEqual([
      { source: "n01", target: "n02" },
      { source: "n02", target: "n03" },
    ]);
  });

  it("refuse une arête vers une entrée, vers soi-même ou qui crée un cycle (critère 3)", () => {
    const doc = chain();
    expect(() => apply(doc, { kind: "connect", source: "n03", target: "n01" })).toThrow("n01 est une entrée du graphe");
    expect(() => apply(doc, { kind: "connect", source: "n02", target: "n02" })).toThrow(OpError);
    expect(() => apply(doc, { kind: "connect", source: "n03", target: "n02" })).toThrow(
      "Arête refusée : elle créerait un cycle n02 → n03 → n02.",
    );
  });

  it("une jointure se remplit à gauche puis à droite ; une union accumule", () => {
    let doc = run(chain(), [
      { kind: "add_node", type: "join", id: "n05" },
      { kind: "connect", source: "n03", target: "n05" },
      { kind: "connect", source: "n04", target: "n05" },
    ]);
    expect(nodesOf(doc).find((n) => n.id === "n05")?.inputs).toEqual({ left: "n03", right: "n04" });
    doc = apply(doc, { kind: "disconnect", source: "n03", target: "n05", side: "left" });
    expect(nodesOf(doc).find((n) => n.id === "n05")?.inputs).toEqual({ right: "n04" });
    doc = run(doc, [
      { kind: "add_node", type: "union", id: "n06" },
      { kind: "connect", source: "n03", target: "n06" },
      { kind: "connect", source: "n04", target: "n06" },
      { kind: "connect", source: "n04", target: "n06" },
    ]);
    expect(nodesOf(doc).find((n) => n.id === "n06")?.inputs).toEqual(["n03", "n04"]);
  });

  it("supprimer un nœud nettoie entrées, points de variation et sortie", () => {
    let doc = apply(chain(), { kind: "set_variation", id: "n03", on: true });
    expect(variationPoints(doc)).toEqual(["n03"]);
    doc = apply(doc, { kind: "remove", id: "n03" });
    expect(doc.variation_points).toBeUndefined();
    expect(outputOf(doc)).toBe("n04");
    doc = apply(doc, { kind: "remove", id: "n01" });
    expect(nodesOf(doc).find((n) => n.id === "n02")?.inputs).toBeUndefined();
  });

  it("set_doc retire un mapping devenu vide", () => {
    const doc = apply({ ...KPI, semantics: { currency: "EUR" } }, { kind: "set_doc", path: ["semantics", "currency"], value: undefined });
    expect(doc.semantics).toBeUndefined();
  });

  it("n'altère jamais le document d'origine", () => {
    const doc = chain();
    const copy = structuredClone(doc);
    apply(doc, { kind: "set_field", id: "n02", path: ["nulls"], value: "drop" });
    expect(doc).toEqual(copy);
  });
});

describe("identifiants", () => {
  it("le suivant du plus grand jamais attribué, même supprimé (ADR 0017)", () => {
    const doc = apply(chain(), { kind: "remove", id: "n04" });
    expect(nextId(doc, 4)).toEqual({ id: "n05", highest: 5 });
    // Un n09 des versions taguées n'est jamais réattribué.
    expect(nextId(doc, 9).id).toBe("n10");
    expect(nextId(KPI, 0).id).toBe("n01");
  });
});

describe("historique", () => {
  it("20 opérations annulées puis rétablies redonnent des documents identiques (critère 5)", () => {
    const ops: Op[] = [
      { kind: "add_node", type: "source", id: "n01" },
      { kind: "set_field", id: "n01", path: ["platform"], value: "databricks" },
      { kind: "set_field", id: "n01", path: ["table"], value: "gold.finance.t" },
      { kind: "set_field", id: "n01", path: ["owner"], value: "claire.m" },
      { kind: "set_field", id: "n01", path: ["columns"], value: [{ name: "a", type: "string" }] },
      { kind: "add_node", type: "filter", id: "n02" },
      { kind: "connect", source: "n01", target: "n02" },
      { kind: "set_field", id: "n02", path: ["condition"], value: "a:equals:1" },
      { kind: "set_field", id: "n02", path: ["nulls"], value: "drop" },
      { kind: "add_node", type: "aggregate", id: "n03" },
      { kind: "connect", source: "n02", target: "n03" },
      { kind: "set_field", id: "n03", path: ["measures"], value: [["*", "n", "count"]] },
      { kind: "set_variation", id: "n02", on: true },
      { kind: "duplicate", id: "n02", copy: "n04" },
      { kind: "remove", id: "n04" },
      { kind: "set_doc", path: ["label"], value: "Y" },
      { kind: "set_doc", path: ["semantics", "timezone"], value: "Europe/Paris" },
      { kind: "disconnect", source: "n02", target: "n03" },
      { kind: "connect", source: "n02", target: "n03" },
      { kind: "set_output", id: "n03" },
    ];
    expect(ops).toHaveLength(20);
    let history: History = emptyHistory();
    let doc = KPI;
    const states = [doc];
    for (const op of ops) {
      const after = apply(doc, op);
      history = record(history, { op, before: doc, after });
      doc = after;
      states.push(doc);
    }
    expect(history.past).toHaveLength(20);
    for (let i = 19; i >= 0; i--) {
      const step = undo(history)!;
      history = step.history;
      expect(step.document).toEqual(states[i]);
    }
    expect(undo(history)).toBeNull();
    for (let i = 1; i <= 20; i++) {
      const step = redo(history)!;
      history = step.history;
      expect(step.document).toEqual(states[i]);
    }
    expect(redo(history)).toBeNull();
  });

  it("les frappes sur un même champ forment une seule entrée", () => {
    let history = emptyHistory();
    let doc = apply(KPI, { kind: "add_node", type: "filter", id: "n01" });
    const start = doc;
    for (const value of ["s", "st", "sta"]) {
      const op: Op = { kind: "set_field", id: "n01", path: ["label"], value };
      const after = apply(doc, op);
      history = record(history, { op, before: doc, after });
      doc = after;
    }
    expect(history.past).toHaveLength(1);
    expect(undo(history)!.document).toEqual(start);
  });

  it("une nouvelle opération vide la pile de rétablissement", () => {
    const op: Op = { kind: "set_doc", path: ["label"], value: "A" };
    let history = record(emptyHistory(), { op, before: KPI, after: apply(KPI, op) });
    history = undo(history)!.history;
    expect(history.future).toHaveLength(1);
    const other: Op = { kind: "set_variation", id: "n01", on: true };
    history = record(history, { op: other, before: KPI, after: apply(KPI, other) });
    expect(history.future).toHaveLength(0);
  });
});

describe("surcharge", () => {
  const canonical = run(chain(), [{ kind: "set_variation", id: "n03", on: true }]);
  const variant: Raw = { kind: "variant", mode: "override" };

  it("remplace un nœud du canonique et l'affiche à sa place", () => {
    const replaced = { ...nodesOf(canonical)[1], condition: "a:equals:2" };
    let doc = apply(variant, { kind: "override", id: "n02", node: replaced });
    expect(overriddenIds(doc)).toEqual(["n02"]);
    doc = apply(doc, { kind: "set_field", id: "n02", path: ["nulls"], value: "keep" });
    const view = viewNodes(doc, "override", canonical);
    expect(view.map((n) => n.id)).toEqual(["n01", "n02", "n03", "n04"]);
    expect(view[1]).toMatchObject({ condition: "a:equals:2", nulls: "keep" });
    doc = apply(doc, { kind: "remove_override", id: "n02" });
    expect(overriddenIds(doc)).toEqual([]);
  });
});

describe("disposition", () => {
  it("couche du plus long chemin, rang par identifiant, sur la trame", () => {
    const positions = autoLayout(nodesOf(chain()));
    expect(positions.n01).toEqual({ x: GRID, y: GRID });
    expect(positions.n04).toEqual({ x: GRID, y: GRID + ROW });
    expect(positions.n03).toEqual({ x: GRID + 2 * COLUMN, y: GRID });
  });
});

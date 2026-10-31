export type Raw = Record<string, unknown> & { graph: { nodes: { id: string }[]; output: string } };

/** Revenu net, réduit à sa source suivie d'une chaîne de calculs et d'une agrégation,
 * comme le graphe de 50 nœuds du plan 0013 (`_long_kpi`). */
export function longKpi(document: Raw, count: number): Raw {
  const source = document.graph.nodes.find((node) => node.id === "n01")!;
  const nodes: (Record<string, unknown> & { id: string })[] = [source];
  const id = (index: number) => `n${String(index).padStart(2, "0")}`;
  for (let index = 2; index < count; index++) {
    nodes.push({ id: id(index), type: "compute", inputs: [id(index - 1)], column: `c${index}`, expr: "montant_ttc - montant_taxes", column_type: "decimal" });
  }
  nodes.push({ id: id(count), type: "aggregate", inputs: [id(count - 1)], group_by: ["entite"], measures: [[`c${count - 1}`, "total", "sum"]] });
  const { variation_points: _, ...rest } = document;
  return { ...rest, graph: { nodes, output: id(count) } };
}


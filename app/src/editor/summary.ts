import { inputsOf, type NodeRaw, type Raw } from "./model";

// Texte d'un nœud en édition (guide 4) : l'expression en mono, puis une ligne de
// métadonnées. Le nœud peut être incomplet : chaque champ manquant est simplement omis.

const OPERATORS: Record<string, string> = {
  equals: "=",
  not_equals: "≠",
  greater_than: ">",
  less_than: "<",
  greater_than_equal: "≥",
  less_than_equal: "≤",
  in: "dans",
  not_in: "hors de",
  between: "entre",
  not_between: "hors de",
  is_null: "est nul",
  is_not_null: "n'est pas nul",
  contains: "contient",
  not_contains: "ne contient pas",
  starts_with: "commence par",
  ends_with: "finit par",
  like: "comme",
  not_like: "pas comme",
};

export const GRAINS: Record<string, string> = {
  day: "jour",
  week: "semaine",
  month: "mois",
  quarter: "trimestre",
  year: "année",
};

const text = (value: unknown) => (typeof value === "string" ? value : "");
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const isRaw = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value);

export function conditionText(condition: unknown): string {
  if (isRaw(condition)) return text(condition.expr);
  const [column, operator, value] = text(condition).split(":", 3);
  if (!operator) return text(condition);
  return [column, OPERATORS[operator] ?? operator, value?.split(",").join(", ")].filter(Boolean).join(" ");
}

const measures = (value: unknown) =>
  list(value)
    .filter(Array.isArray)
    .map((m) => `${text(m[2]).toUpperCase()}(${text(m[0])})`)
    .join(", ");

export function summary(node: NodeRaw): { main: string; meta: string } {
  switch (node.type) {
    case "source": {
      const columns = list(node.columns).filter(isRaw);
      const dated = columns.find((c) => c.type === "date" || c.type === "timestamp");
      const table = text(node.table);
      return {
        main: table.split(".").pop() || "table ?",
        meta: [table.split(".").slice(0, -1).join("."), columns.length ? `${columns.length} col.` : "", dated ? `${text(dated.name)} · ${text(dated.timezone)}` : ""]
          .filter(Boolean)
          .join(" · "),
      };
    }
    case "filter":
      return {
        main: conditionText(node.condition) || "condition ?",
        meta: node.nulls === "keep" ? "nulls : gardés" : node.nulls === "drop" ? "nulls : exclus" : "nulls : ?",
      };
    case "join": {
      const keys = list(node.keys)
        .filter(Array.isArray)
        .map((k) => `${text(k[0])} = ${text(k[1])}`)
        .join(", ");
      return {
        main: keys || text(node.how) || "clés ?",
        meta: [text(node.how), text(node.cardinality), node.check === "bypass" ? "contrôle contourné" : node.check ? "contrôle requis" : ""]
          .filter(Boolean)
          .join(" · "),
      };
    }
    case "union":
      return { main: node.mode === "distinct" ? "UNION DISTINCT" : "UNION ALL", meta: `${inputsOf(node).length} entrées` };
    case "compute":
      return { main: text(node.column) || "colonne ?", meta: node.expr ? `= ${text(node.expr)}` : "" };
    case "deduplicate":
      return { main: list(node.keys).map(text).join(", ") || "clés ?", meta: "une ligne gardée par clé" };
    case "aggregate":
      return {
        main: measures(node.measures) || "mesures ?",
        meta: list(node.group_by).length ? `par ${list(node.group_by).map(text).join(", ")}` : "",
      };
    case "temporal": {
      const detail =
        node.operation === "period"
          ? `${GRAINS[text(node.grain)] ?? text(node.grain)} de ${text(node.column)}`
          : node.operation === "to_date"
            ? `date de ${text(node.column)} · ${text(node.timezone)}`
            : node.operation === "convert_timezone"
              ? `${text(node.column)} → ${text(node.to)}`
              : node.operation === "window"
                ? `${text(node.function)} sur ${text(node.frame)}`
                : "opération ?";
      return { main: text(node.target) || "cible ?", meta: detail };
    }
    case "kpi_ref":
      return { main: text(node.kpi) || "KPI ?", meta: typeof node.version === "number" ? `v${node.version}` : "" };
    case "metric_op":
      return {
        main: list(node.metrics).filter(isRaw).map((m) => text(m.name)).join(", ") || "métriques ?",
        meta: node.order === "rows_first" ? "lignes d'abord" : node.order === "aggregate_first" ? "agrégation d'abord" : "",
      };
    default:
      // Type inconnu : la validation le signale ; la carte reste lisible.
      return { main: text(node.type) || "type ?", meta: "type inconnu" };
  }
}

// Les deux premiers deux-points séparent la colonne et l'opérateur ; le reste est la valeur.
export function parseCondition(condition: unknown): { column: string; operator: string; value: string } {
  const parts = (typeof condition === "string" ? condition : "").split(":");
  const column = parts.shift() ?? "";
  const operator = parts.shift() ?? "";
  return { column, operator, value: parts.join(":") };
}

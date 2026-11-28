// Seuils de couleur de la matrice des comparaisons (plan 0015, ADR 0019), à part de l'écran :
// le parcours Playwright sur un vrai Databricks (ADR 0075) les lit sans charger l'interface.

/** Seuils de couleur de la matrice, en % de cellules dans la tolérance (plan 0015, à valider). */
export const PASS_THRESHOLD = 99;
export const WARN_THRESHOLD = 90;

/** Teinte d'une cellule de la matrice d'après son % de validation. */
export function tone(validation: number | null | undefined): "pass" | "warn" | "bad" {
  if (validation === null || validation === undefined) return "bad";
  if (validation >= PASS_THRESHOLD) return "pass";
  return validation >= WARN_THRESHOLD ? "warn" : "bad";
}

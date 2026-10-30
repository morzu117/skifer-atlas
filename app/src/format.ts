/** « Groupe Nordis » → GN ; « Acme » → AC ; « julien.h » → JH. */
export function initials(name: string): string {
  const words = name.split(/[\s._-]+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

/** 1 entité, 3 entités ; 0 concept. */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count > 1 ? pluralForm : singular}`;
}

/** Identifiant d'espace dérivé du nom : minuscules, sans accents, tirets (motif de l'API). */
export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/, "");
}

export const WORKSPACE_ID = /^[a-z0-9][a-z0-9-]{1,63}$/;

export type Tone = "ok" | "warn" | "bad" | "none";

/** Pastille et libellé de convergence (guide 3.4) ; null pour un concept. */
export function convergence(value: string | null): { tone: Tone; label: string } | null {
  if (value === null) return null;
  const [kind, count] = value.split(":");
  const n = Number(count);
  if (kind === "converged") return { tone: "ok", label: "Convergé" };
  if (kind === "candidates") return { tone: "warn", label: plural(n, "candidate") };
  if (kind === "divergences") return { tone: "bad", label: plural(n, "divergence") };
  return { tone: "none", label: "Jamais comparé" };
}

export const STATUS_LABELS: Record<string, string> = {
  validated: "Validé",
  draft: "Brouillon",
  needs_curation: "À curer",
  invalid: "Invalide",
};

export const KIND_LABELS: Record<string, string> = { concept: "Concept", kpi: "KPI" };

/** 93.75 → « 93 % » : arrondi vers le bas, 100 % n'est affiché que s'il est atteint. */
export function percent(value: number): string {
  return `${Math.floor(value)} %`;
}

/** Horodatage UTC du serveur (sans fuseau) → « il y a 3 j ». */
export function ago(timestamp: string, now: Date = new Date()): string {
  const utc = /Z|[+-]\d\d:?\d\d$/.test(timestamp) ? timestamp : `${timestamp}Z`;
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(utc).getTime()) / 60000));
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  if (minutes < 60 * 24) return `il y a ${Math.floor(minutes / 60)} h`;
  return `il y a ${Math.floor(minutes / (60 * 24))} j`;
}

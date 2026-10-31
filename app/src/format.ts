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

/** Badge de nature d'une proposition (guide 10.4) : orange plein hors points déclarés,
 * orange bordé pour une variante from scratch, pâle sinon. */
export const NATURES: Record<string, { label: string; tone: string }> = {
  new_version: { label: "Nouvelle version", tone: "badge-pale" },
  declared_point: { label: "Point déclaré", tone: "badge-pale" },
  undeclared: { label: "Hors points déclarés", tone: "badge-warn-solid" },
  from_scratch: { label: "From scratch", tone: "badge-warn" },
  governance: { label: "Gouvernance", tone: "badge-pale" },
  access_points: { label: "Point d'accès", tone: "badge-pale" },
};

export const KIND_LABELS: Record<string, string> = { concept: "Concept", kpi: "KPI" };

/** 93.75 → « 94 % » : arrondi au plus proche, mais 100 % n'est affiché que s'il est
 * atteint (99.9 → « 99 % »). */
export function percent(value: number): string {
  return `${value < 100 ? Math.min(Math.round(value), 99) : Math.round(value)} %`;
}

const DECIMAL = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const AMOUNT = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });

/** Écart signé, arrondi à l'affichage seulement : 6.1001 → « +6,1 % ». */
export function gap(value: number, signed = true): string {
  const text = DECIMAL.format(Math.abs(value));
  return `${signed ? (value > 0 ? "+" : value < 0 ? "−" : "") : ""}${text} %`;
}

/** Valeur restituée (locale fr) : 4410720 → « 4 410 720 », 12.3456 → « 12,35 ». */
export function amount(value: number): string {
  return AMOUNT.format(value);
}

const MONTH = new Intl.DateTimeFormat("fr-FR", { month: "short", year: "numeric", timeZone: "UTC" });

/** Valeur de dimension : un premier du mois devient « sept. 2026 », le reste est tel quel. */
export function dimension(value: unknown): string {
  if (value === null || value === undefined) return "—";
  const text = String(value);
  const month = /^(\d{4})-(\d{2})(?:-01)?$/.exec(text);
  if (month) {
    const label = MONTH.format(new Date(Date.UTC(Number(month[1]), Number(month[2]) - 1, 1)));
    return label.charAt(0).toUpperCase() + label.slice(1);
  }
  return text;
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

const MONTHS = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** Date du commit, telle qu'écrite : « 2026-10-12T09:00:00+02:00 » → « 12 oct. 2026 ». */
export function longDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  return MONTHS.format(new Date(Date.UTC(year, month - 1, day)));
}

/** 1.5 → « 1,5 % ». */
export function tolerance(value: number): string {
  return `${String(value).replace(".", ",")} %`;
}

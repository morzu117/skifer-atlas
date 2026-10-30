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

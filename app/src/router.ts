import { useEffect, useRef, useState } from "react";

// Routage par hash, sans serveur : `#/` (accueil), `#/w/<espace>/<vue>?<paramètres>`,
// `#/w/<espace>/fiche/<document>?<paramètres>` et `#/w/<espace>/editeur?<paramètres>`.

export const VIEWS = ["catalogue", "propositions", "comparaison", "connexions", "administration"] as const;
export type NavView = (typeof VIEWS)[number];
export type View = NavView | "fiche" | "editeur";

export type Params = Record<string, string>;

export type Route =
  | { name: "home" }
  | { name: "workspace"; ws: string; view: View; params: Params; doc?: string };

export function parse(hash: string): Route {
  const [path, search = ""] = hash.replace(/^#\/?/, "").split("?", 2);
  let parts: string[];
  try {
    parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    // Séquence % invalide (adresse collée, tronquée) : l'accueil, plutôt qu'un écran blanc.
    return { name: "home" };
  }
  if (parts[0] !== "w" || !parts[1]) return { name: "home" };
  const params = Object.fromEntries(new URLSearchParams(search));
  const ws = parts[1];
  if (parts[2] === "fiche" && parts[3]) return { name: "workspace", ws, view: "fiche", params, doc: parts[3] };
  if (parts[2] === "editeur") return { name: "workspace", ws, view: "editeur", params };
  const view = (VIEWS as readonly string[]).includes(parts[2]) ? (parts[2] as NavView) : "catalogue";
  return { name: "workspace", ws, view, params };
}

function query(params: Params = {}): string {
  const kept = Object.entries(params).filter(([, value]) => value !== "");
  return kept.length > 0 ? `?${new URLSearchParams(kept)}` : "";
}

export const href = {
  home: () => "#/",
  view: (ws: string, view: NavView = "catalogue", params?: Params) =>
    `#/w/${encodeURIComponent(ws)}/${view}${query(params)}`,
  document: (ws: string, id: string, params?: Params) =>
    `#/w/${encodeURIComponent(ws)}/fiche/${encodeURIComponent(id)}${query(params)}`,
  editor: (ws: string, params?: Params) => `#/w/${encodeURIComponent(ws)}/editeur${query(params)}`,
};

function hrefOf(route: Extract<Route, { name: "workspace" }>, params: Params): string {
  if (route.view === "fiche" && route.doc) return href.document(route.ws, route.doc, params);
  if (route.view === "editeur") return href.editor(route.ws, params);
  return href.view(route.ws, route.view as NavView, params);
}

// Garde de sortie (ADR 0043) : un écran qui porte un travail non enregistré s'y inscrit avec
// `useLeaveGuard`. Les liens `#/…` sont arrêtés au clic, `navigate` au passage ; la fermeture
// de la fenêtre garde son propre avertissement. Le retour arrière du navigateur n'est pas
// retenu : le hash a déjà changé quand `hashchange` arrive.
let leaveGuard: ((to: string) => boolean) | null = null;

export function navigate(to: string) {
  if (leaveGuard && !leaveGuard(to)) return;
  window.location.hash = to;
}

const pathOf = (hash: string) => hash.replace(/^#\/?/, "").split("?", 1)[0];

/** Retient la sortie de l'écran tant que `dirty` : `onBlocked` reçoit l'adresse visée et le lien
 * cliqué (pour lui rendre le focus). Rend la fonction qui quitte pour de bon, une fois confirmé. */
export function useLeaveGuard(
  dirty: boolean,
  onBlocked: (to: string, origin: HTMLElement | null) => void,
): (to: string) => void {
  // Lue à chaque événement : le garde est posé une fois, sans se réinscrire à chaque frappe.
  const latest = useRef({ dirty, onBlocked });
  latest.current = { dirty, onBlocked };
  useEffect(() => {
    // Une autre vue, pas un autre paramètre de la même : l'écran reste monté dans ce cas.
    const leaves = (to: string) => latest.current.dirty && pathOf(to) !== pathOf(window.location.hash);
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href^="#/"]') : null;
      const to = link?.getAttribute("href");
      if (!link || !to || !leaves(to)) return;
      event.preventDefault();
      latest.current.onBlocked(to, link);
    };
    const onUnload = (event: BeforeUnloadEvent) => {
      if (latest.current.dirty) event.preventDefault();
    };
    const guard = (to: string) => {
      if (!leaves(to)) return true;
      latest.current.onBlocked(to, null);
      return false;
    };
    leaveGuard = guard;
    document.addEventListener("click", onClick, true);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      if (leaveGuard === guard) leaveGuard = null;
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, []);
  return (to) => {
    window.location.hash = to;
  };
}

/** Remplace l'entrée courante de l'historique : la recherche à la frappe ne l'encombre pas. */
export function replace(to: string) {
  window.history.replaceState(window.history.state, "", to);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

/** Modifie des paramètres de la vue courante, lus au moment de l'appel. */
export function setParams(change: Params, { push }: { push: boolean }) {
  const route = parse(window.location.hash);
  if (route.name !== "workspace") return;
  const to = hrefOf(route, { ...route.params, ...change });
  if (to === window.location.hash) return;
  if (push) navigate(to);
  else replace(to);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(window.location.hash));
  useEffect(() => {
    const update = () => setRoute(parse(window.location.hash));
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  return route;
}

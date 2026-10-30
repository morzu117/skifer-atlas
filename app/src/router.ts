import { useEffect, useState } from "react";

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
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
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

export function navigate(to: string) {
  window.location.hash = to;
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

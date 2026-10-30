import { useEffect, useState } from "react";

// Routage par hash, sans serveur : `#/` (accueil), `#/w/<espace>/<vue>`.

export const VIEWS = ["catalogue", "propositions", "comparaison", "connexions", "administration"] as const;
export type View = (typeof VIEWS)[number];

export type Route = { name: "home" } | { name: "workspace"; ws: string; view: View };

export function parse(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] === "w" && parts[1]) {
    const view = (VIEWS as readonly string[]).includes(parts[2]) ? (parts[2] as View) : "catalogue";
    return { name: "workspace", ws: parts[1], view };
  }
  return { name: "home" };
}

export const href = {
  home: () => "#/",
  view: (ws: string, view: View = "catalogue") => `#/w/${encodeURIComponent(ws)}/${view}`,
};

export function navigate(to: string) {
  window.location.hash = to;
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

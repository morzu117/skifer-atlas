import { useEffect, useRef, useState } from "react";
import { api, UnreachableError, type Workspace } from "../api";
import { Banner } from "../components/Banner";
import { Brand } from "../components/Brand";
import { Icon, type IconName } from "../components/Icon";
import { initials } from "../format";
import { explain, type Explained } from "../messages";
import { href, navigate, type NavView, type Params, type View } from "../router";
import { Catalogue } from "./Catalogue";

type Item = { view: NavView; label: string; plan: string };

const NAV: Item[] = [
  { view: "catalogue", label: "Catalogue", plan: "0011" },
  { view: "propositions", label: "Propositions", plan: "0014" },
  { view: "comparaison", label: "Comparaison", plan: "0015" },
  { view: "connexions", label: "Connexions", plan: "0016" },
  { view: "administration", label: "Administration", plan: "0017" },
];

type Load = { kind: "loading" } | { kind: "ready"; ws: Workspace } | { kind: "error"; error: Explained }
  | { kind: "offline" }; // le bandeau global du serveur injoignable suffit

// Écrans hors navigation, encore à venir : ils restent sous l'élément Catalogue.
const PAGES: Record<"fiche" | "editeur", { label: string; plan: string }> = {
  fiche: { label: "Fiche", plan: "0012" },
  editeur: { label: "Nouveau concept ou KPI", plan: "0013" },
};

// Coque d'un espace (guide 3.1) : barre latérale, sélecteur, navigation selon le rôle.
export function WorkspaceShell({
  wsId,
  view,
  params = {},
  doc,
  onUnknown,
}: {
  wsId: string;
  view: View;
  params?: Params;
  doc?: string;
  onUnknown: (id: string) => void;
}) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [waiting, setWaiting] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoad({ kind: "loading" });
    api
      .workspaces()
      .then((list) => {
        if (!alive) return;
        const ws = list.find((w) => w.id === wsId);
        if (ws) setLoad({ kind: "ready", ws });
        else onUnknown(wsId);
      })
      .catch((error) => {
        if (!alive) return;
        setLoad(error instanceof UnreachableError ? { kind: "offline" } : { kind: "error", error: explain(error) });
      });
    return () => {
      alive = false;
    };
  }, [wsId, onUnknown]);

  useEffect(() => {
    let alive = true;
    setWaiting(0);
    // Masqué tant qu'on ne sait pas, et si l'hébergeur ne répond pas.
    api
      .proposalsForMe(wsId)
      .then((found) => alive && setWaiting(found.length))
      .catch(() => alive && setWaiting(0));
    return () => {
      alive = false;
    };
  }, [wsId]);

  const ws = load.kind === "ready" ? load.ws : null;
  const referent = ws?.role === "referent";

  useEffect(() => {
    if (ws && view === "administration" && !referent) navigate(href.view(ws.id));
    if (ws && view === "editeur" && ws.role === "lecteur") navigate(href.view(ws.id));
  }, [ws, view, referent]);

  // Changement de vue : le focus va au titre, comme un chargement de page pour un lecteur
  // d'écran ; Tab repart de là.
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (ws) heading.current?.focus();
  }, [ws, view, doc]);

  const items = NAV.filter((item) => item.view !== "administration" || referent);
  const active = view === "fiche" || view === "editeur" ? "catalogue" : view;
  const current = view === "fiche" || view === "editeur" ? PAGES[view] : (NAV.find((item) => item.view === view) ?? NAV[0]);

  return (
    <div className="shell">
      <aside className="sidebar">
        <Brand compact />
        <a className="switcher" href={href.home()}>
          <span className="switcher-text">
            <span className="switcher-label">Espace</span>
            <span className="switcher-name">{ws?.name ?? wsId}</span>
          </span>
          <Icon name="switcher" className="icon-sm" />
        </a>
        <nav aria-label="Navigation de l'espace">
          <ul className="nav">
            {(ws ? items : []).map((item) => (
              <li key={item.view}>
                <a
                  className="nav-item"
                  href={href.view(wsId, item.view)}
                  aria-current={item.view === active ? "page" : undefined}
                >
                  <span className="nav-label">
                    <Icon name={item.view as IconName} />
                    {item.label}
                  </span>
                  {item.view === "propositions" && waiting > 0 && (
                    <span className="nav-count">
                      {waiting}
                      <span className="sr-only"> en attente de votre revue</span>
                    </span>
                  )}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        {ws && (
          <div className="sidebar-user">
            <span className="avatar-round">{initials(ws.account || "?")}</span>
            <span className="sidebar-user-text">
              <span className="sidebar-user-name">{ws.account}</span>
              <span className="sidebar-user-role">{ws.role_label}</span>
            </span>
          </div>
        )}
      </aside>

      <main className="main">
        {load.kind === "loading" && (
          <p className="muted" role="status">
            Chargement de l'espace…
          </p>
        )}
        {load.kind === "error" && (
          <Banner tone="bad" title={load.error.title}>
            {load.error.text}
          </Banner>
        )}
        {ws && view === "catalogue" && <Catalogue ws={ws} params={params} heading={heading} />}
        {ws && view !== "catalogue" && (
          <>
            <div className="main-head">
              <h1 ref={heading} tabIndex={-1}>
                {current.label}
              </h1>
            </div>
            <div className="placeholder">
              Cet écran arrive avec le plan {current.plan}.{" "}
              {view === "fiche" && (
                <>
                  Document : <span className="mono">{doc}</span>.{" "}
                  <a href={href.view(ws.id)}>Retour au catalogue</a>
                </>
              )}
              {view === "editeur" && <>Le domaine du document se choisira à la création.</>}
              {view !== "fiche" && view !== "editeur" && (
                <>
                  L'espace <strong>{ws.name}</strong> est ouvert : la navigation et le sélecteur d'espace sont en place.
                </>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

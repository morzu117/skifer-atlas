import { useEffect, useRef, useState } from "react";
import { api, UnreachableError, type Workspace } from "../api";
import { Banner } from "../components/Banner";
import { Brand } from "../components/Brand";
import { Icon, type IconName } from "../components/Icon";
import { initials } from "../format";
import { explain, type Explained } from "../messages";
import { href, navigate, type NavView, type Params, type View } from "../router";
import { Administration } from "./Administration";
import { Catalogue } from "./Catalogue";
import { Comparison } from "./Comparison";
import { Connections } from "./Connections";
import { Editor } from "./Editor";
import { Fiche } from "./Fiche";
import { Proposals, PROPOSALS_CHANGED } from "./Proposals";

type Item = { view: NavView; label: string };

const NAV: Item[] = [
  { view: "catalogue", label: "Catalogue" },
  { view: "propositions", label: "Propositions" },
  { view: "comparaison", label: "Comparaison" },
  { view: "connexions", label: "Connexions" },
  { view: "administration", label: "Administration" },
];

type Load = { kind: "loading" } | { kind: "ready"; ws: Workspace } | { kind: "error"; error: Explained }
  | { kind: "offline" }; // le bandeau global du serveur injoignable suffit

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
    // Masqué tant qu'on ne sait pas, et si l'hébergeur ne répond pas. Relu après une
    // revue ou une fusion depuis l'écran des propositions.
    const refresh = () =>
      api
        .proposalsForMe(wsId)
        .then((found) => alive && setWaiting(found.length))
        .catch(() => alive && setWaiting(0));
    void refresh();
    window.addEventListener(PROPOSALS_CHANGED, refresh);
    return () => {
      alive = false;
      window.removeEventListener(PROPOSALS_CHANGED, refresh);
    };
  }, [wsId]);

  const ws = load.kind === "ready" ? load.ws : null;
  // Un référent de domaine n'administre pas l'espace : seul un référent d'espace (0017).
  const referent = ws?.space_referent === true;

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
  // La fiche et l'éditeur, hors navigation, restent sous l'élément Catalogue.
  const active = view === "fiche" || view === "editeur" ? "catalogue" : view;

  // L'éditeur occupe tout l'écran, sans barre latérale (guide 3.1) : retour vers la fiche.
  if (view === "editeur") {
    return (
      <div className="editor-shell">
        {load.kind === "loading" && (
          <p className="muted editor-loading" role="status">
            Chargement de l'espace…
          </p>
        )}
        {load.kind === "error" && (
          <Banner tone="bad" title={load.error.title}>
            {load.error.text}
          </Banner>
        )}
        {ws && <Editor ws={ws} params={params} heading={heading} />}
      </div>
    );
  }

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
        {ws && view === "fiche" && doc && <Fiche ws={ws} id={doc} params={params} heading={heading} />}
        {ws && view === "propositions" && <Proposals ws={ws} params={params} heading={heading} />}
        {ws && view === "comparaison" && <Comparison ws={ws} params={params} heading={heading} />}
        {ws && view === "connexions" && <Connections ws={ws} heading={heading} />}
        {ws && view === "administration" && <Administration ws={ws} heading={heading} />}
      </main>
    </div>
  );
}

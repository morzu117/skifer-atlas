import { useCallback, useEffect, useRef, useState } from "react";
import { api, UnreachableError, type Workspace } from "../api";
import { Banner } from "../components/Banner";
import { Brand } from "../components/Brand";
import { Icon } from "../components/Icon";
import { initials, plural } from "../format";
import { explain, type Explained } from "../messages";
import { href, navigate } from "../router";
import { CreateWorkspace } from "./CreateWorkspace";
import { JoinWorkspace } from "./JoinWorkspace";

type Load = { kind: "loading" } | { kind: "ready"; workspaces: Workspace[] } | { kind: "error"; error: Explained }
  | { kind: "offline" }; // le bandeau global du serveur injoignable suffit

// Accueil des espaces (10.0) : sans barre latérale, une carte par espace du registre local.
export function Home({ notice, onDismissNotice }: { notice: string | null; onDismissNotice: () => void }) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [panel, setPanel] = useState<"create" | "join" | null>(null);

  const reload = useCallback(() => {
    setLoad({ kind: "loading" });
    api
      .workspaces()
      .then((workspaces) => setLoad({ kind: "ready", workspaces }))
      .catch((error) =>
        setLoad(error instanceof UnreachableError ? { kind: "offline" } : { kind: "error", error: explain(error) }),
      );
  }, []);

  useEffect(reload, [reload]);

  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);

  const open = (ws: Workspace) => navigate(href.view(ws.id));
  const account = load.kind === "ready" ? load.workspaces.find((w) => w.account)?.account : undefined;

  return (
    <div className="home">
      <header className="home-header">
        <Brand />
        {account && (
          <div className="user">
            <span className="avatar-round">{initials(account)}</span>
            <span>{account}</span>
          </div>
        )}
      </header>

      <main className="home-main">
        <div className="page-head">
          <div className="page-intro">
            <h1 ref={heading} tabIndex={-1}>
              Vos espaces de travail
            </h1>
            <p className="lead">
              Un espace par client. Chaque espace a son dépôt Git, ses utilisateurs, sa gouvernance et ses
              connexions : rien ne traverse d'un espace à l'autre.
            </p>
          </div>
          <div className="actions">
            <button type="button" className="btn btn-secondary" onClick={() => setPanel("join")}>
              <Icon name="link" className="icon-sm" />
              Rejoindre un espace
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setPanel("create")}>
              <Icon name="plus" className="icon-sm" />
              Créer un espace
            </button>
          </div>
        </div>

        {notice && (
          <Banner
            tone="info"
            title={notice}
            action={
              <button type="button" className="btn btn-neutral btn-dense" onClick={onDismissNotice}>
                Fermer
              </button>
            }
          >
            Choisissez un espace ci-dessous.
          </Banner>
        )}

        {load.kind === "loading" && (
          <p className="muted" role="status">
            Chargement des espaces…
          </p>
        )}
        {load.kind === "error" && (
          <Banner
            tone="bad"
            title={load.error.title}
            action={
              <button type="button" className="btn btn-neutral btn-dense" onClick={reload}>
                Réessayer
              </button>
            }
          >
            {load.error.text}
          </Banner>
        )}
        {load.kind === "ready" &&
          (load.workspaces.length === 0 ? (
            <div className="empty-card">
              <strong>Aucun espace pour l'instant</strong>
              <span className="muted">
                Créez le premier espace, ou rejoignez celui d'un client par l'adresse de son dépôt Git.
              </span>
            </div>
          ) : (
            <ul className="ws-grid" aria-label="Espaces">
              {load.workspaces.map((ws) => (
                <li key={ws.id}>
                  <WorkspaceCard ws={ws} />
                </li>
              ))}
            </ul>
          ))}

        <div className="note">
          <Icon name="lock" className="icon note-icon" />
          <span>
            Vos tokens d'accès sont stockés chiffrés sur cette machine, rangés par espace. Ils ne quittent jamais
            votre poste.
          </span>
        </div>
      </main>

      {panel === "create" && <CreateWorkspace onClose={() => setPanel(null)} onCreated={open} />}
      {panel === "join" && <JoinWorkspace onClose={() => setPanel(null)} onJoined={open} />}
    </div>
  );
}

function WorkspaceCard({ ws }: { ws: Workspace }) {
  const meta = [
    ws.sector,
    plural(ws.entities.length, "entité"),
    plural(ws.domains.length, "domaine"),
  ].filter(Boolean);
  const counts = ws.counts;
  const waiting = counts?.open_proposals;
  return (
    <a className="ws-card" href={href.view(ws.id)}>
      <div className="ws-card-top">
        <span className="avatar-square" aria-hidden="true">
          {initials(ws.name)}
        </span>
        <span className={`role role-${ws.role}`}>{ws.role_label}</span>
      </div>
      <div className="ws-card-name">
        <span className="ws-card-title">{ws.name}</span>
        <span className="ws-card-meta">{meta.join(" · ")}</span>
      </div>
      <div className="ws-card-counts">
        {counts?.kpi != null && <span>{counts.kpi} KPI</span>}
        {counts?.concept != null && <span>{plural(counts.concept, "concept")}</span>}
        {waiting != null &&
          (waiting > 0 ? (
            <span className="count-warn">
              {waiting} {waiting > 1 ? "propositions en attente" : "proposition en attente"}
            </span>
          ) : (
            <span>Aucune proposition</span>
          ))}
      </div>
    </a>
  );
}

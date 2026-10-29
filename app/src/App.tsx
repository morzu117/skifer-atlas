import { useEffect, useState } from "react";
import { api, type Workspace } from "./api";
import logo from "./assets/logo.png";

type Status = { kind: "starting" } | { kind: "ready"; version: string } | { kind: "error"; message: string };

export default function App() {
  const [status, setStatus] = useState<Status>({ kind: "starting" });
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const h = await api.health();
        setWorkspaces(await api.workspaces());
        setStatus({ kind: "ready", version: h.version });
      } catch (e) {
        setStatus({ kind: "error", message: String(e) });
      }
    })();
  }, []);

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <img src={logo} alt="" width={36} height={36} />
          <div>
            <div className="brand-name">Skifer</div>
            <div className="brand-sub">Atlas</div>
          </div>
        </div>
        <div className="status">
          {status.kind === "starting" && <span className="dot dot-wait" />}
          {status.kind === "ready" && <span className="dot dot-ok" />}
          {status.kind === "error" && <span className="dot dot-err" />}
          {status.kind === "starting" && "Démarrage du serveur local…"}
          {status.kind === "ready" && `Serveur local prêt · v${status.version}`}
          {status.kind === "error" && `Serveur injoignable : ${status.message}`}
        </div>
      </header>

      <main className="content">
        <div className="page-head">
          <div>
            <h1>Vos espaces de travail</h1>
            <p className="muted">
              Un espace par client. Chaque espace a son dépôt Git, ses utilisateurs, sa gouvernance et ses
              connexions : rien ne traverse d'un espace à l'autre.
            </p>
          </div>
          <button className="btn-primary" disabled={status.kind !== "ready"}>+ Créer un espace</button>
        </div>

        {status.kind === "ready" && workspaces.length === 0 && (
          <div className="empty">
            <strong>Aucun espace pour l'instant.</strong>
            <span className="muted">Créez le premier espace pour relier un dépôt Git de définitions.</span>
          </div>
        )}

        <div className="grid">
          {workspaces.map((ws) => (
            <a key={ws.id} className="card" href={`#/${ws.id}`}>
              <div className="card-top">
                <span className="avatar">{ws.name.slice(0, 2).toUpperCase()}</span>
                <span className={`pill pill-${ws.role}`}>{ws.role_label}</span>
              </div>
              <div className="card-title">{ws.name}</div>
              <div className="muted small">
                {[ws.sector, `${ws.entities.length} entité(s)`, `${ws.domains.length} domaine(s)`]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </a>
          ))}
        </div>

        <div className="note">
          Vos tokens d'accès sont stockés chiffrés sur cette machine, rangés par espace. Ils ne quittent jamais
          votre poste.
        </div>
      </main>
    </div>
  );
}

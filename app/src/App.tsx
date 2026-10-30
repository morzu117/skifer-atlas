import { useCallback, useEffect, useState } from "react";
import { Banner } from "./components/Banner";
import { Brand } from "./components/Brand";
import { href, navigate, useRoute } from "./router";
import { Home } from "./screens/Home";
import { WorkspaceShell } from "./screens/WorkspaceShell";
import { useServer, type Startup } from "./server";

const STARTUP: Startup = { attempts: 20, delayMs: 500 };

export default function App({ startup = STARTUP }: { startup?: Startup }) {
  const server = useServer(startup);
  const route = useRoute();
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (route.name === "workspace") setNotice(null);
  }, [route]);

  const unknownWorkspace = useCallback((id: string) => {
    setNotice(`L'espace « ${id} » n'est pas dans votre registre local.`);
    navigate(href.home());
  }, []);

  const banner = server.state === "unreachable" && (
    <div className="server-banner">
      <Banner
        tone="bad"
        title="Serveur local injoignable"
        action={
          <button type="button" className="btn btn-neutral btn-dense" onClick={server.retry} disabled={server.retrying}>
            {server.retrying ? "Nouvelle tentative…" : "Réessayer"}
          </button>
        }
      >
        Le serveur de Skifer Atlas ne répond pas. Réessayez ; si le problème persiste, relancez l'application.
      </Banner>
    </div>
  );

  if (server.version === null) {
    // Jamais joint : rien à afficher derrière le démarrage ou le bandeau.
    return (
      <div className="boot">
        {banner}
        <div className="boot-card">
          <Brand />
          {server.state === "starting" && (
            <p className="muted" role="status">
              Démarrage du serveur local…
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      {banner}
      {route.name === "home" ? (
        <Home key={server.generation} notice={notice} onDismissNotice={() => setNotice(null)} />
      ) : (
        <WorkspaceShell
          key={server.generation}
          wsId={route.ws}
          view={route.view}
          params={route.params}
          doc={route.doc}
          onUnknown={unknownWorkspace}
        />
      )}
    </>
  );
}

import { useEffect, useRef, useState } from "react";
import { api, ApiError, UnreachableError, type Workspace } from "../api";
import { Banner, RetryAction } from "../components/Banner";
import { Brand } from "../components/Brand";
import { Icon, type IconName } from "../components/Icon";
import { InterruptedAttachment } from "../components/InterruptedAttachment";
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
  const [loadRetry, setLoadRetry] = useState(0);
  const [waiting, setWaiting] = useState(0);
  const [refresh, setRefresh] = useState<{ id: string; revision: number } | null>(null);
  const [replacement, setReplacement] = useState(0);
  // Message de la réinitialisation faite depuis la bannière, qui disparaît avec elle.
  const [resetNotice, setResetNotice] = useState("");

  useEffect(() => {
    let alive = true;
    setLoad({ kind: "loading" });
    setResetNotice("");
    api
      .workspace(wsId)
      .then((ws) => {
        if (!alive) return;
        setLoad({ kind: "ready", ws });
      })
      .catch((error) => {
        if (!alive) return;
        if (error instanceof ApiError && error.code === "not_found") return onUnknown(wsId);
        setLoad(error instanceof UnreachableError ? { kind: "offline" } : { kind: "error", error: explain(error) });
      });
    return () => {
      alive = false;
    };
  }, [wsId, onUnknown, loadRetry]);

  // Les relectures conservent les composants et leurs états de saisie.
  const mountedWorkspace = useRef<string | null>(null);
  useEffect(() => {
    mountedWorkspace.current = wsId;
    return () => { mountedWorkspace.current = null; };
  }, [wsId]);
  const syncKey = `${wsId}:${view}:${doc ?? ""}`;
  const [dataRevision, setDataRevision] = useState(0);
  const [notice, setNotice] = useState<{ key: string; status: string } | null>(null);
  const lastCommit = useRef<{ ws: string; commit: string } | null>(null);
  const failure = useRef<{ ws: string; status: string } | null>(null);
  const [editorReady, setEditorReady] = useState(0);
  const entry = useRef({ key: "", revision: 0 });
  const editorKey = `${syncKey}:${params.from ?? ""}`;
  if (entry.current.key !== editorKey) entry.current = { key: editorKey, revision: entry.current.revision + 1 };
  const editorEntry = entry.current.revision;
  useEffect(() => {
    if (load.kind !== "ready" || load.ws.id !== wsId) return;
    let alive = true;
    const existingEditor = view === "editeur" && !!params.from;
    const timer = existingEditor ? window.setTimeout(() => {
      if (alive) setEditorReady(editorEntry);
    }, 2500) : undefined;
    const run = async () => {
      try {
        let attempts = 1;
        let result = await api.autoSync(wsId, existingEditor);
        while (alive && attempts < 20 && performance.now() < deadline &&
               (result.status === "pending" || result.status === "busy")) {
          await new Promise((resolve) => window.setTimeout(resolve, 150));
          if (!alive || mountedWorkspace.current !== wsId) return;
          if (performance.now() >= deadline) break;
          attempts += 1;
          result = await api.autoSync(wsId, existingEditor);
        }
        if (mountedWorkspace.current !== wsId) return;
        if ((result.status === "fast_forward" || result.advanced) && result.commit &&
            (lastCommit.current?.ws !== wsId || lastCommit.current.commit !== result.commit)) {
          lastCommit.current = { ws: wsId, commit: result.commit };
          setDataRevision((revision) => revision + 1);
          api.workspace(wsId).then((updated) => {
            if (mountedWorkspace.current === wsId) setLoad({ kind: "ready", ws: updated });
          }).catch(() => {});
        }
        if (!alive) return;
        if (result.status === "pending" || result.status === "busy") {
          failure.current = { ws: wsId, status: "gave_up" };
          setNotice({ key: syncKey, status: "gave_up" });
        } else if (["offline", "conflict", "local", "error", "wrong_branch"].includes(result.status)) {
          if (result.status === "local") {
            failure.current = null;
            setNotice(null);
          } else if (failure.current?.ws !== wsId || failure.current.status !== result.status) {
            failure.current = { ws: wsId, status: result.status };
            setNotice({ key: syncKey, status: result.status });
          }
        } else if (["up_to_date", "ahead", "fast_forward"].includes(result.status)) {
          failure.current = null;
          setNotice(null);
        }
      } catch (error) {
        if (!alive || mountedWorkspace.current !== wsId) return;
        if (error instanceof ApiError && error.status === 404 && error.code === "not_found") return;
        if (failure.current?.ws !== wsId || failure.current.status !== "offline") {
          failure.current = { ws: wsId, status: "offline" };
          setNotice({ key: syncKey, status: "offline" });
        }
      } finally {
        if (alive && existingEditor) setEditorReady(editorEntry);
      }
    };
    const deadline = performance.now() + 8000;
    void run();
    return () => { alive = false; if (timer !== undefined) window.clearTimeout(timer); };
  }, [wsId, syncKey, load.kind, params.from]);

  // Une fusion relit l’espace sans démonter la vue courante.
  useEffect(() => {
    if (!refresh || refresh.id !== wsId) return;
    let alive = true;
    api.workspace(wsId).then((ws) => {
      if (alive) setLoad({ kind: "ready", ws });
    }).catch(() => { /* La vue reste utilisable si la relecture échoue. */ });
    return () => { alive = false; };
  }, [wsId, refresh]);

  const refreshWorkspace = () => setRefresh((previous) => ({ id: wsId, revision: (previous?.revision ?? 0) + 1 }));

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
  const conflict = explain(new ApiError(409, "sync_conflict", ""));
  const syncMessage = notice?.status === "conflict" ? conflict
    : notice?.status === "gave_up" ? { title: "Synchronisation en attente", text: "La synchronisation n’a pas encore eu lieu. Un nouvel essai aura lieu au prochain changement d’écran." }
    : notice?.status === "wrong_branch" ? explain(new ApiError(409, "sync_wrong_branch", ""))
    : notice?.status === "error" ? explain(new ApiError(500, "sync_error", ""))
    : { title: "Dépôt momentanément inaccessible", text: "La copie locale reste disponible. Vérifiez le réseau ou l’accès au dépôt." };
  useEffect(() => { setNotice(null); }, [syncKey]);
  const syncNotice = notice?.key === syncKey && (
    <Banner tone="info" title={syncMessage.title}>{syncMessage.text}</Banner>
  );
  // Un référent de domaine n'administre pas l'espace : seul un référent d'espace (0017).
  const referent = ws?.space_referent === true;

  useEffect(() => {
    if (ws && view === "administration" && !referent) navigate(href.view(ws.id));
    if (ws && view === "editeur" && ws.role === "lecteur") navigate(href.view(ws.id));
  }, [ws, view, referent]);

  // Changement de vue : le focus va au titre, comme un chargement de page pour un lecteur
  // d'écran ; Tab repart de là.
  const heading = useRef<HTMLHeadingElement>(null);
  const workspaceReady = ws !== null;
  useEffect(() => {
    if (workspaceReady) heading.current?.focus();
  }, [workspaceReady, wsId, view, doc, replacement, editorReady, editorEntry]);

  const replaceWorkspace = (next: Workspace) => {
    setLoad({ kind: "ready", ws: next });
    setReplacement((revision) => revision + 1);
  };

  // Le rattachement interrompu se voit de tout écran et pour tout rôle ; l'espace relu par le serveur
  // remplace l'ancien (plus de bannière, rôle remis).
  const interrupted = (
    <>
      {ws && (
        <InterruptedAttachment
          ws={ws}
          adminLink={view !== "administration"}
          onReset={(next, message) => (replaceWorkspace(next), setResetNotice(message))}
        />
      )}
      {resetNotice && ws?.attachment !== "interrupted" && (
        <Banner tone="info" title="Réinitialisation terminée">
          {resetNotice}
        </Banner>
      )}
    </>
  );

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
          <Banner tone="bad" title={load.error.title} action={<RetryAction onRetry={() => setLoadRetry((n) => n + 1)} />}>
            {load.error.text}
          </Banner>
        )}
        {interrupted}
        {syncNotice}
        {ws && params.from && editorReady !== editorEntry && <p className="muted editor-loading" role="status">Mise à jour du dépôt…</p>}
        {ws && (!params.from || editorReady === editorEntry) && <Editor ws={ws} params={params} heading={heading} />}
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
            <span className="avatar-round">{initials(ws.user_name || ws.account || "?")}</span>
            <span className="sidebar-user-text">
              <span className="sidebar-user-name">{ws.user_name || ws.account}</span>
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
          <Banner tone="bad" title={load.error.title} action={<RetryAction onRetry={() => setLoadRetry((n) => n + 1)} />}>
            {load.error.text}
          </Banner>
        )}
        {interrupted}
        {syncNotice}
        {ws && view === "catalogue" && <Catalogue revision={dataRevision} ws={ws} params={params} heading={heading} />}
        {ws && view === "fiche" && doc && <Fiche revision={dataRevision} ws={ws} id={doc} params={params} heading={heading} />}
        {ws && view === "propositions" && <Proposals ws={ws} params={params} heading={heading} onMerged={refreshWorkspace} />}
        {ws && view === "comparaison" && <Comparison ws={ws} params={params} heading={heading} />}
        {ws && view === "connexions" && <Connections ws={ws} heading={heading} />}
        {ws && view === "administration" && <Administration ws={ws} heading={heading} onMerged={refreshWorkspace} onWorkspaceChange={replaceWorkspace} />}
      </main>
    </div>
  );
}

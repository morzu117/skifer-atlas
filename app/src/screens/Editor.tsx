import { useEffect, useState, type RefObject } from "react";
import { api, UnreachableError, type Draft, type Workspace } from "../api";
import { Banner } from "../components/Banner";
import { Icon } from "../components/Icon";
import { explain, type Explained } from "../messages";
import { href, type Params } from "../router";

// Éditeur (10.3), en attendant le plan 0013. « Proposer une modification » (fiche, plan
// 0012) y mène avec `?from=<id>` : la copie de la version courante, version incrémentée,
// s'affiche en brouillon, sans encore rien enregistrer.

type Load = { kind: "loading" } | { kind: "ready"; draft: Draft } | { kind: "error"; error: Explained };

export function Editor({ ws, params, heading }: { ws: Workspace; params: Params; heading: RefObject<HTMLHeadingElement> }) {
  const from = params.from ?? "";
  const [load, setLoad] = useState<Load>({ kind: "loading" });

  useEffect(() => {
    if (!from) return;
    let alive = true;
    setLoad({ kind: "loading" });
    api
      .draft(ws.id, from)
      .then((draft) => alive && setLoad({ kind: "ready", draft }))
      .catch((reason) => {
        if (alive && !(reason instanceof UnreachableError)) setLoad({ kind: "error", error: explain(reason) });
      });
    return () => {
      alive = false;
    };
  }, [ws.id, from]);

  if (!from) {
    return (
      <>
        <div className="main-head">
          <h1 ref={heading} tabIndex={-1}>
            Nouveau concept ou KPI
          </h1>
        </div>
        <div className="placeholder">
          Cet écran arrive avec le plan 0013. Le domaine du document se choisira à la création.
        </div>
      </>
    );
  }

  const draft = load.kind === "ready" ? load.draft : null;
  return (
    <>
      <a className="back" href={href.document(ws.id, from)}>
        <Icon name="back" className="icon-sm" />
        {draft?.label ?? "Fiche"}
      </a>
      <div className="fiche-badges">
        <h1 ref={heading} tabIndex={-1}>
          {draft ? `Nouvelle version de ${draft.label}` : "Nouvelle version"}
        </h1>
        {draft && (
          <>
            <span className="badge badge-warn">Brouillon</span>
            <span className="badge badge-neutral">
              v{draft.version} · copie de la v{draft.base_version}
            </span>
          </>
        )}
      </div>
      {load.kind === "loading" && (
        <p className="muted" role="status">
          Préparation de la copie…
        </p>
      )}
      {load.kind === "error" && (
        <Banner tone="bad" title={load.error.title}>
          {load.error.text}
        </Banner>
      )}
      {draft && (
        <>
          <div className="placeholder">
            L'éditeur de graphe arrive avec le plan 0013 : cette copie n'est pas encore enregistrée. Seule la
            version change ; elle deviendra une proposition à valider.
          </div>
          <section className="tab-panel" aria-labelledby="draft-title">
            <h2 id="draft-title">YAML du brouillon</h2>
            <pre className="code">{draft.content}</pre>
          </section>
        </>
      )}
    </>
  );
}

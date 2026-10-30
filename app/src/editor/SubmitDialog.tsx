import { useEffect, useId, useState, type FormEvent } from "react";
import { api, type Proposal, type ProposalPreview } from "../api";
import { Banner } from "../components/Banner";
import { DiffList, DiffSummary } from "../components/DiffList";
import { Drawer } from "../components/Drawer";
import { NATURES, plural } from "../format";
import { explain, type Explained } from "../messages";

// Soumission (guide 10.3) : récapitulatif de la proposition, nature et validations
// requises (plan 0006), écarts classés avec la version courante ou le canonique (plan
// 0003), justification obligatoire. Le YAML soumis est celui qu'a produit le serveur.

type Load = { kind: "loading" } | { kind: "ready"; preview: ProposalPreview } | { kind: "error"; error: Explained };

export function SubmitDialog({
  ws,
  document,
  yaml,
  baseVersion,
  onClose,
  onSubmitted,
}: {
  ws: string;
  document: Record<string, unknown>;
  yaml: string;
  baseVersion: number | null;
  onClose: () => void;
  onSubmitted: (proposal: Proposal) => void;
}) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [justification, setJustification] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Explained | null>(null);
  const [missing, setMissing] = useState(false);
  const id = useId();

  useEffect(() => {
    let alive = true;
    api
      .preview(ws, document)
      .then((preview) => alive && setLoad({ kind: "ready", preview }))
      .catch((reason) => alive && setLoad({ kind: "error", error: explain(reason) }));
    return () => {
      alive = false;
    };
  }, [ws, document]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!justification.trim()) {
      setMissing(true);
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      onSubmitted(await api.createProposal(ws, { document_yaml: yaml, justification: justification.trim(), base_version: baseVersion }));
    } catch (reason) {
      setFailure(explain(reason));
      setBusy(false);
    }
  }

  const preview = load.kind === "ready" ? load.preview : null;
  const nature = preview ? NATURES[preview.nature] ?? { label: preview.nature, tone: "badge-neutral" } : null;
  return (
    <Drawer title="Soumettre la proposition" onClose={onClose}>
      {load.kind === "loading" && (
        <p className="muted" role="status">
          Préparation du récapitulatif…
        </p>
      )}
      {load.kind === "error" && (
        <Banner tone="bad" title={load.error.title}>
          {load.error.text}
        </Banner>
      )}
      {preview && nature && (
        <>
          <dl className="facts">
            <div>
              <dt>Nature</dt>
              <dd>
                <span className={`badge ${nature.tone}`}>{nature.label}</span>
              </dd>
            </div>
            <div>
              <dt>Domaine</dt>
              <dd>{preview.domain ?? "—"}</dd>
            </div>
            <div>
              <dt>Validations requises</dt>
              <dd>{preview.required}</dd>
            </div>
          </dl>
          {preview.mention && <p className="prop-hint">{preview.mention}</p>}
          {preview.nature === "undeclared" && (
            <Banner tone="warn" title="Hors points déclarés : la validation canonique s'appliquera" />
          )}
          {preview.diff ? (
            <section className="diff" aria-label="Écarts">
              <h3>{plural(preview.diff.differences.length, "écart")}</h3>
              <DiffSummary report={preview.diff} />
              <DiffList report={preview.diff} />
            </section>
          ) : (
            <p className="prop-hint">Nouveau document : pas de version à comparer.</p>
          )}
        </>
      )}
      <form className="form" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor={id}>
            Justification<span className="required"> requis</span>
          </label>
          <textarea
            id={id}
            className="prop-input"
            rows={4}
            value={justification}
            aria-invalid={missing && !justification.trim() ? true : undefined}
            aria-describedby={`${id}-help`}
            onChange={(event) => setJustification(event.target.value)}
          />
          <span id={`${id}-help`} className={missing && !justification.trim() ? "field-error" : "field-hint"}>
            {missing && !justification.trim() ? "Expliquer la modification aux validateurs." : "Lue par les validateurs avec le diff."}
          </span>
        </div>
        {failure && (
          <Banner tone="bad" title={failure.title}>
            {failure.text}
          </Banner>
        )}
        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={busy || load.kind !== "ready"}>
            {busy ? "Envoi…" : "Soumettre"}
          </button>
          <button type="button" className="btn btn-neutral" onClick={onClose}>
            Annuler
          </button>
        </div>
      </form>
    </Drawer>
  );
}

import { ReactFlowProvider, useReactFlow, useViewport } from "@xyflow/react";
import { lazy, Suspense, useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type RefObject } from "react";
import { api, ApiError, UnreachableError, type CheckResult, type EditorDocument, type Issue, type Proposal, type Workspace } from "../api";
import { Banner } from "../components/Banner";
import { Icon, type IconName } from "../components/Icon";
import { Select } from "../components/Select";
import { ago, plural, slugify } from "../format";
import { explain, type Explained } from "../messages";
import { href, replace, type Params } from "../router";
import { BottomPanel, DIALECTS, type BottomTab, type Dialect } from "../editor/BottomPanel";
import { Canvas, type Tool } from "../editor/Canvas";
import { Palette } from "../editor/Palette";
import { Properties } from "../editor/Properties";
import { SubmitDialog } from "../editor/SubmitDialog";
import {
  apply,
  autoLayout,
  edgesOf,
  emptyHistory,
  GRID,
  NO_INPUT,
  nextId,
  OpError,
  outputOf,
  overriddenIds,
  placeNear,
  record,
  redo,
  snap,
  undo,
  variationPoints,
  viewNodes,
  type History,
  type NodeType,
  type Op,
  type Positions,
  type Raw,
} from "../editor/model";

// Éditeur de graphe (10.3, plan 0013). Plein écran, sans barre latérale. Le document YAML
// (analysé en JSON) est l'unique état ; le canevas, les formulaires et la vue YAML en sont
// des projections. Chaque modification est une opération annulable ; la validation part au
// serveur 300 ms après la dernière frappe, le brouillon s'enregistre en local peu après.

// CodeMirror ne se charge qu'à la première ouverture de la vue YAML.
const YamlView = lazy(() => import("../editor/YamlView").then((m) => ({ default: m.YamlView })));

const CHECK_DELAY = 300;
const SAVE_DELAY = 800;
// Centre d'un nœud de 184 px pour « Aller au nœud ».
const NODE_CENTER = { x: 92, y: 40 };

type Session = { doc: Raw; positions: Positions; highest: number; history: History };
type Load = { kind: "loading" } | { kind: "ready"; info: EditorDocument } | { kind: "error"; error: Explained };
type Yaml = { text: string; issues: Issue[]; check: CheckResult | null };

const isRaw = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown) => (typeof value === "string" ? value : "");
const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/** Positions connues, complétées par la disposition automatique pour les nœuds sans place. */
function placed(nodes: ReturnType<typeof viewNodes>, positions: Positions | null | undefined): Positions {
  const known = positions ?? {};
  const missing = nodes.some((n) => !known[n.id]);
  return missing ? { ...autoLayout(nodes), ...known } : { ...known };
}

export function Editor({ ws, params, heading }: { ws: Workspace; params: Params; heading: RefObject<HTMLHeadingElement> }) {
  const from = params.from ?? "";
  if (!from) return <NewDocument ws={ws} heading={heading} />;
  return (
    <ReactFlowProvider>
      <Session key={from} ws={ws} id={from} heading={heading} />
    </ReactFlowProvider>
  );
}

// --- nouveau document -------------------------------------------------------------------

function NewDocument({ ws, heading }: { ws: Workspace; heading: RefObject<HTMLHeadingElement> }) {
  const [kind, setKind] = useState<"kpi" | "concept">("kpi");
  const [label, setLabel] = useState("");
  const [id, setId] = useState("");
  const [edited, setEdited] = useState(false);
  const [domain, setDomain] = useState(ws.domains[0] ?? "");
  const [owner, setOwner] = useState(ws.account);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<Explained | null>(null);
  const ids = { label: useId(), id: useId(), domain: useId(), owner: useId() };
  const slug = edited ? id : slugify(label);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const found: Record<string, string> = {};
    if (!label.trim()) found.label = "Donner un libellé.";
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) found.id = "Minuscules, chiffres et tirets (ex. revenu-net).";
    if (!domain) found.domain = "Choisir un domaine.";
    if (!owner.trim()) found.owner = "Indiquer le propriétaire.";
    setErrors(found);
    setFailure(null);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    try {
      await api.editorNew(ws.id, { kind, id: slug, label: label.trim(), domain, owner: owner.trim() });
      replace(href.editor(ws.id, { from: slug }));
    } catch (reason) {
      setBusy(false);
      if (reason instanceof ApiError && reason.code === "document_exists") setErrors({ id: reason.message });
      else setFailure(explain(reason));
    }
  }

  const describe = (key: string) => (errors[key] ? `${ids[key as keyof typeof ids]}-error` : undefined);
  return (
    <div className="editor-page">
      <header className="editor-head">
        <div className="editor-head-start">
          <a className="editor-back" href={href.view(ws.id)}>
            <Icon name="back" className="icon-sm" />
            Catalogue
          </a>
        </div>
      </header>
      <main className="editor-new">
        <form className="card form editor-new-card" onSubmit={submit} noValidate>
          <h1 ref={heading} tabIndex={-1}>
            Nouveau concept ou KPI
          </h1>
          <p className="muted">Le document s'enregistre aussitôt en brouillon local, sur ce poste ; il ne part au dépôt qu'à la soumission.</p>
          <fieldset className="prop">
            <legend className="prop-label">Type</legend>
            <span className="radios">
              {(["kpi", "concept"] as const).map((value) => (
                <label key={value} className="radio">
                  <input type="radio" name="kind" value={value} checked={kind === value} onChange={() => setKind(value)} />
                  {value === "kpi" ? "KPI" : "Concept"}
                </label>
              ))}
            </span>
          </fieldset>
          {(
            [
              ["label", "Libellé", label, (v: string) => setLabel(v), false],
              ["id", "Identifiant", slug, (v: string) => (setEdited(true), setId(v)), true],
              ["owner", "Propriétaire", owner, (v: string) => setOwner(v), false],
            ] as const
          ).map(([key, name, value, change, mono]) => (
            <div className="field" key={key}>
              <label htmlFor={ids[key]}>
                {name}
                <span className="required"> requis</span>
              </label>
              <input
                id={ids[key]}
                className={mono ? "mono" : undefined}
                value={value}
                aria-invalid={errors[key] ? true : undefined}
                aria-describedby={describe(key)}
                onChange={(event) => change(event.target.value)}
              />
              {errors[key] && (
                <span id={`${ids[key]}-error`} className="field-error">
                  {errors[key]}
                </span>
              )}
            </div>
          ))}
          <div className="field">
            <label htmlFor={ids.domain}>
              Domaine<span className="required"> requis</span>
            </label>
            <Select id={ids.domain} value={domain} aria-describedby={describe("domain")} onChange={(event) => setDomain(event.target.value)}>
              <option value="">Choisir…</option>
              {ws.domains.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Select>
            {errors.domain && (
              <span id={`${ids.domain}-error`} className="field-error">
                {errors.domain}
              </span>
            )}
          </div>
          {failure && (
            <Banner tone="bad" title={failure.title}>
              {failure.text}
            </Banner>
          )}
          <div className="actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Création…" : "Créer et ouvrir l'éditeur"}
            </button>
            <a className="btn btn-neutral" href={href.view(ws.id)}>
              Annuler
            </a>
          </div>
        </form>
      </main>
    </div>
  );
}

// --- session d'édition ------------------------------------------------------------------

function Session({ ws, id, heading }: { ws: Workspace; id: string; heading: RefObject<HTMLHeadingElement> }) {
  const flow = useReactFlow();
  const { zoom } = useViewport();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [session, setSession] = useState<Session | null>(null);
  const current = useRef<Session | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [tab, setTab] = useState<BottomTab>("problems");
  const [dialect, setDialect] = useState<Dialect>("databricks");
  const [notice, setNotice] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [resumed, setResumed] = useState<{ savedAt: string; base: number | null } | null>(null);
  const [yaml, setYaml] = useState<Yaml | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<Proposal | null>(null);
  const [kpis, setKpis] = useState<{ value: string; label: string }[]>([]);
  const [, setTick] = useState(0);
  const checkSeq = useRef(0);

  const commit = useCallback((next: Session) => {
    current.current = next;
    setSession(next);
    setRevision((r) => r + 1);
  }, []);

  // Ouverture : copie de la version courante, ou brouillon local repris.
  useEffect(() => {
    let alive = true;
    api
      .editorOpen(ws.id, id)
      .then((info) => {
        if (!alive) return;
        const draft = info.draft;
        const doc = draft ? draft.document : info.document;
        const nodes = viewNodes(doc, info.mode, info.canonical);
        const start: Session = {
          doc,
          positions: placed(nodes, draft?.positions && Object.keys(draft.positions).length ? draft.positions : info.positions),
          highest: Math.max(info.highest, draft?.highest ?? 0),
          history: emptyHistory(),
        };
        current.current = start;
        setSession(start);
        if (draft) {
          setSavedAt(draft.saved_at);
          if (info.base_version !== null) setResumed({ savedAt: draft.saved_at, base: draft.base_version });
        }
        setLoad({ kind: "ready", info });
      })
      .catch((reason) => {
        if (alive && !(reason instanceof UnreachableError)) setLoad({ kind: "error", error: explain(reason) });
      });
    api
      .catalog(ws.id, { q: "", domain: "", owner: "", status: "", kind: "kpi" })
      .then((rows) => alive && setKpis(rows.filter((r) => r.id !== id).map((r) => ({ value: r.id, label: `${r.label} (${r.id})` }))))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [ws.id, id]);

  const info = load.kind === "ready" ? load.info : null;
  const doc = session?.doc ?? null;

  const runCheck = useCallback(
    async (document: Raw, node: string | null) => {
      const seq = ++checkSeq.current;
      setChecking(true);
      try {
        const result = await api.editorCheck(ws.id, document, node);
        if (seq === checkSeq.current) setCheck(result);
        return result;
      } catch {
        return null;
      } finally {
        if (seq === checkSeq.current) setChecking(false);
      }
    },
    [ws.id],
  );

  // Validation à la frappe, temporisée.
  useEffect(() => {
    if (!doc || yaml) return;
    const timer = setTimeout(() => void runCheck(doc, selected), CHECK_DELAY);
    return () => clearTimeout(timer);
  }, [doc, selected, yaml, runCheck]);

  // Brouillon local : seulement après une modification.
  useEffect(() => {
    if (revision === 0 || !info || submitted) return;
    const timer = setTimeout(() => {
      const s = current.current;
      if (!s) return;
      setSaving(true);
      api
        .saveDraft(ws.id, id, { document: s.doc, positions: s.positions, highest: s.highest, base_version: info.base_version })
        .then((saved) => setSavedAt(saved.saved_at))
        .catch(() => setNotice("Le brouillon n'a pas pu être enregistré sur ce poste."))
        .finally(() => setSaving(false));
    }, SAVE_DELAY);
    return () => clearTimeout(timer);
  }, [revision, info, ws.id, id, submitted]);

  // « Enregistré il y a n min » reste juste.
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  /** Applique des opérations comme une seule entrée d'historique ; refus expliqué. */
  const dispatch = useCallback(
    (ops: Op | Op[], change: Partial<Pick<Session, "positions" | "highest">> = {}) => {
      const s = current.current;
      if (!s) return false;
      const list = Array.isArray(ops) ? ops : [ops];
      let after = s.doc;
      try {
        for (const op of list) after = apply(after, op);
      } catch (error) {
        if (error instanceof OpError) {
          setNotice(error.message);
          return false;
        }
        throw error;
      }
      setNotice(null);
      commit({ ...s, ...change, doc: after, history: record(s.history, { op: list[0], before: s.doc, after }) });
      return true;
    },
    [commit],
  );

  const mode = info?.mode ?? "canonical";
  const canonical = info?.canonical ?? null;
  const nodes = useMemo(() => (doc ? viewNodes(doc, mode, canonical) : []), [doc, mode, canonical]);
  const locked = mode === "override";
  const selectedNode = nodes.find((n) => n.id === selected) ?? null;
  const output = doc ? outputOf(mode === "override" && canonical ? canonical : doc) : undefined;

  const step = (direction: "undo" | "redo") => {
    const s = current.current;
    if (!s) return;
    const moved = direction === "undo" ? undo(s.history) : redo(s.history);
    if (!moved) return;
    setNotice(null);
    commit({ ...s, doc: moved.document, history: moved.history, positions: placed(viewNodes(moved.document, mode, canonical), s.positions) });
  };

  const addNode = (type: NodeType, at?: { x: number; y: number }) => {
    const s = current.current;
    if (!s || locked) return;
    const { id: created, highest } = nextId(s.doc, s.highest);
    const ops: Op[] = [{ kind: "add_node", type, id: created }];
    const anchor = !at && selected && !NO_INPUT.includes(type) && nodes.some((n) => n.id === selected) ? selected : undefined;
    if (anchor) ops.push({ kind: "connect", source: anchor, target: created });
    const position = at ?? placeNear(s.positions, anchor);
    if (dispatch(ops, { highest, positions: { ...s.positions, [created]: position } })) {
      setSelected(created);
      setPending(null);
    }
  };

  const duplicate = (source: string) => {
    const s = current.current;
    if (!s) return;
    const { id: copy, highest } = nextId(s.doc, s.highest);
    const base = s.positions[source] ?? { x: GRID, y: GRID };
    if (dispatch({ kind: "duplicate", id: source, copy }, { highest, positions: { ...s.positions, [copy]: { x: base.x + 2 * GRID, y: base.y + 2 * GRID } } })) {
      setSelected(copy);
    }
  };

  const removeNode = (target: string) => {
    if (locked) return;
    if (dispatch({ kind: "remove", id: target }) && selected === target) setSelected(null);
  };

  const onSelect = (target: string | null) => {
    if (tool === "edge") {
      if (!target) return setPending(null);
      if (!pending) return setPending(target);
      if (pending !== target) dispatch({ kind: "connect", source: pending, target });
      setPending(null);
      return;
    }
    setSelected(target);
  };

  const move = (target: string, position: { x: number; y: number }) => {
    const s = current.current;
    if (!s) return;
    commit({ ...s, positions: { ...s.positions, [target]: position } });
  };

  const goTo = (target: string) => {
    setTool("select");
    setSelected(target);
    const p = current.current?.positions[target];
    if (p) void flow.setCenter(p.x + NODE_CENTER.x, p.y + NODE_CENTER.y, { zoom: Math.max(zoom, 1), duration: 200 });
  };

  // Annuler / rétablir au clavier, hors champ de saisie (qui garde son propre historique).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (yaml || typing(event.target) || !(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key === "z") {
        event.preventDefault();
        step(event.shiftKey ? "redo" : "undo");
      } else if (key === "y") {
        event.preventDefault();
        step("redo");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const enterYaml = async () => {
    if (!doc) return;
    const result = await runCheck(doc, selected);
    if (result) setYaml({ text: result.yaml, issues: result.issues, check: result });
  };

  // YAML plein écran : analyse puis validation, avec la même temporisation.
  const yamlText = yaml?.text;
  useEffect(() => {
    if (yamlText === undefined) return;
    let alive = true;
    const timer = setTimeout(async () => {
      try {
        const parsed = await api.editorParse(ws.id, yamlText);
        if (!alive) return;
        if (!parsed.document) {
          setYaml((y) => y && { ...y, issues: parsed.issues, check: null });
          return;
        }
        const result = await api.editorCheck(ws.id, parsed.document, null);
        if (alive) setYaml((y) => y && { ...y, issues: result.issues, check: result });
      } catch {
        // le bandeau du serveur injoignable suffit
      }
    }, CHECK_DELAY);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [yamlText, ws.id]);

  const leaveYaml = async () => {
    if (!yaml || !doc) return;
    const parsed = await api.editorParse(ws.id, yaml.text);
    if (!parsed.document) {
      setYaml({ ...yaml, issues: parsed.issues, check: null });
      setNotice("YAML illisible : corriger l'erreur signalée pour revenir au canevas.");
      return;
    }
    const next = parsed.document;
    if (JSON.stringify(next) !== JSON.stringify(doc)) {
      const s = current.current!;
      dispatch({ kind: "replace", document: next }, { positions: placed(viewNodes(next, mode, canonical), s.positions) });
    }
    setNotice(null);
    setYaml(null);
  };

  const startSubmit = () => {
    if (!check?.submittable || checking) {
      setTab("problems");
      const errors = check?.issues.filter((i) => i.severity === "error").length ?? 0;
      setNotice(errors > 0 ? `Soumission bloquée : ${plural(errors, "erreur")} à corriger (onglet Problèmes).` : "Validation en cours : réessayer dans un instant.");
      return;
    }
    setSubmitting(true);
  };

  const onSubmitted = (proposal: Proposal) => {
    setSubmitting(false);
    setSubmitted(proposal);
    api.deleteDraft(ws.id, id).catch(() => undefined);
  };

  const restart = async () => {
    if (!info) return;
    await api.deleteDraft(ws.id, id).catch(() => undefined);
    const nodes = viewNodes(info.document, info.mode, info.canonical);
    const fresh: Session = { doc: info.document, positions: placed(nodes, info.positions), highest: Math.max(info.highest, session?.highest ?? 0), history: emptyHistory() };
    current.current = fresh;
    setSession(fresh);
    setResumed(null);
    setSavedAt(null);
    setSelected(null);
  };

  // --- rendu -------------------------------------------------------------------------------

  if (load.kind !== "ready" || !info || !session || !doc) {
    return (
      <div className="editor-page">
        <header className="editor-head">
          <div className="editor-head-start">
            <a className="editor-back" href={href.view(ws.id)}>
              <Icon name="back" className="icon-sm" />
              Catalogue
            </a>
            <h1 ref={heading} tabIndex={-1} className="editor-title">
              {load.kind === "error" ? "Éditeur" : "Ouverture de l'éditeur…"}
            </h1>
          </div>
        </header>
        <main className="editor-new">
          {load.kind === "error" && (
            <Banner tone="bad" title={load.error.title}>
              {load.error.text}
            </Banner>
          )}
        </main>
      </div>
    );
  }

  const product = isRaw(doc.data_product) ? doc.data_product : {};
  const label = text(doc.label) || (mode !== "canonical" ? `${text((doc.variant_of as Raw | undefined)?.id)} · ${text(doc.entity)}` : id);
  const version = typeof product.version === "number" ? product.version : null;
  const back =
    info.kind === "variant"
      ? { href: href.document(ws.id, text((doc.variant_of as Raw | undefined)?.id)), label: text((doc.variant_of as Raw | undefined)?.id) }
      : info.base_version !== null
        ? { href: href.document(ws.id, id), label }
        : { href: href.view(ws.id), label: "Catalogue" };
  const edges = edgesOf(nodes).length;
  const saved = saving ? "Enregistrement…" : savedAt ? `Enregistré ${ago(savedAt)} (local)` : "Non enregistré";
  const blocked = !check?.submittable || checking;
  const yamlBlocked = yaml ? !yaml.check : false;

  const tools: { id: Tool; label: string; icon: IconName }[] = [
    { id: "select", label: "Sélection", icon: "pointer" },
    { id: "pan", label: "Déplacer la vue", icon: "hand" },
    { id: "edge", label: "Ajouter une arête", icon: "edge" },
  ];

  return (
    <div className="editor-page">
      <header className="editor-head">
        <div className="editor-head-start">
          <a className="editor-back" href={back.href}>
            <Icon name="back" className="icon-sm" />
            {back.label}
          </a>
          <span className="editor-sep" aria-hidden="true">
            /
          </span>
          <h1 ref={heading} tabIndex={-1} className="editor-title">
            <span className="sr-only">{label} :</span> {version !== null ? `v${version} · brouillon` : "brouillon"}
          </h1>
          <span className="editor-chip mono">
            schéma {String(doc.schema_version ?? "?")} · {plural(nodes.length, "nœud")} · {plural(edges, "arête")}
          </span>
          <span className="editor-saved" role="status">
            {saved}
          </span>
        </div>
        {!submitted && (
          <div className="editor-head-end">
            {yaml ? (
              <button type="button" className="btn btn-head" aria-disabled={yamlBlocked || undefined} onClick={() => void leaveYaml()}>
                <Icon name="edge" className="icon-sm" />
                Revenir au canevas
              </button>
            ) : (
              <button type="button" className="btn btn-head" onClick={() => void enterYaml()}>
                <Icon name="code" className="icon-sm" />
                Éditer en YAML
              </button>
            )}
            <button type="button" className="btn btn-mint" aria-disabled={blocked || !!yaml || undefined} onClick={yaml ? undefined : startSubmit}>
              Soumettre la proposition
            </button>
          </div>
        )}
      </header>

      {submitted ? (
        <main className="editor-new">
          <div className="card editor-new-card" role="status">
            <h2>Proposition n° {submitted.id} créée</h2>
            <p>
              {submitted.title} · branche <span className="mono">{submitted.branch}</span>
              {submitted.approvals ? ` · validations ${submitted.approvals.obtained} / ${submitted.approvals.required}` : ""}.
            </p>
            <p className="muted">Le brouillon local est supprimé : la proposition attend maintenant ses validateurs.</p>
            <div className="actions">
              <a className="btn btn-primary" href={href.view(ws.id, "propositions")}>
                Voir les propositions
              </a>
              <a className="btn btn-neutral" href={back.href}>
                {info.base_version !== null ? "Retour à la fiche" : "Retour au catalogue"}
              </a>
            </div>
          </div>
        </main>
      ) : yaml ? (
        <main className="editor-yaml">
          {notice && (
            <div className="editor-notice" role="alert">
              <Icon name="alert" className="icon-sm" />
              {notice}
            </div>
          )}
          <Suspense fallback={<p className="bottom-empty muted">Chargement de l'éditeur YAML…</p>}>
            <YamlView initial={yaml.text} label={`YAML de ${label}`} onChange={(value) => setYaml((y) => y && { ...y, text: value })} />
          </Suspense>
          <BottomPanel
            check={yaml.check ?? { yaml: "", fragments: {}, issues: yaml.issues, columns: {}, submittable: false, status: { schema: false, acyclic: true, cycle: null, compilable: {} } }}
            pending={false}
            tab={tab}
            onTab={setTab}
            node={null}
            dialect={dialect}
            onDialect={setDialect}
            onGo={() => undefined}
          />
        </main>
      ) : (
        <>
          <div className="toolbar" role="toolbar" aria-label="Outils du canevas">
            {tools.map((t) => (
              <button
                key={t.id}
                type="button"
                className="tool"
                aria-label={t.label}
                title={t.label}
                aria-pressed={tool === t.id}
                disabled={t.id === "edge" && locked}
                onClick={() => {
                  setTool(t.id);
                  setPending(null);
                }}
              >
                <Icon name={t.icon} className="icon-sm" />
              </button>
            ))}
            <span className="toolbar-sep" aria-hidden="true" />
            <button type="button" className="tool-text" disabled={session.history.past.length === 0} onClick={() => step("undo")}>
              Annuler
            </button>
            <button type="button" className="tool-text" disabled={session.history.future.length === 0} onClick={() => step("redo")}>
              Rétablir
            </button>
            <span className="toolbar-sep" aria-hidden="true" />
            <button type="button" className="tool-text" onClick={() => commit({ ...session, positions: autoLayout(nodes) })}>
              Disposition automatique
            </button>
            <button type="button" className="tool-text" onClick={() => commit({ ...session, positions: snap(session.positions) })}>
              Aligner
            </button>
            <span className="toolbar-sep" aria-hidden="true" />
            <button
              type="button"
              className="tool-text"
              onClick={() => {
                setTab("problems");
                void runCheck(doc, selected);
              }}
            >
              Valider le graphe
            </button>
            <button type="button" className="tool-text" onClick={() => setTab("sql")}>
              Aperçu SQL ({DIALECTS.find((d) => d.value === dialect)?.label})
            </button>
            <div className="toolbar-end">
              <button type="button" className="tool tool-bordered" aria-label="Zoom arrière" onClick={() => void flow.zoomOut()}>
                −
              </button>
              <span className="zoom mono" aria-label="Zoom">
                {Math.round(zoom * 100)} %
              </span>
              <button type="button" className="tool tool-bordered" aria-label="Zoom avant" onClick={() => void flow.zoomIn()}>
                +
              </button>
              <button type="button" className="tool-text tool-bordered" onClick={() => void flow.fitView({ padding: 0.2, maxZoom: 1 })}>
                Ajuster
              </button>
            </div>
          </div>

          <div className="editor-body">
            <Palette onAdd={(type) => addNode(type)} disabled={locked} />
            <section className="editor-center" aria-label="Graphe">
              {resumed && (
                <Banner
                  tone={resumed.base !== info.base_version ? "warn" : "info"}
                  title={resumed.base !== info.base_version ? "La version courante a changé depuis ce brouillon" : "Brouillon local repris"}
                  action={
                    <button type="button" className="btn btn-neutral btn-dense" onClick={() => void restart()}>
                      Repartir de la v{info.base_version}
                    </button>
                  }
                >
                  Enregistré {ago(resumed.savedAt)} sur ce poste
                  {resumed.base !== info.base_version ? ` à partir de la v${resumed.base ?? "?"} ; la proposition sera comparée à la v${info.base_version}.` : "."}
                </Banner>
              )}
              {notice && (
                <div className="editor-notice" role="alert">
                  <Icon name="alert" className="icon-sm" />
                  {notice}
                  <button type="button" className="icon-button" aria-label="Fermer le message" onClick={() => setNotice(null)}>
                    <Icon name="close" className="icon-xs" />
                  </button>
                </div>
              )}
              {tool === "edge" && (
                <p className="editor-hint" role="status">
                  {pending ? `Arête depuis ${pending} : cliquer le nœud d'arrivée.` : "Cliquer le nœud de départ, puis celui d'arrivée."}
                </p>
              )}
              <Canvas
                nodes={nodes}
                positions={session.positions}
                selected={selected}
                pending={pending}
                output={output}
                variation={variationPoints(mode === "override" && canonical ? canonical : doc)}
                overridden={overriddenIds(doc)}
                locked={locked}
                issues={check?.issues ?? []}
                tool={tool}
                label={`Graphe de ${label}`}
                onSelect={onSelect}
                onMove={move}
                onConnect={(source, target, side) => dispatch({ kind: "connect", source, target, side })}
                onDisconnect={(source, target, side) => dispatch({ kind: "disconnect", source, target, side })}
                onRemove={removeNode}
                onDrop={(type, position) => addNode(type, position)}
              />
              <BottomPanel
                check={check}
                pending={checking}
                tab={tab}
                onTab={setTab}
                node={selected ?? output ?? null}
                dialect={dialect}
                onDialect={setDialect}
                onGo={goTo}
              />
            </section>
            <Properties
              doc={doc}
              mode={mode}
              canonical={canonical}
              node={selectedNode}
              nodes={nodes}
              output={output}
              check={check}
              vocabulary={info.vocabulary}
              kpis={kpis}
              info={info}
              dispatch={(op) => dispatch(op)}
              onDuplicate={duplicate}
              onRemove={removeNode}
            />
          </div>
        </>
      )}

      {submitting && check && (
        <SubmitDialog
          ws={ws.id}
          document={doc}
          yaml={check.yaml}
          baseVersion={info.base_version}
          onClose={() => setSubmitting(false)}
          onSubmitted={onSubmitted}
        />
      )}
    </div>
  );
}

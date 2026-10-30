import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import {
  api,
  UnreachableError,
  type CatalogFilters,
  type CatalogRow,
  type DocumentSummary,
  type Facets,
  type Workspace,
} from "../api";
import { Banner } from "../components/Banner";
import { Icon } from "../components/Icon";
import { ago, convergence, KIND_LABELS, percent, STATUS_LABELS } from "../format";
import { explain, type Explained } from "../messages";
import { href, setParams, type Params } from "../router";

const SEARCH_DELAY_MS = 200;
const SKELETON_ROWS = 5;

type Filter = Exclude<keyof CatalogFilters, "q">;

const FILTERS: { key: Filter; label: string; all: string }[] = [
  { key: "domain", label: "Domaine", all: "Tous" },
  { key: "owner", label: "Propriétaire", all: "Tous" },
  { key: "status", label: "Statut", all: "Tous" },
  { key: "kind", label: "Type", all: "Concept + KPI" },
];

type Preview = { kind: "loading" } | { kind: "ready"; summary: DocumentSummary } | { kind: "error"; error: Explained };

// Catalogue (guide 10.1) : recherche, filtres, tableau et aperçu. L'état des filtres vit
// dans l'adresse : le retour arrière les restaure.
export function Catalogue({
  ws,
  params,
  heading,
}: {
  ws: Workspace;
  params: Params;
  heading: RefObject<HTMLHeadingElement>;
}) {
  const filters: CatalogFilters = {
    q: params.q ?? "",
    domain: params.domain ?? "",
    owner: params.owner ?? "",
    status: params.status ?? "",
    kind: params.kind ?? "",
  };
  const selected = params.sel ?? "";
  const filtered = Object.values(filters).some((value) => value !== "");

  const [text, setText] = useState(filters.q);
  const [rows, setRows] = useState<CatalogRow[] | null>(null);
  const [error, setError] = useState<Explained | null>(null);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const links = useRef(new Map<string, HTMLAnchorElement>());

  // L'adresse a changé (retour arrière) : le champ suit.
  useEffect(() => setText(filters.q), [filters.q]);

  // Recherche à la frappe, temporisée ; elle remplace l'entrée d'historique au lieu d'en ajouter.
  useEffect(() => {
    if (text === filters.q) return;
    const timer = setTimeout(() => setParams({ q: text }, { push: false }), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text, filters.q]);

  useEffect(() => {
    let alive = true;
    // Demandé avant le catalogue : la lecture du catalogue reconstruit l'index.
    api
      .indexState(ws.id)
      .then((state) => alive && setRebuilding(!state.fresh))
      .catch(() => alive && setRebuilding(false));
    api
      .facets(ws.id)
      .then((found) => alive && setFacets(found))
      .catch(() => alive && setFacets(null)); // filtres réduits à « Tous »
    return () => {
      alive = false;
    };
  }, [ws.id]);

  const { q, domain, owner, status, kind } = filters;
  useEffect(() => {
    let alive = true;
    api
      .catalog(ws.id, { q, domain, owner, status, kind })
      .then((found) => {
        if (!alive) return;
        setRows(found);
        setError(null);
        setRebuilding(false);
      })
      .catch((reason) => {
        // Serveur injoignable : le bandeau de la coque suffit.
        if (alive && !(reason instanceof UnreachableError)) setError(explain(reason));
      });
    return () => {
      alive = false;
    };
  }, [ws.id, q, domain, owner, status, kind]);

  const shown = rows !== null && rows.some((row) => row.id === selected) ? selected : "";
  useEffect(() => {
    if (!shown) {
      setPreview(null);
      return;
    }
    let alive = true;
    setPreview({ kind: "loading" });
    api
      .summary(ws.id, shown)
      .then((summary) => alive && setPreview({ kind: "ready", summary }))
      .catch((reason) => alive && setPreview({ kind: "error", error: explain(reason) }));
    return () => {
      alive = false;
    };
  }, [ws.id, shown]);

  const select = (id: string) => setParams({ sel: id }, { push: false });

  // Flèches : ligne précédente ou suivante (le focus sélectionne) ; Entrée ouvre la fiche.
  const onRowKey = (event: KeyboardEvent<HTMLAnchorElement>, index: number) => {
    if (!rows) return;
    const target = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: rows.length - 1 }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    const row = rows[Math.max(0, Math.min(rows.length - 1, target))];
    links.current.get(row.id)?.focus();
  };

  const domainLabel = (value: string | null) =>
    value === null ? "—" : (facets?.domain.find((facet) => facet.value === value)?.label ?? value);
  const options = (key: Filter) => {
    if (key === "domain" || key === "owner") return facets?.[key] ?? [];
    const labels = key === "status" ? STATUS_LABELS : KIND_LABELS;
    return (facets?.[key] ?? []).map((value) => ({ value, label: labels[value] ?? value }));
  };
  const focusable = shown || rows?.[0]?.id;

  return (
    <>
      <div className="main-head">
        <h1 ref={heading} tabIndex={-1}>
          Catalogue
        </h1>
        {ws.role !== "lecteur" && (
          <a className="btn btn-primary" href={href.editor(ws.id)}>
            <Icon name="plus" className="icon-sm" />
            Nouveau concept ou KPI
          </a>
        )}
      </div>

      <div className="filters" role="search">
        <label className="search">
          <Icon name="search" />
          <span className="sr-only">Rechercher dans le catalogue</span>
          <input
            type="search"
            value={text}
            placeholder="Rechercher un concept, un KPI ou un synonyme (CA, revenue…)"
            onChange={(event) => setText(event.target.value)}
          />
        </label>
        {FILTERS.map(({ key, label, all }) => (
          <label key={key} className="filter">
            {label}
            <select value={filters[key]} onChange={(event) => setParams({ [key]: event.target.value }, { push: true })}>
              <option value="">{all}</option>
              {options(key).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
              {filters[key] !== "" && !options(key).some((option) => option.value === filters[key]) && (
                <option value={filters[key]}>{filters[key]}</option>
              )}
            </select>
          </label>
        ))}
      </div>

      {error && (
        <Banner tone="bad" title={error.title}>
          {error.text}
        </Banner>
      )}

      <div className="catalogue">
        <div className="table-wrap">
          <table className="table" aria-label="Concepts et KPI" aria-busy={rows === null}>
            <thead>
              <tr>
                <th scope="col">Nom</th>
                <th scope="col">Type</th>
                <th scope="col">Domaine</th>
                <th scope="col">Version</th>
                <th scope="col">Déclinaisons</th>
                <th scope="col">Convergence</th>
              </tr>
            </thead>
            <tbody>
              {rows === null &&
                Array.from({ length: SKELETON_ROWS }, (_, index) => (
                  <tr key={index} className="skeleton" aria-hidden="true">
                    {Array.from({ length: 6 }, (_, cell) => (
                      <td key={cell}>
                        <span className="skeleton-bar" />
                      </td>
                    ))}
                  </tr>
                ))}
              {rows?.map((row, index) => {
                const state = convergence(row.convergence);
                return (
                  <tr
                    key={row.id}
                    className={row.id === shown ? "row-selected" : undefined}
                    aria-current={row.id === shown ? "true" : undefined}
                    onClick={() => select(row.id)}
                  >
                    <td>
                      <a
                        className="row-link"
                        href={href.document(ws.id, row.id)}
                        tabIndex={row.id === focusable ? 0 : -1}
                        ref={(element) => {
                          if (element) links.current.set(row.id, element);
                          else links.current.delete(row.id);
                        }}
                        onFocus={() => select(row.id)}
                        onKeyDown={(event) => onRowKey(event, index)}
                      >
                        {row.label}
                      </a>
                    </td>
                    <td>
                      <span className={`type type-${row.kind}`}>{KIND_LABELS[row.kind] ?? row.kind}</span>
                    </td>
                    <td>{domainLabel(row.domain)}</td>
                    <td>{row.version === null ? "—" : `v${row.version}`}</td>
                    <td>{row.kind === "kpi" ? row.variant_count : "—"}</td>
                    <td>
                      {state ? (
                        <span className={`convergence tone-${state.tone}`}>
                          <span className="dot" aria-hidden="true" />
                          {state.label}
                        </span>
                      ) : (
                        <span>
                          <span aria-hidden="true">—</span>
                          <span className="sr-only">sans objet pour un concept</span>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows === null && (
            <p className="table-status muted" role="status">
              {rebuilding ? "Reconstruction de l'index de l'espace depuis le dépôt…" : "Chargement du catalogue…"}
            </p>
          )}
          {rows?.length === 0 && (
            <div className="table-empty" role="status">
              {filtered ? (
                <>
                  <strong>Aucun concept ou KPI ne correspond</strong>
                  <span className="muted">Modifiez la recherche ou les filtres.</span>
                </>
              ) : (
                <>
                  <strong>Le catalogue est vide</strong>
                  <span className="muted">Les concepts et KPI du dépôt de l'espace apparaîtront ici.</span>
                </>
              )}
            </div>
          )}
        </div>

        {preview && <PreviewPanel ws={ws.id} preview={preview} domainLabel={domainLabel} />}
      </div>
    </>
  );
}

function PreviewPanel({
  ws,
  preview,
  domainLabel,
}: {
  ws: string;
  preview: Preview;
  domainLabel: (value: string | null) => string;
}) {
  if (preview.kind === "loading") {
    return (
      <aside className="preview" aria-label="Aperçu rapide" aria-busy="true">
        <span className="section-label">Aperçu rapide</span>
        <p className="muted" role="status">
          Chargement de l'aperçu…
        </p>
      </aside>
    );
  }
  if (preview.kind === "error") {
    return (
      <aside className="preview" aria-label="Aperçu rapide">
        <span className="section-label">Aperçu rapide</span>
        <Banner tone="bad" title={preview.error.title}>
          {preview.error.text}
        </Banner>
      </aside>
    );
  }
  const doc = preview.summary;
  const kpi = doc.kind === "kpi";
  const last = doc.last_comparison;
  const meta = [
    doc.domain_label ?? domainLabel(doc.domain),
    doc.version === null ? null : `v${doc.version}`,
    doc.owner ? `propriétaire : ${doc.owner_name ?? doc.owner}` : null,
  ].filter(Boolean);
  return (
    <aside className="preview" aria-labelledby="preview-title">
      <div className="preview-head">
        <span className="section-label">Aperçu rapide</span>
        <h2 id="preview-title" className="preview-title">
          {doc.label}
        </h2>
        <span className="preview-meta">{meta.join(" · ")}</span>
      </div>
      {(doc.description || doc.synonyms.length > 0) && (
        <p className="preview-text">
          {doc.description}
          {doc.synonyms.length > 0 && ` Synonymes : ${doc.synonyms.join(", ")}.`}
        </p>
      )}
      <dl className="facts">
        {kpi && (
          <div>
            <dt>Points de variation</dt>
            <dd>
              {doc.variation_points.length === 0
                ? "Aucun"
                : doc.variation_points.map((point, index) => (
                    <span key={point.node_id}>
                      {index > 0 && " · "}
                      <span className="mono">{point.node_id}</span> {point.label}
                    </span>
                  ))}
            </dd>
          </div>
        )}
        {kpi && (
          <div>
            <dt>Déclinaisons</dt>
            <dd>
              {doc.variants.length === 0
                ? "Aucune"
                : doc.variants
                    .map((variant) => (variant.mode === "from_scratch" ? `${variant.entity} (from scratch)` : variant.entity))
                    .join(" · ")}
            </dd>
          </div>
        )}
        <div>
          <dt>Référencé par</dt>
          <dd>
            {doc.referenced_by.length === 0
              ? "Aucun document"
              : doc.referenced_by.map((reference, index) => (
                  <span key={reference.id}>
                    {index > 0 && ", "}
                    <a href={href.document(ws, reference.id)}>{reference.label}</a>
                  </span>
                ))}
          </dd>
        </div>
        {kpi && (
          <div>
            <dt>Dernière comparaison</dt>
            <dd className={last && last.validation_pct !== null && last.validation_pct < 100 ? "fact-warn" : undefined}>
              {last === null
                ? "Jamais comparé"
                : [
                    last.validation_pct === null ? "sans cellule" : percent(last.validation_pct),
                    last.finished_at ? ago(last.finished_at) : null,
                    last.stale ? `sur la v${last.kpi_version}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
            </dd>
          </div>
        )}
      </dl>
      <a className="btn btn-secondary" href={href.document(ws, doc.id)}>
        Ouvrir la fiche
      </a>
    </aside>
  );
}

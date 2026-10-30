import type { CheckResult, Compiled, Issue } from "../api";
import { Icon } from "../components/Icon";

// Panneau bas (guide 10.3) : Problèmes / Colonnes en sortie / SQL compilé, et à droite
// l'état permanent du document. La sévérité est toujours écrite, pas seulement colorée.

export type BottomTab = "problems" | "columns" | "sql";
export type Dialect = "databricks" | "snowflake";

export const DIALECTS: { value: Dialect; label: string }[] = [
  { value: "databricks", label: "Databricks" },
  { value: "snowflake", label: "Snowflake" },
];

const SEVERITY: Record<Issue["severity"], string> = { error: "ERREUR", warning: "AVERT.", info: "INFO" };

const counted = (issues: Issue[]) => issues.filter((i) => i.severity !== "info").length;

function Status({ check, pending }: { check: CheckResult | null; pending: boolean }) {
  if (!check) return <span className="status-line muted">Validation…</span>;
  const { status } = check;
  const compilable = DIALECTS.filter((d) => status.compilable[d.value]?.status === "ok").map((d) => d.label);
  const items: { ok: boolean; text: string }[] = [
    { ok: status.schema, text: status.schema ? "Schéma valide" : "Schéma invalide" },
    { ok: status.acyclic, text: status.acyclic ? "Sans cycle" : `Cycle ${status.cycle?.join(" → ") ?? ""}` },
    {
      ok: compilable.length === DIALECTS.length,
      text: compilable.length > 0 ? `Compilable ${compilable.join(", ")}` : "Non compilable",
    },
  ];
  return (
    <span className="status-line" role="status" aria-busy={pending}>
      {items.map((item) => (
        <span key={item.text} className={item.ok ? "tone-ok" : "tone-warn"}>
          <Icon name={item.ok ? "check" : "alert"} className="icon-xs" />
          {item.text}
        </span>
      ))}
    </span>
  );
}

function Problems({ issues, onGo }: { issues: Issue[]; onGo: (id: string) => void }) {
  if (issues.length === 0) return <p className="bottom-empty muted">Aucun problème.</p>;
  return (
    <ul className="problems">
      {issues.map((issue, index) => (
        <li key={`${issue.path}-${issue.code}-${index}`} className={`problem problem-${issue.severity}`}>
          <span className={`severity severity-${issue.severity}`}>{SEVERITY[issue.severity]}</span>
          {issue.node_id && <span className="mono muted">{issue.node_id}</span>}
          <span className="problem-text">{issue.message}</span>
          {issue.node_id && (
            <button type="button" className="link-button" aria-label={`Aller au nœud ${issue.node_id}`} onClick={() => onGo(issue.node_id!)}>
              Aller au nœud
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function Sql({ compiled, node, dialect, onDialect }: { compiled?: Compiled; node: string | null; dialect: Dialect; onDialect: (d: Dialect) => void }) {
  let body;
  if (!compiled || compiled.status === "blocked") {
    body = <p className="bottom-empty muted">Le SQL se compile une fois les erreurs corrigées.</p>;
  } else if (compiled.status === "ok") {
    const own = node && compiled.node_sql;
    body = (
      <>
        <p className="bottom-caption muted">
          {own ? `Étape ${node} (CTE du SQL complet)` : node ? `SQL complet (${node} n'a pas de CTE propre : hors du chemin de la sortie)` : "SQL complet"}
        </p>
        <pre className="code" tabIndex={0} aria-label={`SQL ${dialect}`}>
          {own ? compiled.node_sql : compiled.sql}
        </pre>
      </>
    );
  } else {
    body = (
      <p className="bottom-empty tone-warn">
        {compiled.status === "not_compilable" ? "Non compilable" : "Erreur de compilation"}
        {compiled.node_id ? ` (${compiled.node_id})` : ""} : {compiled.reason}
      </p>
    );
  }
  return (
    <>
      <div className="dialects" role="radiogroup" aria-label="Plateforme du SQL">
        {DIALECTS.map((d) => (
          <label key={d.value} className="radio">
            <input type="radio" name="dialect" value={d.value} checked={dialect === d.value} onChange={() => onDialect(d.value)} />
            {d.label}
          </label>
        ))}
      </div>
      {body}
    </>
  );
}

export function BottomPanel({
  check,
  pending,
  tab,
  onTab,
  node,
  dialect,
  onDialect,
  onGo,
}: {
  check: CheckResult | null;
  pending: boolean;
  tab: BottomTab;
  onTab: (tab: BottomTab) => void;
  node: string | null;
  dialect: Dialect;
  onDialect: (d: Dialect) => void;
  onGo: (id: string) => void;
}) {
  const issues = check?.issues ?? [];
  const columns = node ? check?.columns[node] : undefined;
  const tabs: { id: BottomTab; label: string }[] = [
    { id: "problems", label: "Problèmes" },
    { id: "columns", label: node ? `Colonnes en sortie de ${node}` : "Colonnes en sortie" },
    { id: "sql", label: "SQL compilé" },
  ];
  return (
    <section className="bottom" aria-label="Validation du document">
      <div className="bottom-head">
        <div className="panel-tabs" role="tablist" aria-label="Validation">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`bottom-tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls="bottom-panel"
              className="panel-tab"
              onClick={() => onTab(t.id)}
            >
              {t.label}
              {t.id === "problems" && (
                <span className={`tab-count${counted(issues) > 0 ? " tab-count-warn" : ""}`}>{counted(issues)}</span>
              )}
            </button>
          ))}
        </div>
        <Status check={check} pending={pending} />
      </div>
      <div className="bottom-body" id="bottom-panel" role="tabpanel" aria-labelledby={`bottom-tab-${tab}`}>
        {tab === "problems" && <Problems issues={issues} onGo={onGo} />}
        {tab === "columns" &&
          (!node ? (
            <p className="bottom-empty muted">Sélectionner un nœud pour voir ses colonnes.</p>
          ) : columns ? (
            <table className="table table-dense">
              <thead>
                <tr>
                  <th scope="col">Colonne</th>
                  <th scope="col">Type</th>
                </tr>
              </thead>
              <tbody>
                {columns.map(([name, type]) => (
                  <tr key={name}>
                    <td className="mono">{name}</td>
                    <td className="mono">{type ?? "inconnu"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="bottom-empty muted">Colonnes inconnues : le nœud ou ses entrées sont à compléter.</p>
          ))}
        {tab === "sql" && <Sql compiled={check?.status.compilable[dialect]} node={node} dialect={dialect} onDialect={onDialect} />}
      </div>
    </section>
  );
}

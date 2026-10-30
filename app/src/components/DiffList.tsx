import type { DiffReport, Difference } from "../api";
import { plural, type Tone } from "../format";
import type { Mark } from "./GraphView";

// Écarts d'un rapport de diff (plan 0003), dans l'ordre du rapport : classe, gravité,
// message et détail des champs. La couleur suit la gravité, le libellé la répète.

const CLASSIFICATIONS: Record<string, string> = {
  critical: "Divergence critique",
  to_verify: "À examiner",
  cosmetic: "Sans effet",
  override_declared: "Normal · point déclaré",
  override_undeclared: "Hors points déclarés",
  from_scratch: "From scratch",
};

const KINDS: Record<Difference["kind"], string> = {
  modified: "modifié",
  added: "ajouté",
  removed: "retiré",
  reordered: "déplacé",
};

const TONES: Record<Difference["severity"], Tone> = { critical: "bad", warn: "warn", info: "none" };

function value(raw: unknown): string {
  if (raw === null || raw === undefined) return "—";
  return typeof raw === "string" ? raw : JSON.stringify(raw);
}

function nodeOf(difference: Difference): string | null {
  const ref = difference.node_ref;
  if (!ref) return null;
  if (ref.base && ref.other && ref.base !== ref.other) return `${ref.base} → ${ref.other}`;
  return ref.base ?? ref.other;
}

/** Surlignage des nœuds de chaque côté (guide 4, diff) : modifié des deux côtés, retiré
 * à gauche, ajouté à droite. */
export function marksOf(report: DiffReport): { base: Record<string, Mark>; other: Record<string, Mark> } {
  const base: Record<string, Mark> = {};
  const other: Record<string, Mark> = {};
  for (const difference of report.differences) {
    const ref = difference.node_ref;
    if (!ref) continue;
    if (difference.kind === "added" && ref.other) other[ref.other] = "added";
    else if (difference.kind === "removed" && ref.base) base[ref.base] = "removed";
    else {
      if (ref.base) base[ref.base] = "modified";
      if (ref.other) other[ref.other] = "modified";
    }
  }
  return { base, other };
}

export function DiffSummary({ report }: { report: DiffReport }) {
  if (report.identical) return <p>Aucun écart : les deux graphes sont identiques.</p>;
  const { critical = 0, warn = 0, info = 0 } = report.summary.by_severity;
  return (
    <p>
      <strong>{plural(report.differences.length, "écart")}</strong> : {plural(critical, "critique")}, {warn} à surveiller,{" "}
      {info} sans effet.
    </p>
  );
}

export function DiffList({ report }: { report: DiffReport }) {
  return (
    <ol className="diff-list">
      {report.differences.map((difference, index) => {
        const node = nodeOf(difference);
        return (
          <li key={index} className={`diff-item diff-${TONES[difference.severity]}`}>
            <div className="diff-head">
              {node && <span className="mono diff-node">{node}</span>}
              <span className="diff-kind">{KINDS[difference.kind]}</span>
              <span className={`convergence tone-${TONES[difference.severity]}`}>
                <span className="dot" aria-hidden="true" />
                {CLASSIFICATIONS[difference.classification] ?? difference.classification}
              </span>
            </div>
            <p>{difference.message}</p>
            {difference.changes.length > 0 && (
              <details>
                <summary>Détail des champs</summary>
                <ul className="diff-changes mono">
                  {difference.changes.map((change) => (
                    <li key={change.field}>
                      {change.field} : {value(change.before)} → {value(change.after)}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </li>
        );
      })}
    </ol>
  );
}

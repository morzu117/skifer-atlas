import { useEffect, useRef, type UIEvent } from "react";
import type { Difference, DiffReport, GraphLayout } from "../api";
import { DiffList, DiffSummary } from "./DiffList";
import { GraphView, type Mark } from "./GraphView";

// Diff deux colonnes (guide 4, diff ; plans 0014 et 0015) : la référence à gauche, l'autre
// graphe à droite, nœuds marqués et classés, puis la liste textuelle des écarts. Les deux
// graphes partagent couches et rangs : défiler l'un fait défiler l'autre.

type Column = GraphLayout & { label: string };

/** Classification écrite à droite d'un nœud (guide 4, diff). */
function verdict(difference: Difference): string {
  if (difference.classification === "override_declared") return "Normal";
  if (difference.severity === "critical") return "Divergence critique";
  return difference.severity === "warn" ? "À examiner" : "Sans effet";
}

/** Surlignage du diff : la colonne de gauche reste la référence, seul un nœud retiré y est
 * marqué ; à droite, modifié, ajouté ou surchargé sur un point déclaré. */
export function diffMarks(report: DiffReport) {
  const base: Record<string, Mark> = {};
  const other: Record<string, Mark> = {};
  const baseNotes: Record<string, string> = {};
  const otherNotes: Record<string, string> = {};
  for (const difference of report.differences) {
    const ref = difference.node_ref;
    if (!ref) continue;
    if (difference.kind === "removed" && ref.base) {
      base[ref.base] = "removed";
      baseNotes[ref.base] = verdict(difference);
    } else if (ref.other) {
      other[ref.other] =
        difference.kind === "added" ? "added" : difference.classification === "override_declared" ? "overridden" : "modified";
      otherNotes[ref.other] = verdict(difference);
    }
  }
  return { base, other, baseNotes, otherNotes };
}

export function DiffColumns({
  base,
  other,
  report,
  label,
  selected,
}: {
  base: Column | null;
  other: Column;
  report: DiffReport | null;
  label: string;
  selected?: string;
}) {
  const columns = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);

  // Le nœud demandé (« Nœud divergent », 0015) est amené dans la zone visible.
  useEffect(() => {
    if (!selected) return;
    const card = columns.current?.querySelector<HTMLElement>(".graph-card.is-selected");
    card?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [selected, other]);

  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const source = event.target as HTMLElement;
    if (syncing.current || source.tagName !== "FIGURE") return;
    syncing.current = true;
    columns.current?.querySelectorAll<HTMLElement>("figure.graph").forEach((figure) => {
      if (figure !== source) figure.scrollLeft = source.scrollLeft;
    });
    requestAnimationFrame(() => {
      syncing.current = false;
    });
  };

  const marks = report ? diffMarks(report) : null;
  return (
    <section className="proposal-diff" aria-label={label}>
      <div className="diff-columns" ref={columns} onScrollCapture={onScroll}>
        {base && (
          <div className="card diff-column">
            <h3 className="section-label">{base.label}</h3>
            <GraphView layout={base} label={`Graphe : ${base.label}`} marks={marks?.base} notes={marks?.baseNotes} selected={selected} />
          </div>
        )}
        <div className="card diff-column">
          <h3 className="section-label">{other.label}</h3>
          <GraphView layout={other} label={`Graphe : ${other.label}`} marks={marks?.other} notes={marks?.otherNotes} selected={selected} />
        </div>
      </div>
      {report && (
        <div className="card diff">
          <h3 className="section-label">Écarts</h3>
          <DiffSummary report={report} />
          {!report.identical && <DiffList report={report} />}
        </div>
      )}
    </section>
  );
}

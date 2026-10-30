import { useState } from "react";
import type { CheckResult, EditorDocument, Vocabulary } from "../api";
import { Banner } from "../components/Banner";
import { Icon } from "../components/Icon";
import { ChoiceProp, ColumnsProp, InlineChoice, InlineText, RowsProp, TextProp } from "./fields";
import { FORMS } from "./forms";
import {
  ancestors,
  inputsOf,
  NO_INPUT,
  overriddenIds,
  overrideIndex,
  typeInfo,
  variationPoints,
  type Mode,
  type NodeRaw,
  type Op,
  type Raw,
} from "./model";

// Panneau de propriétés 296 px (guide 10.3) : onglets Propriétés / Entrées / YAML du nœud,
// Dupliquer et Supprimer en bas. Sans nœud sélectionné, il porte les propriétés du
// document (libellé, propriétaire, domaine, sémantique…).

type Tab = "props" | "inputs" | "yaml";

const isRaw = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown) => (typeof value === "string" ? value : "");

export type PropertiesProps = {
  doc: Raw;
  mode: Mode;
  canonical: Raw | null;
  node: NodeRaw | null;
  nodes: NodeRaw[];
  output?: string;
  check: CheckResult | null;
  vocabulary: Vocabulary;
  kpis: { value: string; label: string }[];
  info: Pick<EditorDocument, "calendars" | "domains">;
  dispatch: (op: Op) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
};

function Tabs({ tab, onTab, labels }: { tab: Tab; onTab: (tab: Tab) => void; labels: [Tab, string][] }) {
  return (
    <div className="panel-tabs" role="tablist" aria-label="Nœud sélectionné">
      {labels.map(([id, label]) => (
        <button
          key={id}
          type="button"
          role="tab"
          id={`props-tab-${id}`}
          aria-selected={tab === id}
          aria-controls="props-panel"
          className="panel-tab"
          onClick={() => onTab(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Inputs({ node, nodes, set, readOnly }: { node: NodeRaw; nodes: NodeRaw[]; set: (value: unknown) => void; readOnly: boolean }) {
  if (NO_INPUT.includes(node.type)) {
    return <p className="prop-hint">{typeInfo(node.type).label} : une entrée du graphe, sans nœud amont.</p>;
  }
  // Ni le nœud lui-même ni ce qui en dépend : l'arête créerait un cycle.
  const candidates = nodes
    .filter((n) => n.id !== node.id && !ancestors(nodes, n.id).has(node.id))
    .map((n) => ({ value: n.id, label: `${n.id} · ${typeInfo(n.type).label}${text(n.label) ? ` · ${text(n.label)}` : ""}` }));
  if (node.type === "join") {
    const inputs = isRaw(node.inputs) ? node.inputs : {};
    const write = (side: "left" | "right", value: string | undefined) => {
      const next: Raw = { ...inputs, [side]: value };
      const clean: Raw = {};
      for (const key of ["left", "right"]) if (next[key] !== undefined) clean[key] = next[key];
      set(clean);
    };
    return (
      <>
        <ChoiceProp label="Entrée gauche" required mono value={inputs.left} options={candidates} onChange={(v) => write("left", v)} readOnly={readOnly} />
        <ChoiceProp label="Entrée droite" required mono value={inputs.right} options={candidates} onChange={(v) => write("right", v)} readOnly={readOnly} />
      </>
    );
  }
  const current = inputsOf(node);
  if (node.type === "union") {
    const move = (index: number, delta: number) => {
      const next = [...current];
      [next[index], next[index + delta]] = [next[index + delta], next[index]];
      set(next);
    };
    return (
      <>
        <RowsProp
          label="Ordre des entrées"
          required
          addLabel="Ajouter une entrée"
          rows={current}
          readOnly={readOnly}
          onAdd={() => {
            const free = candidates.find((c) => !current.includes(c.value));
            if (free) set([...current, free.value]);
          }}
          onRemove={(index) => {
            const next = current.filter((_, i) => i !== index);
            set(next.length > 0 ? next : undefined);
          }}
          render={(id, index) => (
            <>
              <InlineChoice
                label={`Entrée ${index + 1}`}
                value={id}
                options={candidates.filter((c) => c.value === id || !current.includes(c.value))}
                onChange={(v) => set(current.map((c, i) => (i === index ? v : c)).filter(Boolean))}
                readOnly={readOnly}
              />
              {!readOnly && (
                <>
                  <button type="button" className="icon-button" aria-label={`Monter l'entrée ${id}`} disabled={index === 0} onClick={() => move(index, -1)}>
                    ↑
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Descendre l'entrée ${id}`}
                    disabled={index === current.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    ↓
                  </button>
                </>
              )}
            </>
          )}
        />
      </>
    );
  }
  return (
    <ChoiceProp label="Entrée" required mono value={current[0]} options={candidates} onChange={(v) => set(v ? [v] : undefined)} readOnly={readOnly} />
  );
}

function NodePanel(props: PropertiesProps & { node: NodeRaw }) {
  const { doc, mode, canonical, node, nodes, output, check, dispatch } = props;
  const [tab, setTab] = useState<Tab>("props");
  const info = typeInfo(node.type);
  const overridden = mode === "override" && overriddenIds(doc).includes(node.id);
  const readOnly = mode === "override" && !overridden;
  const declared = canonical ? variationPoints(canonical).includes(node.id) : false;
  const set = (path: (string | number)[], value: unknown) => dispatch({ kind: "set_field", id: node.id, path, value });
  const Form = FORMS[node.type];
  const columns = (id: string | undefined) => (id ? (check?.columns[id] ?? []).map(([n, t]) => [n, t] as [string, string | null]) : []);
  const semantics = isRaw(doc.semantics) ? doc.semantics : isRaw(canonical?.semantics) ? canonical!.semantics as Raw : {};
  const calendar = isRaw(semantics.calendar) ? `${text(semantics.calendar.key)} ${text(semantics.calendar.version)}` : null;
  const index = overrideIndex(doc, node.id);
  const override = index >= 0 && Array.isArray(doc.overrides) ? (doc.overrides[index] as Raw) : null;

  return (
    <>
      <Tabs
        tab={tab}
        onTab={setTab}
        labels={[
          ["props", "Propriétés"],
          ["inputs", "Entrées"],
          ["yaml", "YAML du nœud"],
        ]}
      />
      <div className="props-body" id="props-panel" role="tabpanel" aria-labelledby={`props-tab-${tab}`}>
        <div className="props-title">
          <span className={`palette-swatch family-${info.family}`} aria-hidden="true" />
          <h2>{info.label}</h2>
          <span className="mono muted">{node.id}</span>
        </div>
        {mode === "override" && overridden && !declared && (
          <Banner tone="warn" title="Hors points déclarés : la validation canonique s'appliquera">
            {node.id} n'est pas un point de variation du canonique : le référent du domaine valide la surcharge.
          </Banner>
        )}
        {tab === "props" && (
          <>
            {mode === "override" && overridden && (
              <TextProp
                label="Justification de la surcharge"
                required
                multiline
                value={override?.justification}
                onChange={(v) => dispatch({ kind: "set_doc", path: ["overrides", index, "justification"], value: v })}
              />
            )}
            <TextProp label="Libellé" value={node.label} onChange={(v) => set(["label"], v)} readOnly={readOnly} />
            <TextProp label="Note (pourquoi ce nœud)" multiline value={node.note} onChange={(v) => set(["note"], v)} readOnly={readOnly} />
            {Form && (
              <Form
                node={node}
                set={set}
                columns={columns}
                vocabulary={props.vocabulary}
                kpis={props.kpis}
                calendar={calendar}
                readOnly={readOnly}
              />
            )}
            {mode === "canonical" && doc.kind === "kpi" && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={variationPoints(doc).includes(node.id)}
                  onChange={(event) => dispatch({ kind: "set_variation", id: node.id, on: event.target.checked })}
                />
                Point de variation (surchargeable par les entités)
              </label>
            )}
            {mode === "override" && declared && <p className="prop-hint">Point de variation déclaré par le canonique.</p>}
            {output === node.id ? (
              <p className="prop-hint">Sortie du graphe.</p>
            ) : (
              mode !== "override" && (
                <button type="button" className="btn btn-neutral btn-sm" onClick={() => dispatch({ kind: "set_output", id: node.id })}>
                  Définir comme sortie du graphe
                </button>
              )
            )}
          </>
        )}
        {tab === "inputs" && <Inputs node={node} nodes={nodes} readOnly={readOnly} set={(value) => set(["inputs"], value)} />}
        {tab === "yaml" && (
          <pre className="code" tabIndex={0} aria-label={`YAML de ${node.id}`}>
            {check?.fragments[node.id] ?? ""}
          </pre>
        )}
      </div>
      <div className="props-actions">
        {mode === "override" ? (
          overridden ? (
            <button type="button" className="btn btn-neutral btn-sm" onClick={() => dispatch({ kind: "remove_override", id: node.id })}>
              Retirer la surcharge
            </button>
          ) : (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => dispatch({ kind: "override", id: node.id, node })}>
              Remplacer ce nœud
            </button>
          )
        ) : (
          <>
            <button type="button" className="btn btn-neutral btn-sm" onClick={() => props.onDuplicate(node.id)}>
              Dupliquer
            </button>
            <button type="button" className="btn btn-danger btn-sm" onClick={() => props.onRemove(node.id)}>
              <Icon name="close" className="icon-xs" />
              Supprimer
            </button>
          </>
        )}
      </div>
    </>
  );
}

function DocumentPanel({ doc, mode, dispatch, info, vocabulary }: PropertiesProps) {
  const set = (path: (string | number)[], value: unknown) => dispatch({ kind: "set_doc", path, value });
  const product = isRaw(doc.data_product) ? doc.data_product : {};
  const semantics = isRaw(doc.semantics) ? doc.semantics : {};
  const synonyms = Array.isArray(doc.synonyms) ? (doc.synonyms as string[]) : [];
  const calendars = [{ value: "TODO", label: "À déclarer (TODO)" }, ...info.calendars.map((c) => ({ value: `${c.key}@${c.version}`, label: `${c.key} ${c.version}` }))];
  const calendar = isRaw(semantics.calendar) ? `${text(semantics.calendar.key)}@${text(semantics.calendar.version)}` : text(semantics.calendar);
  const entity = isRaw(doc.entity) ? doc.entity : null;
  const attributes = Array.isArray(entity?.attributes) ? (entity!.attributes as Raw[]) : [];
  const writeSynonyms = (next: string[]) => set(["synonyms"], next.length > 0 ? next : undefined);
  const writeAttributes = (next: Raw[]) => set(["entity", "attributes"], next);

  return (
    <div className="props-body">
      <div className="props-title">
        <h2>Document</h2>
        <span className="mono muted">{text(product.id)}</span>
      </div>
      <p className="prop-hint">Aucun nœud sélectionné : propriétés du document.</p>
      {mode === "canonical" && (
        <>
          <TextProp label="Libellé" required value={doc.label} onChange={(v) => set(["label"], v)} />
          <TextProp label="Description" multiline value={product.description} onChange={(v) => set(["data_product", "description"], v)} />
          <RowsProp
            label="Synonymes"
            addLabel="Ajouter un synonyme"
            rows={synonyms}
            onAdd={() => writeSynonyms([...synonyms, ""])}
            onRemove={(index) => writeSynonyms(synonyms.filter((_, i) => i !== index))}
            render={(value, index) => (
              <InlineText
                label={`Synonyme ${index + 1}`}
                mono={false}
                value={value}
                onChange={(v) => writeSynonyms(synonyms.map((s, i) => (i === index ? v : s)))}
              />
            )}
          />
          <TextProp label="Propriétaire" required value={product.owner} onChange={(v) => set(["data_product", "owner"], v)} />
          <ChoiceProp
            label="Domaine"
            required
            value={product.domain}
            options={info.domains.map((d) => ({ value: d.id, label: d.label }))}
            onChange={(v) => set(["data_product", "domain"], v)}
          />
        </>
      )}
      {doc.kind === "kpi" && (
        <>
          <ChoiceProp
            label="Calendrier"
            required
            value={calendar}
            options={calendars}
            onChange={(v) => {
              if (!v || v === "TODO") return set(["semantics", "calendar"], v);
              const [key, version] = v.split("@");
              set(["semantics", "calendar"], { key, version });
            }}
          />
          <TextProp label="Fuseau horaire" required value={semantics.timezone} placeholder="Europe/Paris" onChange={(v) => set(["semantics", "timezone"], v)} />
          <TextProp label="Devise" value={semantics.currency} placeholder="EUR" onChange={(v) => set(["semantics", "currency"], v)} />
        </>
      )}
      {doc.kind === "concept" && (
        <fieldset className="prop">
          <legend className="prop-label">Entité</legend>
          {entity ? (
            <>
              <RowsProp
                label="Attributs"
                required
                addLabel="Ajouter un attribut"
                rows={attributes}
                onAdd={() => writeAttributes([...attributes, { name: "", type: "string" }])}
                onRemove={(index) => writeAttributes(attributes.filter((_, i) => i !== index))}
                render={(row, index) => (
                  <>
                    <InlineText
                      label={`Nom de l'attribut ${index + 1}`}
                      value={row.name}
                      onChange={(v) => writeAttributes(attributes.map((a, i) => (i === index ? { name: v, type: a.type } : a)))}
                    />
                    <InlineChoice
                      label={`Type de l'attribut ${index + 1}`}
                      value={row.type}
                      options={vocabulary.column_types.map((t) => ({ value: t, label: t }))}
                      onChange={(v) => writeAttributes(attributes.map((a, i) => (i === index ? { name: a.name, type: v } : a)))}
                    />
                  </>
                )}
              />
              <ColumnsProp
                label="Clé"
                required
                value={entity.key}
                options={attributes.map((a) => text(a.name)).filter(Boolean)}
                onChange={(v) => set(["entity", "key"], v)}
              />
            </>
          ) : (
            <button type="button" className="btn btn-neutral btn-sm" onClick={() => set(["entity"], { key: [], attributes: [] })}>
              Déclarer l'entité
            </button>
          )}
        </fieldset>
      )}
      {doc.kind === "variant" && (
        <>
          <p className="prop-hint">
            Déclinaison de <span className="mono">{text((doc.variant_of as Raw | undefined)?.id)}</span> pour l'entité{" "}
            <span className="mono">{text(doc.entity)}</span>.
          </p>
          <TextProp label="Justification de la déclinaison" required multiline value={doc.justification} onChange={(v) => set(["justification"], v)} />
        </>
      )}
      <p className="prop-hint">
        {mode === "override"
          ? "Sélectionner un nœud pour le remplacer. Les surcharges de sémantique se déclarent dans la vue YAML."
          : "Périmètres et tolérance se déclarent dans la vue YAML."}
      </p>
    </div>
  );
}

export function Properties(props: PropertiesProps) {
  return (
    <aside className="props" aria-label="Propriétés">
      {props.node ? <NodePanel key={props.node.id} {...props} node={props.node} /> : <DocumentPanel {...props} />}
    </aside>
  );
}

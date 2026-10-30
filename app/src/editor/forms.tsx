import type { Vocabulary } from "../api";
import {
  ChoiceProp,
  ColumnsProp,
  columnOptions,
  InlineChoice,
  InlineText,
  NumberProp,
  RadioProp,
  RowsProp,
  TextProp,
} from "./fields";
import { inputsOf, type NodeRaw, type Path, type Raw } from "./model";
import { GRAINS } from "./summary";

// Formulaires par type de nœud (guide 5, tableau des champs). Rien d'autre que le
// vocabulaire fermé n'est proposé : opérateurs, fonctions, plateformes et types viennent
// du serveur. Les clés de jointure et toutes les colonnes citées se choisissent parmi les
// colonnes réellement disponibles en amont.

export type FormProps = {
  node: NodeRaw;
  set: (path: Path, value: unknown) => void;
  /** Colonnes en sortie d'un nœud ([] si inconnues). */
  columns: (id: string | undefined) => [string, string | null][];
  vocabulary: Vocabulary;
  kpis: { value: string; label: string }[];
  calendar: string | null;
  readOnly: boolean;
};

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const isRaw = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value);
const names = (columns: [string, string | null][]) => columns.map(([name]) => name);
const opt = (entries: [string, string][]) => entries.map(([value, label]) => ({ value, label }));

const HOW = opt([
  ["inner", "Interne (inner)"],
  ["left", "Gauche (left)"],
  ["right", "Droite (right)"],
  ["full", "Complète (full)"],
  ["cross", "Croisée (cross)"],
  ["left_anti", "Anti-jointure gauche"],
  ["left_semi", "Semi-jointure gauche"],
]);
const ORDER = opt([
  ["asc", "croissant"],
  ["desc", "décroissant"],
]);

/** Une liste à éditer ligne par ligne : chaque modification réécrit la liste entière. */
function rowsOf<T>(value: unknown, set: (rows: T[] | undefined) => void) {
  const rows = list(value) as T[];
  return {
    rows,
    update: (index: number, row: T) => set(rows.map((r, i) => (i === index ? row : r))),
    add: (row: T) => set([...rows, row]),
    remove: (index: number) => {
      const next = rows.filter((_, i) => i !== index);
      set(next.length > 0 ? next : undefined);
    },
  };
}

function SourceForm({ node, set, vocabulary, readOnly }: FormProps) {
  const columns = rowsOf<Raw>(node.columns, (rows) => set(["columns"], rows));
  const types = vocabulary.column_types.map((t) => ({ value: t, label: t }));
  return (
    <>
      <ChoiceProp
        label="Plateforme"
        required
        value={node.platform}
        options={vocabulary.platforms.map((p) => ({ value: p, label: p }))}
        onChange={(v) => set(["platform"], v)}
        readOnly={readOnly}
      />
      <TextProp label="Table" required mono value={node.table} hint="catalogue.schéma.table" onChange={(v) => set(["table"], v)} readOnly={readOnly} />
      <TextProp label="Propriétaire" required value={node.owner} onChange={(v) => set(["owner"], v)} readOnly={readOnly} />
      <RowsProp
        label="Colonnes"
        required
        addLabel="Ajouter une colonne"
        rows={columns.rows}
        readOnly={readOnly}
        onAdd={() => columns.add({ name: "", type: "string" })}
        onRemove={columns.remove}
        render={(row, index) => {
          const change = (key: string, value: string) => {
            const next: Raw = { ...row, [key]: value === "" ? undefined : value };
            if (key === "type" && value !== "date" && value !== "timestamp") {
              delete next.timezone;
              delete next.format;
            }
            const ordered: Raw = {};
            for (const k of ["name", "type", "timezone", "format"]) if (next[k] !== undefined) ordered[k] = next[k];
            columns.update(index, ordered);
          };
          const dated = row.type === "date" || row.type === "timestamp";
          return (
            <>
              <InlineText label={`Nom de la colonne ${index + 1}`} value={row.name} onChange={(v) => change("name", v)} readOnly={readOnly} />
              <InlineChoice label={`Type de la colonne ${index + 1}`} value={row.type} options={types} onChange={(v) => change("type", v)} readOnly={readOnly} />
              {dated && (
                <>
                  <InlineText
                    label={`Fuseau d'origine de la colonne ${index + 1}`}
                    placeholder="Europe/Paris"
                    value={row.timezone}
                    onChange={(v) => change("timezone", v)}
                    readOnly={readOnly}
                  />
                  <InlineText
                    label={`Format de la colonne ${index + 1}`}
                    placeholder="yyyy-MM-dd"
                    value={row.format}
                    onChange={(v) => change("format", v)}
                    readOnly={readOnly}
                  />
                </>
              )}
            </>
          );
        }}
      />
      <TextProp label="Concept rattaché" mono value={node.concept} onChange={(v) => set(["concept"], v)} readOnly={readOnly} />
    </>
  );
}

function parseCondition(condition: unknown): { column: string; operator: string; value: string } {
  const [column = "", operator = "", value = ""] = (typeof condition === "string" ? condition : "").split(":", 3);
  return { column, operator, value };
}

function FilterForm({ node, set, columns, vocabulary, readOnly }: FormProps) {
  const sql = isRaw(node.condition);
  const parts = parseCondition(node.condition);
  const upstream = names(columns(inputsOf(node)[0]));
  const arity = vocabulary.operators.find((o) => o.name === parts.operator)?.arity;
  const write = (next: Partial<typeof parts>) => {
    const { column, operator, value } = { ...parts, ...next };
    const noValue = vocabulary.operators.find((o) => o.name === operator)?.arity === "none";
    if (!column && !operator && !value) set(["condition"], undefined);
    else set(["condition"], noValue || !value ? `${column}:${operator}` : `${column}:${operator}:${value}`);
  };
  return (
    <>
      <RadioProp
        label="Condition"
        value={sql ? "sql" : "simple"}
        options={opt([
          ["simple", "Colonne et opérateur"],
          ["sql", "Expression SQL"],
        ])}
        onChange={(v) => set(["condition"], v === "sql" ? { expr: "" } : undefined)}
        readOnly={readOnly}
      />
      {sql ? (
        <TextProp
          label="Expression"
          required
          mono
          multiline
          value={(node.condition as Raw).expr}
          onChange={(v) => set(["condition"], { expr: v ?? "" })}
          readOnly={readOnly}
        />
      ) : (
        <>
          <ChoiceProp label="Colonne" required mono value={parts.column} options={columnOptions(upstream)} onChange={(v) => write({ column: v ?? "" })} readOnly={readOnly} />
          <ChoiceProp
            label="Opérateur"
            required
            value={parts.operator}
            options={vocabulary.operators.map((o) => ({ value: o.name, label: `${o.label} (${o.name})` }))}
            onChange={(v) => write({ operator: v ?? "" })}
            readOnly={readOnly}
          />
          {arity !== "none" && (
            <TextProp
              label="Valeur"
              required
              value={parts.value}
              hint={arity === "list" ? "Valeurs séparées par des virgules." : undefined}
              onChange={(v) => write({ value: v ?? "" })}
              readOnly={readOnly}
            />
          )}
        </>
      )}
      <RadioProp
        label="Valeurs nulles"
        required
        value={node.nulls}
        options={opt([
          ["keep", "gardées"],
          ["drop", "exclues"],
        ])}
        onChange={(v) => set(["nulls"], v)}
        readOnly={readOnly}
      />
    </>
  );
}

function JoinForm({ node, set, columns, readOnly }: FormProps) {
  const inputs = isRaw(node.inputs) ? node.inputs : {};
  const left = names(columns(typeof inputs.left === "string" ? inputs.left : undefined));
  const right = names(columns(typeof inputs.right === "string" ? inputs.right : undefined));
  const keys = rowsOf<string[]>(node.keys, (rows) => set(["keys"], rows));
  return (
    <>
      <ChoiceProp label="Type de jointure" required value={node.how} options={HOW} onChange={(v) => set(["how"], v)} readOnly={readOnly} />
      <RowsProp
        label="Clés (gauche = droite)"
        required={node.how !== "cross"}
        addLabel="Ajouter une paire de clés"
        rows={keys.rows}
        readOnly={readOnly}
        onAdd={() => keys.add(["", ""])}
        onRemove={keys.remove}
        render={(pair, index) => (
          <>
            <InlineChoice
              label={`Clé gauche ${index + 1}`}
              value={pair[0]}
              options={columnOptions(left)}
              onChange={(v) => keys.update(index, [v, pair[1] ?? ""])}
              readOnly={readOnly}
            />
            <span aria-hidden="true">=</span>
            <InlineChoice
              label={`Clé droite ${index + 1}`}
              value={pair[1]}
              options={columnOptions(right)}
              onChange={(v) => keys.update(index, [pair[0] ?? "", v])}
              readOnly={readOnly}
            />
          </>
        )}
      />
      <RadioProp
        label="Cardinalité attendue"
        required
        value={node.cardinality}
        options={opt([
          ["1:1", "1:1"],
          ["N:1", "N:1"],
          ["1:N", "1:N"],
        ])}
        onChange={(v) => set(["cardinality"], v)}
        readOnly={readOnly}
      />
      <RadioProp
        label="Contrôle de cardinalité"
        required
        value={node.check}
        options={opt([
          ["required", "requis"],
          ["bypass", "contourné"],
        ])}
        onChange={(v) => {
          set(["check"], v);
          if (v === "required") set(["bypass_reason"], undefined);
        }}
        readOnly={readOnly}
      />
      {node.check === "bypass" && (
        <TextProp label="Raison du contournement" required multiline value={node.bypass_reason} onChange={(v) => set(["bypass_reason"], v)} readOnly={readOnly} />
      )}
    </>
  );
}

function UnionForm({ node, set, columns, readOnly }: FormProps) {
  const inputs = inputsOf(node);
  const rows = rowsOf<Raw>(node.columns, (next) => set(["columns"], next));
  return (
    <>
      <RadioProp
        label="Mode"
        required
        value={node.mode}
        options={opt([
          ["all", "toutes les lignes (all)"],
          ["distinct", "sans doublons (distinct)"],
        ])}
        onChange={(v) => set(["mode"], v)}
        readOnly={readOnly}
      />
      <RowsProp
        label="Correspondance des colonnes"
        required
        addLabel="Ajouter une colonne"
        rows={rows.rows}
        readOnly={readOnly}
        onAdd={() => rows.add({ name: "", from: {} })}
        onRemove={rows.remove}
        render={(row, index) => {
          const from = isRaw(row.from) ? row.from : {};
          return (
            <>
              <InlineText label={`Colonne produite ${index + 1}`} value={row.name} onChange={(v) => rows.update(index, { ...row, name: v })} readOnly={readOnly} />
              {inputs.map((input) => (
                <InlineChoice
                  key={input}
                  label={`Colonne de ${input} pour la ligne ${index + 1}`}
                  value={from[input]}
                  options={columnOptions(names(columns(input)))}
                  onChange={(v) => {
                    const next = { ...from, [input]: v === "" ? undefined : v };
                    rows.update(index, { name: row.name, from: Object.fromEntries(Object.entries(next).filter(([, c]) => c !== undefined)) });
                  }}
                  readOnly={readOnly}
                />
              ))}
            </>
          );
        }}
      />
    </>
  );
}

function ComputeForm({ node, set, columns, vocabulary, readOnly }: FormProps) {
  const input = inputsOf(node)[0];
  const upstream = names(columns(input));
  const inferred = columns(node.id).find(([name]) => name === node.column)?.[1];
  return (
    <>
      <TextProp label="Colonne produite" required mono value={node.column} onChange={(v) => set(["column"], v)} readOnly={readOnly} />
      <TextProp label="Expression" required mono multiline value={node.expr} onChange={(v) => set(["expr"], v)} readOnly={readOnly} />
      <div className="prop">
        <span className="prop-label">Colonnes disponibles en entrée{input ? ` (${input})` : ""}</span>
        <span className="prop-columns mono">{upstream.length > 0 ? upstream.join(" · ") : "—"}</span>
      </div>
      <ChoiceProp
        label="Type de la colonne"
        value={node.column_type}
        placeholder={inferred ? `inféré : ${inferred}` : "inféré"}
        options={vocabulary.column_types.map((t) => ({ value: t, label: t }))}
        onChange={(v) => set(["column_type"], v)}
        readOnly={readOnly}
      />
    </>
  );
}

function OrderRows({ value, onChange, upstream, readOnly, label }: { value: unknown; onChange: (rows: string[][] | undefined) => void; upstream: string[]; readOnly: boolean; label: string }) {
  const rows = rowsOf<string[]>(value, onChange);
  return (
    <RowsProp
      label={label}
      required
      addLabel="Ajouter un critère"
      rows={rows.rows}
      readOnly={readOnly}
      onAdd={() => rows.add(["", "desc"])}
      onRemove={rows.remove}
      render={(item, index) => (
        <>
          <InlineChoice label={`Colonne du critère ${index + 1}`} value={item[0]} options={columnOptions(upstream)} onChange={(v) => rows.update(index, [v, item[1] ?? "desc"])} readOnly={readOnly} />
          <InlineChoice label={`Sens du critère ${index + 1}`} value={item[1]} options={ORDER} mono={false} onChange={(v) => rows.update(index, [item[0] ?? "", v])} readOnly={readOnly} />
        </>
      )}
    />
  );
}

function DeduplicateForm({ node, set, columns, readOnly }: FormProps) {
  const upstream = names(columns(inputsOf(node)[0]));
  const keep = isRaw(node.keep) ? node.keep : {};
  return (
    <>
      <ColumnsProp label="Clés" required value={node.keys} options={upstream} onChange={(v) => set(["keys"], v.length ? v : undefined)} readOnly={readOnly} />
      <OrderRows
        label="Ligne gardée : la première selon"
        value={keep.order_by}
        upstream={upstream}
        readOnly={readOnly}
        onChange={(rows) => set(["keep"], rows ? { order_by: rows } : undefined)}
      />
    </>
  );
}

function Measures({ value, onChange, upstream, vocabulary, readOnly }: { value: unknown; onChange: (rows: string[][] | undefined) => void; upstream: string[]; vocabulary: Vocabulary; readOnly: boolean }) {
  const rows = rowsOf<string[]>(value, onChange);
  return (
    <RowsProp
      label="Mesures (source → cible, fonction)"
      required
      addLabel="Ajouter une mesure"
      rows={rows.rows}
      readOnly={readOnly}
      onAdd={() => rows.add(["", "", "sum"])}
      onRemove={rows.remove}
      render={(m, index) => (
        <>
          <InlineChoice
            label={`Colonne source de la mesure ${index + 1}`}
            value={m[0]}
            options={[{ value: "*", label: "* (lignes)" }, ...columnOptions(upstream)]}
            onChange={(v) => rows.update(index, [v, m[1] ?? "", m[2] ?? "sum"])}
            readOnly={readOnly}
          />
          <InlineText label={`Colonne produite par la mesure ${index + 1}`} value={m[1]} onChange={(v) => rows.update(index, [m[0] ?? "", v, m[2] ?? "sum"])} readOnly={readOnly} />
          <InlineChoice
            label={`Fonction de la mesure ${index + 1}`}
            value={m[2]}
            options={vocabulary.aggregates.map((f) => ({ value: f, label: f }))}
            onChange={(v) => rows.update(index, [m[0] ?? "", m[1] ?? "", v])}
            readOnly={readOnly}
          />
        </>
      )}
    />
  );
}

function AggregateForm({ node, set, columns, vocabulary, readOnly }: FormProps) {
  const upstream = names(columns(inputsOf(node)[0]));
  return (
    <>
      <Measures value={node.measures} upstream={upstream} vocabulary={vocabulary} readOnly={readOnly} onChange={(rows) => set(["measures"], rows)} />
      <ColumnsProp label="Granularité (dimensions)" value={node.group_by ?? []} options={upstream} onChange={(v) => set(["group_by"], v)} readOnly={readOnly} />
    </>
  );
}

const OPERATION_FIELDS: Record<string, string[]> = {
  period: ["grain"],
  to_date: ["timezone", "format"],
  convert_timezone: ["to"],
  window: ["function", "frame", "order_by", "partition_by"],
};

function TemporalForm({ node, set, columns, vocabulary, calendar, readOnly }: FormProps) {
  const upstream = names(columns(inputsOf(node)[0]));
  return (
    <>
      <ChoiceProp
        label="Opération"
        required
        value={node.operation}
        options={opt([
          ["period", "Découpage en périodes"],
          ["to_date", "Conversion en date"],
          ["convert_timezone", "Changement de fuseau"],
          ["window", "Fenêtre glissante"],
        ])}
        onChange={(v) => {
          for (const [operation, fields] of Object.entries(OPERATION_FIELDS)) {
            if (operation !== v) fields.forEach((field) => set([field], undefined));
          }
          set(["operation"], v);
        }}
        readOnly={readOnly}
      />
      <ChoiceProp label="Colonne source" required mono value={node.column} options={columnOptions(upstream)} onChange={(v) => set(["column"], v)} readOnly={readOnly} />
      <TextProp label="Colonne produite" required mono value={node.target} onChange={(v) => set(["target"], v)} readOnly={readOnly} />
      {node.operation === "period" && (
        <>
          <ChoiceProp
            label="Grain"
            required
            value={node.grain}
            options={Object.entries(GRAINS).map(([value, label]) => ({ value, label }))}
            onChange={(v) => set(["grain"], v)}
            readOnly={readOnly}
          />
          <p className="prop-hint">
            Calendrier : {calendar ? <span className="mono">{calendar}</span> : "à déclarer dans les propriétés du document"} (sémantique du KPI).
          </p>
        </>
      )}
      {node.operation === "to_date" && (
        <>
          <TextProp label="Fuseau d'évaluation" required value={node.timezone} placeholder="Europe/Paris" onChange={(v) => set(["timezone"], v)} readOnly={readOnly} />
          <TextProp label="Format" mono value={node.format} onChange={(v) => set(["format"], v)} readOnly={readOnly} />
        </>
      )}
      {node.operation === "convert_timezone" && (
        <TextProp label="Fuseau cible" required value={node.to} placeholder="Europe/Paris" onChange={(v) => set(["to"], v)} readOnly={readOnly} />
      )}
      {node.operation === "window" && (
        <>
          <ChoiceProp
            label="Fonction"
            required
            value={node.function}
            options={vocabulary.aggregates.map((f) => ({ value: f, label: f }))}
            onChange={(v) => set(["function"], v)}
            readOnly={readOnly}
          />
          <TextProp label="Fenêtre" required mono value={node.frame} hint="Ex. 3 rows preceding" onChange={(v) => set(["frame"], v)} readOnly={readOnly} />
          <OrderRows label="Ordre" value={node.order_by} upstream={upstream} readOnly={readOnly} onChange={(rows) => set(["order_by"], rows)} />
          <ColumnsProp label="Partition" value={node.partition_by} options={upstream} onChange={(v) => set(["partition_by"], v.length ? v : undefined)} readOnly={readOnly} />
        </>
      )}
    </>
  );
}

function KpiRefForm({ node, set, kpis, readOnly }: FormProps) {
  return (
    <>
      <ChoiceProp label="KPI référencé" required value={node.kpi} options={kpis} onChange={(v) => set(["kpi"], v)} readOnly={readOnly} />
      <NumberProp label="Version" required value={node.version} onChange={(v) => set(["version"], v)} readOnly={readOnly} />
    </>
  );
}

function MetricOpForm({ node, set, columns, vocabulary, readOnly }: FormProps) {
  const upstream = names(columns(inputsOf(node)[0]));
  const metrics = rowsOf<Raw>(node.metrics, (rows) => set(["metrics"], rows));
  const aggregate = isRaw(node.aggregate) ? node.aggregate : {};
  return (
    <>
      <RowsProp
        label="Métriques (nom = expression)"
        required
        addLabel="Ajouter une métrique"
        rows={metrics.rows}
        readOnly={readOnly}
        onAdd={() => metrics.add({ name: "", expr: "" })}
        onRemove={metrics.remove}
        render={(m, index) => (
          <>
            <InlineText label={`Nom de la métrique ${index + 1}`} value={m.name} onChange={(v) => metrics.update(index, { name: v, expr: m.expr })} readOnly={readOnly} />
            <InlineText label={`Expression de la métrique ${index + 1}`} value={m.expr} onChange={(v) => metrics.update(index, { name: m.name, expr: v })} readOnly={readOnly} />
          </>
        )}
      />
      <p className="prop-hint mono">{upstream.join(" · ")}</p>
      <RadioProp
        label="Ordre calcul / agrégation"
        required
        value={node.order}
        options={opt([
          ["aggregate_first", "agréger puis calculer"],
          ["rows_first", "calculer ligne à ligne puis agréger"],
        ])}
        onChange={(v) => {
          set(["order"], v);
          if (v === "aggregate_first") set(["aggregate"], undefined);
        }}
        readOnly={readOnly}
      />
      {node.order === "rows_first" && (
        <>
          <Measures
            value={aggregate.measures}
            upstream={[...upstream, ...metrics.rows.map((m) => String(m.name ?? ""))]}
            vocabulary={vocabulary}
            readOnly={readOnly}
            onChange={(rows) => set(["aggregate"], { group_by: aggregate.group_by ?? [], measures: rows })}
          />
          <ColumnsProp
            label="Granularité de l'agrégation"
            value={aggregate.group_by ?? []}
            options={upstream}
            onChange={(v) => set(["aggregate"], { group_by: v, measures: aggregate.measures })}
            readOnly={readOnly}
          />
        </>
      )}
    </>
  );
}

export const FORMS: Record<string, (props: FormProps) => JSX.Element> = {
  source: SourceForm,
  filter: FilterForm,
  join: JoinForm,
  union: UnionForm,
  compute: ComputeForm,
  deduplicate: DeduplicateForm,
  aggregate: AggregateForm,
  temporal: TemporalForm,
  kpi_ref: KpiRefForm,
  metric_op: MetricOpForm,
};

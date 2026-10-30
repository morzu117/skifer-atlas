import { useId, type ReactNode } from "react";
import { Icon } from "../components/Icon";
import { Select } from "../components/Select";

// Champs compacts du panneau de propriétés (guide 10.3) : libellé au-dessus en 11 px,
// « requis » marqué, valeur en mono pour les noms de colonnes et les expressions.

type Option = { value: string; label: string };

function Label({ text, required, htmlFor }: { text: string; required?: boolean; htmlFor?: string }) {
  return (
    <label className="prop-label" htmlFor={htmlFor}>
      {text}
      {required && <span className="required"> requis</span>}
    </label>
  );
}

export function TextProp({
  label,
  value,
  onChange,
  mono,
  required,
  multiline,
  hint,
  readOnly,
  placeholder,
}: {
  label: string;
  value: unknown;
  onChange: (value: string | undefined) => void;
  mono?: boolean;
  required?: boolean;
  multiline?: boolean;
  hint?: string;
  readOnly?: boolean;
  placeholder?: string;
}) {
  const id = useId();
  const text = typeof value === "string" || typeof value === "number" ? String(value) : "";
  const props = {
    id,
    value: text,
    readOnly,
    placeholder,
    className: `prop-input${mono ? " mono" : ""}`,
    "aria-describedby": hint ? `${id}-hint` : undefined,
    onChange: (event: { target: { value: string } }) => onChange(event.target.value === "" ? undefined : event.target.value),
  };
  return (
    <div className="prop">
      <Label text={label} required={required} htmlFor={id} />
      {multiline ? <textarea rows={2} {...props} /> : <input type="text" {...props} />}
      {hint && (
        <span id={`${id}-hint`} className="prop-hint">
          {hint}
        </span>
      )}
    </div>
  );
}

export function NumberProp({
  label,
  value,
  onChange,
  required,
  readOnly,
}: {
  label: string;
  value: unknown;
  onChange: (value: number | undefined) => void;
  required?: boolean;
  readOnly?: boolean;
}) {
  const id = useId();
  return (
    <div className="prop">
      <Label text={label} required={required} htmlFor={id} />
      <input
        id={id}
        type="number"
        min={1}
        className="prop-input"
        readOnly={readOnly}
        value={typeof value === "number" ? value : ""}
        onChange={(event) => onChange(event.target.value === "" ? undefined : Number(event.target.value))}
      />
    </div>
  );
}

export function ChoiceProp({
  label,
  value,
  options,
  onChange,
  required,
  readOnly,
  placeholder = "Choisir…",
  mono,
}: {
  label: string;
  value: unknown;
  options: Option[];
  onChange: (value: string | undefined) => void;
  required?: boolean;
  readOnly?: boolean;
  placeholder?: string;
  mono?: boolean;
}) {
  const id = useId();
  const current = typeof value === "string" ? value : "";
  // Une valeur qui n'est plus proposée (colonne retirée en amont) reste visible.
  const missing = current && !options.some((o) => o.value === current);
  return (
    <div className="prop">
      <Label text={label} required={required} htmlFor={id} />
      <SelectCompact id={id} value={current} disabled={readOnly} mono={mono} onChange={(v) => onChange(v === "" ? undefined : v)}>
        <option value="">{placeholder}</option>
        {missing && <option value={current}>{current} (absente)</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </SelectCompact>
    </div>
  );
}

export function SelectCompact({
  id,
  value,
  onChange,
  disabled,
  children,
  label,
  mono,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  children: ReactNode;
  label?: string;
  mono?: boolean;
}) {
  return (
    <span className={`select-sm${mono ? " mono" : ""}`}>
      <Select id={id} value={value} disabled={disabled} aria-label={label} onChange={(event) => onChange(event.target.value)}>
        {children}
      </Select>
    </span>
  );
}

export function RadioProp({
  label,
  value,
  options,
  onChange,
  required,
  readOnly,
}: {
  label: string;
  value: unknown;
  options: Option[];
  onChange: (value: string) => void;
  required?: boolean;
  readOnly?: boolean;
}) {
  const name = useId();
  return (
    <fieldset className="prop prop-radios">
      <legend className="prop-label">
        {label}
        {required && <span className="required"> requis</span>}
      </legend>
      <span className="radios">
        {options.map((o) => (
          <label key={o.value} className="radio">
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              disabled={readOnly}
              onChange={() => onChange(o.value)}
            />
            {o.label}
          </label>
        ))}
      </span>
    </fieldset>
  );
}

export function ColumnsProp({
  label,
  value,
  options,
  onChange,
  required,
  readOnly,
}: {
  label: string;
  value: unknown;
  options: string[];
  onChange: (value: string[]) => void;
  required?: boolean;
  readOnly?: boolean;
}) {
  const chosen = Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  const all = [...options, ...chosen.filter((c) => !options.includes(c))];
  return (
    <fieldset className="prop">
      <legend className="prop-label">
        {label}
        {required && <span className="required"> requis</span>}
      </legend>
      {all.length === 0 && <span className="prop-hint">Aucune colonne en amont : relier une entrée.</span>}
      <span className="checks">
        {all.map((column) => (
          <label key={column} className="check mono">
            <input
              type="checkbox"
              checked={chosen.includes(column)}
              disabled={readOnly}
              onChange={(event) =>
                // L'ordre de sélection fait l'ordre du YAML (granularité, clés).
                onChange(event.target.checked ? [...chosen, column] : chosen.filter((c) => c !== column))
              }
            />
            {column}
            {!options.includes(column) && " (absente)"}
          </label>
        ))}
      </span>
    </fieldset>
  );
}

export function RowsProp<T>({
  label,
  rows,
  render,
  onAdd,
  onRemove,
  addLabel,
  required,
  readOnly,
}: {
  label: string;
  rows: T[];
  render: (row: T, index: number) => ReactNode;
  onAdd: () => void;
  onRemove: (index: number) => void;
  addLabel: string;
  required?: boolean;
  readOnly?: boolean;
}) {
  return (
    <fieldset className="prop">
      <legend className="prop-label">
        {label}
        {required && <span className="required"> requis</span>}
      </legend>
      <ol className="rows">
        {rows.map((row, index) => (
          <li key={index} className="row">
            <span className="row-fields">{render(row, index)}</span>
            {!readOnly && (
              <button type="button" className="icon-button" aria-label={`Retirer la ligne ${index + 1} : ${label}`} onClick={() => onRemove(index)}>
                <Icon name="close" className="icon-xs" />
              </button>
            )}
          </li>
        ))}
      </ol>
      {!readOnly && (
        <button type="button" className="btn btn-sm" onClick={onAdd}>
          <Icon name="plus" className="icon-xs" />
          {addLabel}
        </button>
      )}
    </fieldset>
  );
}

/** Champ en ligne d'un tableau de lignes : libellé lu par les lecteurs d'écran seulement. */
export function InlineText({
  label,
  value,
  onChange,
  mono = true,
  readOnly,
  placeholder,
}: {
  label: string;
  value: unknown;
  onChange: (value: string) => void;
  mono?: boolean;
  readOnly?: boolean;
  placeholder?: string;
}) {
  return (
    <input
      type="text"
      aria-label={label}
      className={`prop-input${mono ? " mono" : ""}`}
      value={typeof value === "string" ? value : ""}
      readOnly={readOnly}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export function InlineChoice({
  label,
  value,
  options,
  onChange,
  readOnly,
  mono = true,
}: {
  label: string;
  value: unknown;
  options: Option[];
  onChange: (value: string) => void;
  readOnly?: boolean;
  mono?: boolean;
}) {
  const current = typeof value === "string" ? value : "";
  const missing = current && !options.some((o) => o.value === current);
  return (
    <SelectCompact label={label} value={current} disabled={readOnly} onChange={onChange} mono={mono}>
      <option value="">—</option>
      {missing && <option value={current}>{current} (absente)</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </SelectCompact>
  );
}

export const columnOptions = (columns: string[]): Option[] => columns.map((c) => ({ value: c, label: c }));

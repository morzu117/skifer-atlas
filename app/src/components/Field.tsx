import { cloneElement, type ReactElement } from "react";

// Champ (guide 3.3) : libellé au-dessus, « requis » en rouge, aide ou erreur dessous,
// reliée au champ par aria-describedby.
export function Field({
  label,
  id,
  required,
  error,
  hint,
  children,
}: {
  label: string;
  id: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: ReactElement<Record<string, unknown>>;
}) {
  const help = error ?? hint;
  const helpId = `${id}-help`;
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {required && <span className="required"> requis</span>}
      </label>
      {cloneElement(children, {
        id,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": help ? helpId : undefined,
      })}
      {help && (
        <span id={helpId} className={error ? "field-error" : "field-hint"}>
          {help}
        </span>
      )}
    </div>
  );
}

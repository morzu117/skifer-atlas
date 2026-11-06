import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";

export function Confirmation({ id: providedId, title, description, children, action, busy = false, restoreFocus = true, returnFocusTo, onCancel, onConfirm }: {
  id?: string; title: string; description: ReactNode; children?: ReactNode; action: string; busy?: boolean;
  /** Désactivé si l'appelant gère déjà le focus après fermeture ou réussite. */
  restoreFocus?: boolean; returnFocusTo?: RefObject<HTMLElement>; onCancel: () => void; onConfirm: () => void;
}) {
  const generatedId = useId();
  const id = providedId ?? generatedId;
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    cancel.current?.focus();
    return () => {
      const target = returnFocusTo?.current?.isConnected ? returnFocusTo.current : previous;
      if (restoreFocus && target instanceof HTMLElement && target.isConnected) target.focus();
    };
  }, [restoreFocus, returnFocusTo]);
  return <div id={id} className="confirmation" role="alertdialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-text`}
    onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); if (!busy) onCancel(); } }}>
    <h3 id={`${id}-title`}>{title}</h3>
    <p id={`${id}-text`}>{description}</p>
    {children}
    <div className="confirmation-actions">
      <button ref={cancel} type="button" className="btn btn-neutral btn-sm" disabled={busy} onClick={onCancel}>Annuler</button>
      <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={onConfirm}>{action}</button>
    </div>
  </div>;
}

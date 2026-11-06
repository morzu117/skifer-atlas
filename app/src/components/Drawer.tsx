import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { Icon } from "./Icon";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea, select, [tabindex="0"]';

// Panneau latéral 340 px (formulaires non maquettés, guide 7) : dialogue modal, Échap
// ferme, le focus reste dans le panneau puis revient à l'élément qui l'a ouvert.
// `busy` : un envoi est en vol ; Échap et « Fermer » sont sans effet, pour que la réponse
// n'arrive pas dans un écran que l'utilisateur a déjà quitté (issue 146). « Fermer » reste
// alors focalisable (`aria-disabled`, pas `disabled`) : le panneau garde un élément où poser
// le focus, qui ne s'échappe pas vers la page dessous, et Échap lui parvient toujours.
export function Drawer({
  title,
  onClose,
  busy = false,
  children,
}: {
  title: string;
  onClose: () => void;
  busy?: boolean;
  children: ReactNode;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>("input, textarea, select")?.focus();
    return () => opener?.focus();
  }, []);

  // Un envoi désactive les champs et le bouton qui avaient le focus : on le pose sur « Fermer ».
  useEffect(() => {
    if (!busy) return;
    const active = document.activeElement as HTMLElement | null;
    const lost = !active || !panel.current?.contains(active) || (active as HTMLButtonElement).disabled;
    if (lost) close.current?.focus();
  }, [busy]);

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.stopPropagation();
      if (!busy) onClose();
      return;
    }
    if (event.key !== "Tab" || !panel.current) return;
    const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="drawer-layer">
      <div className="drawer-backdrop" aria-hidden="true" />
      <div
        ref={panel}
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
      >
        <div className="drawer-head">
          <h2 id={titleId}>{title}</h2>
          <button
            ref={close}
            type="button"
            className="btn-icon"
            aria-label="Fermer"
            aria-disabled={busy || undefined}
            onClick={() => {
              if (!busy) onClose();
            }}
          >
            <Icon name="close" className="icon-sm" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

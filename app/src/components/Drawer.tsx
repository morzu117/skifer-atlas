import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { Icon } from "./Icon";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea, select, [tabindex="0"]';

// Panneau latéral 340 px (formulaires non maquettés, guide 7) : dialogue modal, Échap
// ferme, le focus reste dans le panneau puis revient à l'élément qui l'a ouvert.
export function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>("input, textarea, select")?.focus();
    return () => opener?.focus();
  }, []);

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
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
          <button type="button" className="btn-icon" aria-label="Fermer" onClick={onClose}>
            <Icon name="close" className="icon-sm" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

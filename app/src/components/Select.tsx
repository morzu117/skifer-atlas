import type { SelectHTMLAttributes } from "react";
import { Icon } from "./Icon";

// Liste déroulante à la hauteur du guide (44 px). Le rendu natif de WebKit (la vue de
// Tauri sous macOS) ignore la hauteur d'un <select> : l'apparence native est retirée et
// le chevron est dessiné ici.
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="select">
      <select {...props} />
      <Icon name="chevron" className="icon-sm select-chevron" />
    </span>
  );
}

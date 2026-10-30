import { useState, type DragEvent } from "react";
import { Icon } from "../components/Icon";
import { DRAG_TYPE } from "./Canvas";
import { PALETTE, typeInfo, type NodeType } from "./model";

// Palette 196 px (guide 10.3) : recherche, quatre familles, chaque type glissable sur le
// canevas. Un clic (ou Entrée) ajoute le nœud à droite du nœud sélectionné et l'y relie :
// le graphe se construit aussi sans glisser, au clavier comme à la souris.

export function Palette({ onAdd, disabled }: { onAdd: (type: NodeType) => void; disabled: boolean }) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const groups = PALETTE.map((group) => ({
    ...group,
    types: group.types.filter((type) => !needle || typeInfo(type).label.toLowerCase().includes(needle)),
  })).filter((group) => group.types.length > 0);

  const onDragStart = (event: DragEvent, type: NodeType) => {
    event.dataTransfer.setData(DRAG_TYPE, type);
    event.dataTransfer.effectAllowed = "copy";
  };

  return (
    <aside className="palette" aria-label="Palette des nœuds">
      <label className="palette-search">
        <Icon name="search" className="icon-sm" />
        <span className="sr-only">Rechercher un nœud</span>
        <input type="search" placeholder="Nœud…" value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>
      {disabled && <p className="palette-hint">Surcharge : seuls les nœuds existants se remplacent.</p>}
      {groups.map((group) => (
        <div key={group.label} className="palette-group" role="group" aria-label={group.label}>
          <span className="section-label palette-family" aria-hidden="true">
            {group.label}
          </span>
          {group.types.map((type) => {
            const info = typeInfo(type);
            return (
              <button
                key={type}
                type="button"
                className="palette-item"
                draggable={!disabled}
                disabled={disabled}
                onDragStart={(event) => onDragStart(event, type)}
                onClick={() => onAdd(type)}
              >
                <span className={`palette-swatch family-${info.family}`} aria-hidden="true" />
                {info.label}
              </button>
            );
          })}
        </div>
      ))}
      {groups.length === 0 && <p className="palette-hint">Aucun nœud ne correspond.</p>}
    </aside>
  );
}

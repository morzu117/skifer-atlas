import { useRef } from "react";

// Objets de React Flow gardés d'un rendu à l'autre tant que leur contenu ne change pas
// (plan 0024, ADR 0028). React Flow ne recalcule un nœud ou une arête que si l'objet
// change, et un nœud mémoïsé ne se redessine que si ses `data` changent : sans cela,
// déplacer un nœud redessinait les autres à chaque pas. Le contenu se compare en JSON :
// les documents sont recopiés à chaque modification (`apply`), l'identité ne suffit pas.

type Kept<T> = { key: string; item: T };

/** Les éléments dont le contenu n'a pas changé gardent leur objet ; le tableau aussi,
 * si aucun n'a changé. */
export function useStable<T extends { id: string }>(items: T[]): T[] {
  const cache = useRef<{ byId: Map<string, Kept<T>>; list: T[] }>({ byId: new Map(), list: [] });
  const previous = cache.current;
  const byId = new Map<string, Kept<T>>();
  const list = items.map((item) => {
    const key = JSON.stringify(item);
    const old = previous.byId.get(item.id);
    const kept = old && old.key === key ? old : { key, item };
    byId.set(item.id, kept);
    return kept.item;
  });
  const same = list.length === previous.list.length && list.every((item, index) => item === previous.list[index]);
  cache.current = { byId, list: same ? previous.list : list };
  return cache.current.list;
}

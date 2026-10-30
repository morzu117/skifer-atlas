// React Flow mesure ses nœuds : jsdom n'a ni ResizeObserver ni DOMMatrixReadOnly, et ses
// éléments n'ont pas de taille. Recette de la documentation de React Flow (« Testing »).

class ResizeObserver {
  constructor(private readonly callback: (entries: { target: Element; contentRect: DOMRect }[], observer: unknown) => void) {}
  observe(target: Element) {
    this.callback([{ target, contentRect: target.getBoundingClientRect() }], this);
  }
  unobserve() {}
  disconnect() {}
}

class DOMMatrixReadOnly {
  m22: number;
  constructor(transform?: string) {
    const scale = transform?.match(/scale\(([1-9.])\)/)?.[1];
    this.m22 = scale !== undefined ? Number(scale) : 1;
  }
}

/** Posé une fois pour le fichier : `vi.unstubAllGlobals()` ne doit pas le retirer pendant
 * qu'un graphe se démonte. */
export function mockReactFlow() {
  Object.assign(globalThis, { ResizeObserver, DOMMatrixReadOnly });
  Object.defineProperties(HTMLElement.prototype, {
    offsetHeight: { configurable: true, get() { return parseFloat(this.style.height) || 1; } },
    offsetWidth: { configurable: true, get() { return parseFloat(this.style.width) || 1; } },
  });
  (SVGElement.prototype as unknown as { getBBox: () => DOMRect }).getBBox = () =>
    ({ x: 0, y: 0, width: 0, height: 0 }) as DOMRect;
}

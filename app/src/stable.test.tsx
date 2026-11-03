import { renderHook } from "@testing-library/react";
import { StrictMode, Suspense, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { useStable } from "./stable";

// Plan 0024, ADR 0028, issue #48 : `useStable` garde l'objet d'un élément tant que son
// contenu ne change pas, et le tableau si aucun élément n'a changé. Le cache n'est écrit
// qu'une fois le rendu validé : un rendu abandonné ne doit pas le polluer.

type Item = { id: string; label: string; inputs: string[] };

const items = (): Item[] => [
  { id: "a", label: "Source", inputs: [] },
  { id: "b", label: "Calcul", inputs: ["a"] },
  { id: "c", label: "Sortie", inputs: ["b"] },
];

const strict = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;

function identical(wrapper?: (props: { children: ReactNode }) => ReactNode) {
  const first = items();
  const { result, rerender } = renderHook(({ list }) => useStable(list), { initialProps: { list: first }, wrapper });
  const before = result.current;
  rerender({ list: structuredClone(first) });
  expect(result.current).toBe(before);
  result.current.forEach((item, index) => expect(item).toBe(before[index]));
}

function oneChanged(wrapper?: (props: { children: ReactNode }) => ReactNode) {
  const first = items();
  const { result, rerender } = renderHook(({ list }) => useStable(list), { initialProps: { list: first }, wrapper });
  const before = result.current;
  const next = structuredClone(first);
  next[1].label = "Calcul modifié";
  rerender({ list: next });
  expect(result.current).not.toBe(before);
  expect(result.current[0]).toBe(before[0]);
  expect(result.current[1]).not.toBe(before[1]);
  expect(result.current[1].label).toBe("Calcul modifié");
  expect(result.current[2]).toBe(before[2]);
}

describe("useStable", () => {
  it("[S-0024-05] contenu identique recopié : le tableau et chaque élément gardent leur identité", () => {
    identical();
  });

  it("[S-0024-05] un seul élément modifié : lui seul change d'identité, le tableau aussi", () => {
    oneChanged();
  });

  it("[S-0024-05] sous StrictMode, contenu identique recopié : les identités sont gardées", () => {
    identical(strict);
  });

  it("[S-0024-05] sous StrictMode, un seul élément modifié : lui seul change d'identité", () => {
    oneChanged(strict);
  });

  it("[S-0024-05] un rendu abandonné ne pollue pas le cache : l'identité du dernier rendu validé est gardée", () => {
    // Un rendu suspendu est abandonné sans démonter le composant (il garde sa `ref`),
    // contrairement à une erreur rattrapée par un error boundary, qui le démonte.
    const never = new Promise<never>(() => undefined);
    const fallback = ({ children }: { children: ReactNode }) => <Suspense fallback={null}>{children}</Suspense>;
    const first = items();
    const { result, rerender } = renderHook(
      ({ list, suspend }) => {
        const stable = useStable(list);
        if (suspend) throw never;
        return stable;
      },
      { initialProps: { list: first, suspend: false }, wrapper: fallback },
    );
    const validated = result.current;

    const other = structuredClone(first);
    other[0].label = "Source abandonnée";
    other[2].label = "Sortie abandonnée";
    rerender({ list: other, suspend: true });
    expect(result.current).toBe(validated);

    rerender({ list: structuredClone(first), suspend: false });
    expect(result.current).toBe(validated);
    result.current.forEach((item, index) => expect(item).toBe(validated[index]));
  });
});

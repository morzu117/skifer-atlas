import axe from "axe-core";
import { expect } from "vitest";

/** Vérifie les repères et les conteneurs défilants après le chargement de l'écran. */
export async function expectAccessibleLandmarks() {
  const { violations } = await axe.run(document.body, {
    runOnly: { type: "rule", values: ["landmark-unique", "scrollable-region-focusable", "aria-allowed-role"] },
  });
  expect(violations).toEqual([]);
}

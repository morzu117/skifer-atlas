// @vitest-environment node
import { describe, expect, it } from "vitest";
import { summary } from "./summary";

describe("summary", () => {
  it("un type de nœud inconnu garde une carte lisible (la validation le signale)", () => {
    expect(summary({ id: "n03", type: "pivot" } as unknown as Parameters<typeof summary>[0])).toEqual({ main: "pivot", meta: "type inconnu" });
  });
});

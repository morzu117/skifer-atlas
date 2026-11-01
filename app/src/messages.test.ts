import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { explain } from "./messages";

describe("explain", () => {
  it("base occupée par un autre processus : la cause et quoi faire (ADR 0032)", () => {
    const busy = new ApiError(503, "index_busy", "La base de l'espace est ouverte par un autre processus Atlas.");
    expect(explain(busy)).toEqual({
      title: "Base de l'espace occupée",
      text: "Un autre processus Atlas (la ligne de commande, par exemple) utilise la base de cet espace. Réessayez quand il aura fini.",
    });
  });
});

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

  it("[S-0005-12] liste des espaces ou dépôt tenus par un autre processus : la cause et quoi faire (ADR 0039)", () => {
    const registry = new ApiError(503, "registry_busy", "La liste des espaces est en cours de modification par un autre processus Atlas.");
    expect(explain(registry)).toEqual({
      title: "Liste des espaces occupée",
      text: "Un autre processus Atlas (la ligne de commande, par exemple) modifie la liste des espaces. Réessayez dans un instant.",
    });
    const clone = new ApiError(503, "clone_busy", "Une autre opération tient le dépôt de l'espace.");
    expect(explain(clone)).toEqual({
      title: "Espace en cours d'utilisation",
      text: "Une autre opération (une synchronisation dans la ligne de commande, par exemple) utilise le dépôt de cet espace. Réessayez quand elle aura fini.",
    });
  });
});

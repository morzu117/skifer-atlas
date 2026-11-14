import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DRAG_TYPE } from "./Canvas";
import { Palette } from "./Palette";

// Palette (guide 10.3) : recherche, quatre familles, clic ou glisser pour ajouter.

const palette = () => screen.getByRole("complementary", { name: "Palette des nœuds" });

describe("Palette", () => {
  it("présente les quatre familles et ajoute le type cliqué", async () => {
    const onAdd = vi.fn();
    render(<Palette onAdd={onAdd} disabled={false} />);
    expect(within(palette()).getAllByRole("group").map((g) => g.getAttribute("aria-label"))).toEqual(["Entrées", "Lignes", "Combinaison", "Résultat"]);
    await userEvent.click(screen.getByRole("button", { name: "Jointure" }));
    expect(onAdd).toHaveBeenCalledWith("join");
  });

  it("la recherche filtre les types, sans tenir compte de la casse ni des espaces", async () => {
    render(<Palette onAdd={vi.fn()} disabled={false} />);
    await userEvent.type(screen.getByRole("searchbox", { name: "Rechercher un nœud" }), "  AGRÉ ");
    expect(within(palette()).getAllByRole("button").map((b) => b.textContent)).toEqual(["Agrégation"]);
    expect(within(palette()).getAllByRole("group").map((g) => g.getAttribute("aria-label"))).toEqual(["Résultat"]);
    await userEvent.clear(screen.getByRole("searchbox"));
    await userEvent.type(screen.getByRole("searchbox"), "pivot");
    expect(screen.getByText("Aucun nœud ne correspond.")).toBeInTheDocument();
    expect(within(palette()).queryAllByRole("button")).toHaveLength(0);
  });

  it("glisser un type transmet son identifiant au canevas", () => {
    render(<Palette onAdd={vi.fn()} disabled={false} />);
    const data = new Map<string, string>();
    const dataTransfer = { setData: (key: string, value: string) => data.set(key, value), effectAllowed: "" };
    const item = screen.getByRole("button", { name: "Filtre" });
    expect(item).toHaveAttribute("draggable", "true");
    fireEvent.dragStart(item, { dataTransfer });
    expect(data.get(DRAG_TYPE)).toBe("filter");
    expect(dataTransfer.effectAllowed).toBe("copy");
  });

  it("en surcharge, rien ne s'ajoute ni ne se glisse", async () => {
    const onAdd = vi.fn();
    render(<Palette onAdd={onAdd} disabled />);
    expect(screen.getByText("Surcharge : seuls les nœuds existants se remplacent.")).toBeInTheDocument();
    const item = screen.getByRole("button", { name: "Source" });
    expect(item).toBeDisabled();
    expect(item).toHaveAttribute("draggable", "false");
    await userEvent.click(item);
    expect(onAdd).not.toHaveBeenCalled();
  });
});

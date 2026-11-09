import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Properties, type PropertiesProps } from "./Properties";

function props(calendar: unknown, calendars: PropertiesProps["info"]["calendars"] = []): PropertiesProps {
  return {
    doc: { kind: "kpi", semantics: { calendar } }, mode: "canonical", canonical: null,
    node: null, nodes: [], check: null, kpis: [], info: { calendars, domains: [] },
    vocabulary: { operators: [], aggregates: [], platforms: [], column_types: [] },
    dispatch: vi.fn(), onDuplicate: vi.fn(), onRemove: vi.fn(),
  };
}

describe("calendrier des propriétés", () => {
  it("[S-0033-11] propose civil dans un espace vide et écrit une référence sans version", () => {
    const p = props("TODO");
    render(<Properties {...p} />);
    const select = screen.getByLabelText(/^Calendrier/);
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["Choisir…", "À déclarer (TODO)", "civil"]);
    fireEvent.change(select, { target: { value: "civil" } });
    expect(p.dispatch).toHaveBeenCalledWith({ kind: "set_doc", path: ["semantics", "calendar"], value: { key: "civil" } });
  });

  it("[S-0033-11] relit civil, ignore le fichier homonyme et conserve les calendriers versionnés", () => {
    const p = props({ key: "civil" }, [{ key: "civil", version: "1" }, { key: "fiscal", version: "2026.1" }]);
    const view = render(<Properties {...p} />);
    const select = screen.getByLabelText(/^Calendrier/);
    expect(select).toHaveValue("civil");
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["Choisir…", "À déclarer (TODO)", "civil", "fiscal 2026.1"]);
    fireEvent.change(select, { target: { value: "fiscal@2026.1" } });
    expect(p.dispatch).toHaveBeenCalledWith({ kind: "set_doc", path: ["semantics", "calendar"], value: { key: "fiscal", version: "2026.1" } });
    view.rerender(<Properties {...props({ key: "fiscal", version: "2026.1" }, p.info.calendars)} />);
    expect(select).toHaveValue("fiscal@2026.1");
  });

  it("[S-0033-11] affiche civil sans version dans un nœud temporel", () => {
    const p = props({ key: "civil" });
    p.node = { id: "n01", type: "temporal", operation: "period" };
    render(<Properties {...p} />);
    expect(screen.getByText("civil", { selector: "span" })).toHaveTextContent(/^civil$/);
    expect(screen.getByText(/Calendrier :/)).toHaveTextContent("Calendrier : civil (sémantique du KPI).");
  });
});

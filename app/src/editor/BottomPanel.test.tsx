import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { CheckResult } from "../api";
import { BottomPanel } from "./BottomPanel";

it("présente sans alerte un concept sans graphe, y compris dans l'onglet SQL", () => {
  const check: CheckResult = {
    yaml: "", fragments: {}, issues: [], columns: {}, submittable: true,
    status: { schema: true, acyclic: true, cycle: null, compilable: {
      databricks: { status: "not_applicable" }, snowflake: { status: "not_applicable" },
    } },
  };
  const props = { check, pending: false, tab: "problems" as const, onTab: vi.fn(), node: null,
    dialect: "databricks" as const, onDialect: vi.fn(), onGo: vi.fn() };
  const { rerender } = render(<BottomPanel {...props} />);
  const status = screen.getByText("Sans graphe : compilation non applicable");
  expect(status).toHaveClass("muted");
  expect(status).not.toHaveClass("tone-warn");
  fireEvent.click(screen.getByRole("tab", { name: "SQL compilé" }));
  rerender(<BottomPanel {...props} tab="sql" />);
  expect(screen.getByText("Sans graphe : compilation non applicable.")).toHaveClass("muted");
  expect(screen.queryByText("Non compilable")).not.toBeInTheDocument();
});

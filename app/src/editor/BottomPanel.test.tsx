import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CheckResult, Compiled, Issue } from "../api";
import { BottomPanel, type BottomTab } from "./BottomPanel";

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

// Panneau bas (guide 10.3) : Problèmes / Colonnes en sortie / SQL compilé, et l'état
// permanent du document à droite. La sévérité est écrite, pas seulement colorée.

const OK: Compiled = { status: "ok", sql: "WITH n01 AS (...) SELECT * FROM n02", node_sql: null };

function result(overrides: Partial<CheckResult> = {}, status: Partial<CheckResult["status"]> = {}): CheckResult {
  return {
    yaml: "", fragments: {}, issues: [], submittable: true,
    columns: { n02: [["statut", "string"], ["montant", null]] },
    ...overrides,
    status: { schema: true, acyclic: true, cycle: null, compilable: { databricks: OK, snowflake: OK }, ...status },
  };
}

function panel(check: CheckResult | null, extra: { tab?: BottomTab; node?: string | null; pending?: boolean; dialect?: "databricks" | "snowflake" } = {}) {
  const props = { onTab: vi.fn(), onDialect: vi.fn(), onGo: vi.fn() };
  render(
    <BottomPanel check={check} pending={extra.pending ?? false} tab={extra.tab ?? "problems"} node={extra.node ?? null}
      dialect={extra.dialect ?? "databricks"} {...props} />,
  );
  return props;
}

const ISSUES: Issue[] = [
  { path: "/graph/nodes/1/nulls", node_id: "n02", code: "missing_field", message: "« nulls » est requis.", severity: "error" },
  { path: "/graph/nodes/3", node_id: "n04", code: "bypass", message: "Contrôle de cardinalité contourné.", severity: "warning" },
  { path: "/semantics", node_id: null, code: "calendar_todo", message: "Calendrier à déclarer.", severity: "info" },
];

describe("état permanent du document", () => {
  it("avant la première réponse : « Validation… »", () => {
    panel(null);
    expect(screen.getByText("Validation…")).toBeInTheDocument();
    expect(screen.getByText("Aucun problème.")).toBeInTheDocument();
  });

  it("document valide : schéma, sans cycle, compilable sur les deux plateformes, en ton positif", () => {
    panel(result(), { pending: true });
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect([...status.children].map((c) => [c.textContent, c.className])).toEqual([
      ["Schéma valide", "tone-ok"],
      ["Sans cycle", "tone-ok"],
      ["Compilable Databricks, Snowflake", "tone-ok"],
    ]);
  });

  it("schéma invalide, cycle nommé, compilable sur une seule plateforme : en avertissement", () => {
    panel(result({}, { schema: false, acyclic: false, cycle: ["n02", "n03", "n02"], compilable: { databricks: OK, snowflake: { status: "blocked" } } }));
    expect([...screen.getByRole("status").children].map((c) => [c.textContent, c.className])).toEqual([
      ["Schéma invalide", "tone-warn"],
      ["Cycle n02 → n03 → n02", "tone-warn"],
      ["Compilable Databricks", "tone-warn"],
    ]);
  });

  it("aucune plateforme : « Non compilable »", () => {
    panel(result({}, { compilable: { databricks: { status: "blocked" }, snowflake: { status: "error", node_id: null, reason: "x" } } }));
    expect(screen.getByText("Non compilable")).toHaveClass("tone-warn");
  });
});

describe("onglet Problèmes", () => {
  it("compte erreurs et avertissements, pas les informations ; sévérité écrite ; « Aller au nœud »", () => {
    const { onGo } = panel(result({ issues: ISSUES }));
    const tab = screen.getByRole("tab", { name: /Problèmes/ });
    expect(tab).toHaveAttribute("aria-selected", "true");
    expect(within(tab).getByText("2")).toHaveClass("tab-count", "tab-count-warn");
    const rows = screen.getAllByRole("listitem");
    expect(rows.map((r) => r.className)).toEqual(["problem problem-error", "problem problem-warning", "problem problem-info"]);
    expect(rows.map((r) => within(r).getAllByText(/^(ERREUR|AVERT\.|INFO)$/)[0].textContent)).toEqual(["ERREUR", "AVERT.", "INFO"]);
    expect(rows[0]).toHaveTextContent("n02« nulls » est requis.");
    expect(within(rows[2]).queryByRole("button")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Aller au nœud n04" }));
    expect(onGo).toHaveBeenCalledWith("n04");
  });

  it("sans erreur ni avertissement, le compteur reste neutre", () => {
    panel(result({ issues: [ISSUES[2]] }));
    const count = within(screen.getByRole("tab", { name: /Problèmes/ })).getByText("0");
    expect(count).not.toHaveClass("tab-count-warn");
  });

  it("chaque onglet se sélectionne", () => {
    const { onTab } = panel(result());
    fireEvent.click(screen.getByRole("tab", { name: "Colonnes en sortie" }));
    expect(onTab).toHaveBeenLastCalledWith("columns");
    fireEvent.click(screen.getByRole("tab", { name: "SQL compilé" }));
    expect(onTab).toHaveBeenLastCalledWith("sql");
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "bottom-tab-problems");
  });
});

describe("onglet Colonnes en sortie", () => {
  it("sans nœud sélectionné, invite à en choisir un", () => {
    panel(result(), { tab: "columns" });
    expect(screen.getByText("Sélectionner un nœud pour voir ses colonnes.")).toBeInTheDocument();
  });

  it("colonnes du nœud et leur type, « inconnu » quand il n'est pas inféré", () => {
    panel(result(), { tab: "columns", node: "n02" });
    expect(screen.getByRole("tab", { name: "Colonnes en sortie de n02" })).toHaveAttribute("aria-selected", "true");
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows.map((r) => [...r.children].map((c) => c.textContent))).toEqual([["statut", "string"], ["montant", "inconnu"]]);
  });

  it("colonnes inconnues : le nœud ou ses entrées sont à compléter", () => {
    panel(result(), { tab: "columns", node: "n09" });
    expect(screen.getByText("Colonnes inconnues : le nœud ou ses entrées sont à compléter.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

describe("onglet SQL compilé", () => {
  it("SQL complet du dialecte choisi ; changer de plateforme", () => {
    const { onDialect } = panel(result(), { tab: "sql" });
    expect(screen.getByText("SQL complet")).toBeInTheDocument();
    expect(screen.getByLabelText("SQL databricks")).toHaveTextContent(OK.status === "ok" ? OK.sql : "");
    const group = screen.getByRole("radiogroup", { name: "Plateforme du SQL" });
    expect(within(group).getByRole("radio", { name: "Databricks" })).toBeChecked();
    fireEvent.click(within(group).getByRole("radio", { name: "Snowflake" }));
    expect(onDialect).toHaveBeenCalledWith("snowflake");
  });

  it("le nœud sélectionné montre sa CTE quand il en a une", () => {
    panel(result({}, { compilable: { snowflake: { status: "ok", sql: "SELECT *", node_sql: "n02 AS (SELECT statut FROM n01)" } } }), { tab: "sql", node: "n02", dialect: "snowflake" });
    expect(screen.getByText("Étape n02 (CTE du SQL complet)")).toBeInTheDocument();
    expect(screen.getByLabelText("SQL snowflake")).toHaveTextContent("n02 AS (SELECT statut FROM n01)");
  });

  it("un nœud hors du chemin de la sortie montre le SQL complet, en le disant", () => {
    panel(result(), { tab: "sql", node: "n07" });
    expect(screen.getByText("SQL complet (n07 n'a pas de CTE propre : hors du chemin de la sortie)")).toBeInTheDocument();
    expect(screen.getByLabelText("SQL databricks")).toHaveTextContent("SELECT * FROM n02");
  });

  it.each<[string, Compiled | undefined, string]>([
    ["bloqué par des erreurs", { status: "blocked" }, "Le SQL se compile une fois les erreurs corrigées."],
    ["sans réponse pour ce dialecte", undefined, "Le SQL se compile une fois les erreurs corrigées."],
    ["non compilable sur un nœud", { status: "not_compilable", node_id: "n03", reason: "fonction absente sur Snowflake" }, "Non compilable (n03) : fonction absente sur Snowflake"],
    ["en erreur de compilation", { status: "error", node_id: null, reason: "type inconnu" }, "Erreur de compilation : type inconnu"],
  ])("%s", (_, compiled, message) => {
    panel(result({}, { compilable: compiled ? { databricks: compiled } : {} }), { tab: "sql" });
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.queryByLabelText("SQL databricks")).not.toBeInTheDocument();
  });
});

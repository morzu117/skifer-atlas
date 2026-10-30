import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Vocabulary } from "../api";
import { FORMS, type FormProps } from "./forms";
import type { NodeRaw } from "./model";

// Formulaires par type (guide 10.3) : seul le vocabulaire fermé est proposé, les colonnes
// citées se choisissent parmi celles qui arrivent en amont.

const VOCABULARY: Vocabulary = {
  operators: [
    { name: "equals", arity: "single", label: "égal à" },
    { name: "in", arity: "list", label: "dans" },
    { name: "is_null", arity: "none", label: "est nul" },
  ],
  aggregates: ["avg", "count", "sum"],
  platforms: ["databricks", "snowflake"],
  column_types: ["string", "decimal", "date", "timestamp"],
};

const COLUMNS: Record<string, [string, string | null][]> = {
  n01: [
    ["facture_id", "string"],
    ["statut", "string"],
    ["montant", "decimal"],
  ],
  n02: [
    ["date_jour", "date"],
    ["jour_comptable", "date"],
  ],
};

function form(node: Partial<NodeRaw> & Pick<NodeRaw, "id" | "type">, extra: Partial<FormProps> = {}) {
  const set = vi.fn();
  const Form = FORMS[node.type];
  render(
    <Form
      node={node as NodeRaw}
      set={set}
      columns={(id) => (id ? COLUMNS[id] ?? [] : [])}
      vocabulary={VOCABULARY}
      kpis={[{ value: "revenu-net", label: "Revenu net (revenu-net)" }]}
      calendar="fiscal-nordis 2026.1"
      readOnly={false}
      {...extra}
    />,
  );
  return set;
}

const options = (label: string | RegExp) =>
  within(screen.getByLabelText(label))
    .getAllByRole("option")
    .map((o) => o.getAttribute("value"))
    .filter(Boolean);

describe("formulaires par type", () => {
  it("source : plateforme du vocabulaire, colonnes, fuseau seulement pour une date", () => {
    const set = form({ id: "n01", type: "source", columns: [{ name: "d", type: "date", timezone: "Europe/Paris" }] });
    expect(options(/^Plateforme/)).toEqual(["databricks", "snowflake"]);
    expect(screen.getByLabelText("Fuseau d'origine de la colonne 1")).toHaveValue("Europe/Paris");
    fireEvent.change(screen.getByLabelText("Type de la colonne 1"), { target: { value: "string" } });
    expect(set).toHaveBeenLastCalledWith(["columns"], [{ name: "d", type: "string" }]);
    fireEvent.click(screen.getByRole("button", { name: "Ajouter une colonne" }));
    expect(set).toHaveBeenLastCalledWith(["columns"], [{ name: "d", type: "date", timezone: "Europe/Paris" }, { name: "", type: "string" }]);
  });

  it("filtre : colonne amont, opérateur fermé, nulls requis", () => {
    const set = form({ id: "n03", type: "filter", inputs: ["n01"], condition: "statut:equals:validée" });
    expect(options(/^Colonne requis/)).toEqual(["facture_id", "statut", "montant"]);
    expect(screen.getByLabelText(/^Valeur/)).toHaveValue("validée");
    fireEvent.change(screen.getByLabelText(/^Opérateur/), { target: { value: "is_null" } });
    expect(set).toHaveBeenLastCalledWith(["condition"], "statut:is_null");
    fireEvent.click(screen.getByRole("radio", { name: "exclues" }));
    expect(set).toHaveBeenLastCalledWith(["nulls"], "drop");
    expect(within(screen.getByRole("group", { name: /Valeurs nulles/ })).getByText("requis")).toBeInTheDocument();
  });

  it("filtre : une expression SQL remplace la condition simple", () => {
    const set = form({ id: "n03", type: "filter", inputs: ["n01"], condition: { expr: "montant > 0" } });
    expect(screen.getByLabelText(/^Expression requis/)).toHaveValue("montant > 0");
    fireEvent.click(screen.getByRole("radio", { name: "Colonne et opérateur" }));
    expect(set).toHaveBeenLastCalledWith(["condition"], undefined);
  });

  it("jointure : clés prises dans les colonnes de chaque côté (critère 2), raison si contourné", () => {
    const set = form({ id: "n04", type: "join", inputs: { left: "n01", right: "n02" }, keys: [["facture_id", ""]], check: "bypass" });
    expect(options("Clé gauche 1")).toEqual(["facture_id", "statut", "montant"]);
    expect(options("Clé droite 1")).toEqual(["date_jour", "jour_comptable"]);
    fireEvent.change(screen.getByLabelText("Clé droite 1"), { target: { value: "date_jour" } });
    expect(set).toHaveBeenLastCalledWith(["keys"], [["facture_id", "date_jour"]]);
    expect(screen.getByLabelText(/Raison du contournement/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "requis" }));
    expect(set).toHaveBeenCalledWith(["bypass_reason"], undefined);
  });

  it("jointure : une clé disparue en amont reste visible, marquée absente", () => {
    form({ id: "n04", type: "join", inputs: { left: "n01", right: "n02" }, keys: [["ancienne", "date_jour"]] });
    expect(within(screen.getByLabelText("Clé gauche 1")).getByRole("option", { name: "ancienne (absente)" })).toBeInTheDocument();
  });

  it("union : correspondance des colonnes pour chaque entrée", () => {
    const set = form({ id: "n05", type: "union", inputs: ["n01", "n02"], mode: "all", columns: [{ name: "d", from: { n01: "facture_id" } }] });
    expect(options("Colonne de n02 pour la ligne 1")).toEqual(["date_jour", "jour_comptable"]);
    fireEvent.change(screen.getByLabelText("Colonne de n02 pour la ligne 1"), { target: { value: "date_jour" } });
    expect(set).toHaveBeenLastCalledWith(["columns"], [{ name: "d", from: { n01: "facture_id", n02: "date_jour" } }]);
  });

  it("calcul : colonnes disponibles en entrée, type facultatif", () => {
    const set = form({ id: "n06", type: "compute", inputs: ["n01"], column: "ht", expr: "montant / 1.2" });
    expect(screen.getByText("facture_id · statut · montant")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Type de la colonne"), { target: { value: "decimal" } });
    expect(set).toHaveBeenLastCalledWith(["column_type"], "decimal");
  });

  it("dédoublonnage : clés en cases à cocher, ligne gardée ordonnée", () => {
    const set = form({ id: "n07", type: "deduplicate", inputs: ["n01"], keys: ["facture_id"] });
    fireEvent.click(screen.getByRole("checkbox", { name: "statut" }));
    expect(set).toHaveBeenLastCalledWith(["keys"], ["facture_id", "statut"]);
    fireEvent.click(screen.getByRole("button", { name: "Ajouter un critère" }));
    expect(set).toHaveBeenLastCalledWith(["keep"], { order_by: [["", "desc"]] });
  });

  it("agrégation : fonctions du vocabulaire, * pour compter les lignes", () => {
    const set = form({ id: "n08", type: "aggregate", inputs: ["n01"], measures: [["montant", "total", "sum"]] });
    expect(options("Fonction de la mesure 1")).toEqual(["avg", "count", "sum"]);
    expect(options("Colonne source de la mesure 1")).toEqual(["*", "facture_id", "statut", "montant"]);
    fireEvent.click(screen.getByRole("checkbox", { name: "statut" }));
    expect(set).toHaveBeenLastCalledWith(["group_by"], ["statut"]);
  });

  it("temporel : changer d'opération retire les champs de l'ancienne", () => {
    const set = form({ id: "n09", type: "temporal", inputs: ["n02"], operation: "period", column: "date_jour", target: "mois", grain: "month" });
    expect(screen.getByText("fiscal-nordis 2026.1")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Opération/), { target: { value: "convert_timezone" } });
    expect(set).toHaveBeenCalledWith(["grain"], undefined);
    expect(set).toHaveBeenLastCalledWith(["operation"], "convert_timezone");
  });

  it("référence à un KPI : choisie dans le catalogue, avec sa version", () => {
    const set = form({ id: "n10", type: "kpi_ref" });
    expect(options(/^KPI référencé/)).toEqual(["revenu-net"]);
    fireEvent.change(screen.getByLabelText(/Version/), { target: { value: "4" } });
    expect(set).toHaveBeenLastCalledWith(["version"], 4);
  });

  it("opération entre métriques : l'ordre explicite décide de l'agrégation", () => {
    const set = form({ id: "n11", type: "metric_op", inputs: ["n01"], order: "rows_first", metrics: [{ name: "m", expr: "a / b" }] });
    expect(screen.getByText("Mesures (source → cible, fonction)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "agréger puis calculer" }));
    expect(set).toHaveBeenCalledWith(["aggregate"], undefined);
  });

  it("en lecture seule, rien ne s'édite", () => {
    form({ id: "n03", type: "filter", inputs: ["n01"], condition: "statut:equals:x", nulls: "drop" }, { readOnly: true });
    expect(screen.getByLabelText(/^Valeur/)).toHaveAttribute("readonly");
    expect(screen.getByRole("radio", { name: "exclues" })).toBeDisabled();
  });
});

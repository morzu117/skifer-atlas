import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Vocabulary } from "../api";
import { FORMS, type FormProps } from "./forms";
import { apply, nodesOf, type NodeRaw, type Raw } from "./model";

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

/** Formulaire branché sur le modèle : chaque écriture passe par `apply` (set_field). */
function live(start: Partial<NodeRaw> & Pick<NodeRaw, "id" | "type">, extra: Partial<FormProps> = {}) {
  const state = { doc: { graph: { nodes: [start] } } as Raw };
  const Form = FORMS[start.type];
  function Harness() {
    const [doc, setDoc] = useState(state.doc);
    return (
      <Form
        node={nodesOf(doc)[0]}
        set={(path, value) => setDoc((current) => (state.doc = apply(current, { kind: "set_field", id: start.id, path, value })))}
        columns={(id) => (id ? COLUMNS[id] ?? [] : [])}
        vocabulary={VOCABULARY}
        kpis={[{ value: "revenu-net", label: "Revenu net (revenu-net)" }, { value: "marge", label: "Marge (marge)" }]}
        calendar={null}
        readOnly={false}
        {...extra}
      />
    );
  }
  render(<Harness />);
  return { node: () => nodesOf(state.doc)[0] };
}

const pick = (label: string | RegExp, value: string) => userEvent.selectOptions(screen.getByLabelText(label), value);
const write = async (label: string | RegExp, text: string) => {
  await userEvent.clear(screen.getByLabelText(label));
  if (text) await userEvent.type(screen.getByLabelText(label), text);
};
const add = (name: string) => userEvent.click(screen.getByRole("button", { name }));

// Chaque champ de chaque formulaire écrit à son chemin (guide 10.3, tableau des champs).
describe("champs par type, branchés sur le document", () => {
  it("source : plateforme, table, propriétaire, colonnes, concept ; un champ vidé quitte le nœud", async () => {
    const { node } = live({ id: "n01", type: "source" });
    await pick(/^Plateforme/, "snowflake");
    expect(screen.getByLabelText(/^Table/)).toHaveAccessibleDescription("catalogue.schéma.table");
    await write(/^Table/, "gold.finance.factures");
    await write(/^Propriétaire/, "claire.m");
    await write("Concept rattaché", "facture");
    await add("Ajouter une colonne");
    await write("Nom de la colonne 1", "jour");
    await pick("Type de la colonne 1", "date");
    await write("Fuseau d'origine de la colonne 1", "Europe/Paris");
    await write("Format de la colonne 1", "yyyy-MM-dd");
    expect(node()).toEqual({
      id: "n01", type: "source", platform: "snowflake", table: "gold.finance.factures", owner: "claire.m", concept: "facture",
      columns: [{ name: "jour", type: "date", timezone: "Europe/Paris", format: "yyyy-MM-dd" }],
    });
    await write("Concept rattaché", "");
    expect(node()).not.toHaveProperty("concept");
  });

  it("source : une date devenue texte perd fuseau et format, devenue horodatage les garde", async () => {
    const { node } = live({ id: "n01", type: "source", columns: [{ name: "d", type: "date", timezone: "UTC", format: "yyyy" }, { name: "e", type: "date", timezone: "UTC" }] });
    await pick("Type de la colonne 1", "timestamp");
    await pick("Type de la colonne 2", "string");
    expect(node().columns).toEqual([{ name: "d", type: "timestamp", timezone: "UTC", format: "yyyy" }, { name: "e", type: "string" }]);
    expect(screen.queryByLabelText("Fuseau d'origine de la colonne 2")).not.toBeInTheDocument();
    await add("Retirer la ligne 1 : Colonnes");
    await add("Retirer la ligne 1 : Colonnes");
    expect(node()).not.toHaveProperty("columns");
  });

  it("filtre : colonne, opérateur et valeur composent « colonne:opérateur:valeur » ; tout vider retire la condition", async () => {
    const { node } = live({ id: "n03", type: "filter", inputs: ["n01"] });
    await pick(/^Colonne requis/, "statut");
    await pick(/^Opérateur/, "in");
    expect(screen.getByLabelText(/^Valeur/)).toHaveAccessibleDescription("Valeurs séparées par des virgules.");
    await write(/^Valeur/, "FR,DE");
    expect(node().condition).toBe("statut:in:FR,DE");
    await pick(/^Opérateur/, "is_null");
    expect(node().condition).toBe("statut:is_null");
    expect(screen.queryByLabelText(/^Valeur/)).not.toBeInTheDocument();
    await pick(/^Opérateur/, "");
    await pick(/^Colonne requis/, "");
    expect(node()).not.toHaveProperty("condition");
  });

  it("filtre : passer en expression SQL, l'écrire, puis revenir à la condition simple", async () => {
    const { node } = live({ id: "n03", type: "filter", inputs: ["n01"], condition: "statut:equals:x" });
    await userEvent.click(screen.getByRole("radio", { name: "Expression SQL" }));
    expect(node().condition).toEqual({ expr: "" });
    await write(/^Expression requis/, "montant > 0");
    expect(node().condition).toEqual({ expr: "montant > 0" });
    await write(/^Expression requis/, "");
    expect(node().condition).toEqual({ expr: "" });
    await userEvent.click(screen.getByRole("radio", { name: "Colonne et opérateur" }));
    expect(node()).not.toHaveProperty("condition");
    expect(screen.getByLabelText(/^Colonne requis/)).toHaveValue("");
  });

  it("filtre : une condition simple affiche ses trois parties", () => {
    live({ id: "n03", type: "filter", inputs: ["n01"], condition: "montant:equals:12" });
    expect(screen.getByLabelText(/^Colonne requis/)).toHaveValue("montant");
    expect(screen.getByLabelText(/^Opérateur/)).toHaveValue("equals");
    expect(screen.getByLabelText(/^Valeur/)).toHaveValue("12");
  });

  // Le moteur Skifer (schema_loader._normalize_filter_string) découpe en trois au plus :
  // « heure:equals:10:30 » a pour valeur « 10:30 ».
  // bug : forms.tsx:132 découpe avec split(":", 3), qui tronque la valeur ; changer
  // d'opérateur réécrit alors « heure:greater_than:10 » et perd « :30 ».
  it.fails("filtre : une valeur qui contient « : » reste entière quand on change d'opérateur", async () => {
    const { node } = live({ id: "n03", type: "filter", inputs: ["n01"], condition: "heure:equals:10:30" });
    expect(screen.getByLabelText(/^Valeur/)).toHaveValue("10:30");
    await pick(/^Opérateur/, "in");
    expect(node().condition).toBe("heure:in:10:30");
  });

  it("jointure : type, paires de clés, cardinalité, contrôle contourné avec sa raison", async () => {
    const { node } = live({ id: "n04", type: "join", inputs: { left: "n01", right: "n02" } });
    await pick(/^Type de jointure/, "left");
    await add("Ajouter une paire de clés");
    expect(node().keys).toEqual([["", ""]]);
    await pick("Clé gauche 1", "facture_id");
    await pick("Clé droite 1", "jour_comptable");
    await userEvent.click(screen.getByRole("radio", { name: "N:1" }));
    await userEvent.click(screen.getByRole("radio", { name: "contourné" }));
    await write(/^Raison du contournement/, "Doublons connus côté calendrier.");
    expect(node()).toMatchObject({
      how: "left", keys: [["facture_id", "jour_comptable"]], cardinality: "N:1", check: "bypass", bypass_reason: "Doublons connus côté calendrier.",
    });
    await userEvent.click(screen.getByRole("radio", { name: "requis" }));
    expect(node()).not.toHaveProperty("bypass_reason");
    expect(screen.queryByLabelText(/^Raison du contournement/)).not.toBeInTheDocument();
    await add("Retirer la ligne 1 : Clés (gauche = droite)");
    expect(node()).not.toHaveProperty("keys");
  });

  it("union : mode, colonnes produites et correspondance par entrée", async () => {
    const { node } = live({ id: "n05", type: "union", inputs: ["n01", "n02"] });
    await userEvent.click(screen.getByRole("radio", { name: "sans doublons (distinct)" }));
    await add("Ajouter une colonne");
    await write("Colonne produite 1", "ref");
    await pick("Colonne de n01 pour la ligne 1", "facture_id");
    await pick("Colonne de n02 pour la ligne 1", "date_jour");
    expect(node()).toMatchObject({ mode: "distinct", columns: [{ name: "ref", from: { n01: "facture_id", n02: "date_jour" } }] });
    await pick("Colonne de n01 pour la ligne 1", "");
    expect(node().columns).toEqual([{ name: "ref", from: { n02: "date_jour" } }]);
  });

  it("calcul : colonne produite, expression, type inféré proposé par défaut", async () => {
    const { node } = live({ id: "n06", type: "compute", inputs: ["n01"] });
    expect(screen.getByText("Colonnes disponibles en entrée (n01)")).toBeInTheDocument();
    await write(/^Colonne produite/, "ht");
    await write(/^Expression/, "montant / 1.2");
    expect(node()).toMatchObject({ column: "ht", expr: "montant / 1.2" });
    expect(within(screen.getByLabelText("Type de la colonne")).getAllByRole("option")[0]).toHaveTextContent(/^inféré$/);
  });

  it("calcul : le type inféré par la validation s'affiche ; sans entrée, aucune colonne", () => {
    form({ id: "n01", type: "compute", column: "statut" });
    expect(within(screen.getByLabelText("Type de la colonne")).getAllByRole("option")[0]).toHaveTextContent("inféré : string");
    expect(screen.getByText("Colonnes disponibles en entrée")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("dédoublonnage : clés et critères de la ligne gardée, ordonnés ; tout retirer vide le nœud", async () => {
    const { node } = live({ id: "n07", type: "deduplicate", inputs: ["n01"] });
    await userEvent.click(screen.getByRole("checkbox", { name: "facture_id" }));
    await add("Ajouter un critère");
    await pick("Colonne du critère 1", "montant");
    await pick("Sens du critère 1", "asc");
    expect(node()).toMatchObject({ keys: ["facture_id"], keep: { order_by: [["montant", "asc"]] } });
    await userEvent.click(screen.getByRole("checkbox", { name: "facture_id" }));
    await add("Retirer la ligne 1 : Ligne gardée : la première selon");
    expect(node()).not.toHaveProperty("keys");
    expect(node()).not.toHaveProperty("keep");
  });

  it("agrégation : mesure source → cible avec sa fonction, granularité dans l'ordre de sélection", async () => {
    const { node } = live({ id: "n08", type: "aggregate", inputs: ["n01"] });
    await add("Ajouter une mesure");
    expect(node().measures).toEqual([["", "", "sum"]]);
    await pick("Colonne source de la mesure 1", "*");
    await write("Colonne produite par la mesure 1", "n");
    await pick("Fonction de la mesure 1", "count");
    await userEvent.click(screen.getByRole("checkbox", { name: "statut" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "facture_id" }));
    expect(node()).toMatchObject({ measures: [["*", "n", "count"]], group_by: ["statut", "facture_id"] });
    await userEvent.click(screen.getByRole("checkbox", { name: "statut" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "facture_id" }));
    expect(node().group_by).toEqual([]);
  });

  it("temporel : découpage en périodes, colonne source et grain", async () => {
    const { node } = live({ id: "n09", type: "temporal", inputs: ["n02"] });
    await pick(/^Opération/, "period");
    await pick(/^Colonne source/, "date_jour");
    await write(/^Colonne produite/, "mois");
    expect(screen.getByText(/Calendrier :/)).toHaveTextContent("Calendrier : à déclarer dans les propriétés du document (sémantique du KPI).");
    await pick(/^Grain/, "quarter");
    expect(node()).toMatchObject({ operation: "period", column: "date_jour", target: "mois", grain: "quarter" });
  });

  it("temporel : conversion en date avec fuseau et format", async () => {
    const { node } = live({ id: "n09", type: "temporal", inputs: ["n02"], operation: "to_date" });
    await write(/^Fuseau d'évaluation/, "Europe/Paris");
    await write("Format", "dd/MM/yyyy");
    expect(node()).toMatchObject({ timezone: "Europe/Paris", format: "dd/MM/yyyy" });
  });

  it("temporel : changement de fuseau", async () => {
    const { node } = live({ id: "n09", type: "temporal", inputs: ["n02"], operation: "convert_timezone" });
    expect(screen.getByLabelText(/^Fuseau cible/)).toHaveAttribute("placeholder", "Europe/Paris");
    await write(/^Fuseau cible/, "UTC");
    expect(node().to).toBe("UTC");
  });

  it("temporel : fenêtre glissante avec fonction, cadre, ordre et partition ; quitter la fenêtre retire ses champs", async () => {
    const { node } = live({ id: "n09", type: "temporal", inputs: ["n01"], operation: "window" });
    await pick(/^Fonction/, "avg");
    await write(/^Fenêtre/, "ROWS BETWEEN 2 PRECEDING AND CURRENT ROW");
    await add("Ajouter un critère");
    await pick("Colonne du critère 1", "montant");
    await userEvent.click(screen.getByRole("checkbox", { name: "statut" }));
    expect(node()).toMatchObject({
      function: "avg", frame: "ROWS BETWEEN 2 PRECEDING AND CURRENT ROW", order_by: [["montant", "desc"]], partition_by: ["statut"],
    });
    await userEvent.click(screen.getByRole("checkbox", { name: "statut" }));
    expect(node()).not.toHaveProperty("partition_by");
    await pick(/^Opération/, "period");
    expect(node()).toEqual({ id: "n09", type: "temporal", inputs: ["n01"], operation: "period" });
  });

  it("référence à un KPI : KPI du catalogue et version ; une version vidée quitte le nœud", async () => {
    const { node } = live({ id: "n10", type: "kpi_ref" });
    await pick(/^KPI référencé/, "marge");
    await write(/^Version/, "3");
    expect(node()).toMatchObject({ kpi: "marge", version: 3 });
    await write(/^Version/, "");
    expect(node()).not.toHaveProperty("version");
  });

  it("opération entre métriques : métriques nommées, puis agrégation des lignes calculées", async () => {
    const { node } = live({ id: "n11", type: "metric_op", inputs: ["n01"] });
    expect(screen.getByText("facture_id · statut · montant")).toBeInTheDocument();
    await add("Ajouter une métrique");
    await write("Nom de la métrique 1", "ht");
    await write("Expression de la métrique 1", "montant / 1.2");
    await userEvent.click(screen.getByRole("radio", { name: "calculer ligne à ligne puis agréger" }));
    await add("Ajouter une mesure");
    // Les métriques calculées s'agrègent comme les colonnes amont.
    expect(within(screen.getByLabelText("Colonne source de la mesure 1")).getByRole("option", { name: "ht" })).toBeInTheDocument();
    await pick("Colonne source de la mesure 1", "ht");
    await write("Colonne produite par la mesure 1", "total_ht");
    await userEvent.click(screen.getByRole("checkbox", { name: "statut" }));
    expect(node()).toMatchObject({
      metrics: [{ name: "ht", expr: "montant / 1.2" }],
      order: "rows_first",
      aggregate: { group_by: ["statut"], measures: [["ht", "total_ht", "sum"]] },
    });
    await userEvent.click(screen.getByRole("radio", { name: "agréger puis calculer" }));
    expect(node()).not.toHaveProperty("aggregate");
    expect(screen.queryByText("Mesures (source → cible, fonction)")).not.toBeInTheDocument();
  });
});

describe("lecture seule, pour chaque type", () => {
  const FULL: (Partial<NodeRaw> & Pick<NodeRaw, "id" | "type">)[] = [
    { id: "n01", type: "source", columns: [{ name: "d", type: "date" }] },
    { id: "n03", type: "filter", inputs: ["n01"], condition: "statut:equals:x" },
    { id: "n03", type: "filter", inputs: ["n01"], condition: { expr: "a > 0" } },
    { id: "n04", type: "join", inputs: { left: "n01", right: "n02" }, keys: [["facture_id", "date_jour"]], check: "bypass" },
    { id: "n05", type: "union", inputs: ["n01", "n02"], columns: [{ name: "c", from: {} }] },
    { id: "n06", type: "compute", inputs: ["n01"] },
    { id: "n07", type: "deduplicate", inputs: ["n01"], keep: { order_by: [["montant", "desc"]] } },
    { id: "n08", type: "aggregate", inputs: ["n01"], measures: [["montant", "t", "sum"]] },
    { id: "n09", type: "temporal", inputs: ["n01"], operation: "window", order_by: [["montant", "asc"]] },
    { id: "n09", type: "temporal", inputs: ["n01"], operation: "to_date" },
    { id: "n09", type: "temporal", inputs: ["n01"], operation: "convert_timezone" },
    { id: "n10", type: "kpi_ref" },
    { id: "n11", type: "metric_op", inputs: ["n01"], order: "rows_first", metrics: [{ name: "m", expr: "x" }], aggregate: { measures: [["m", "t", "sum"]] } },
  ];

  it.each(FULL.map((n) => [`${n.type}${n.operation ? ` (${String(n.operation)})` : ""}`, n] as const))("%s : aucun champ modifiable, aucun ajout ni retrait", (_, n) => {
    const set = form(n, { readOnly: true });
    const fields = [...document.querySelectorAll("input, select, textarea")] as HTMLInputElement[];
    expect(fields.length).toBeGreaterThan(0);
    for (const field of fields) expect(field.disabled || field.readOnly).toBe(true);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(set).not.toHaveBeenCalled();
  });
});

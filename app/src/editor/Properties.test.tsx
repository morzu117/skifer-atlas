import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { CheckResult, Vocabulary } from "../api";
import { apply, nodesOf, viewNodes, type Mode, type NodeRaw, type NodeType, type Op, type Raw } from "./model";
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

// Panneau de propriétés (guide 10.3) branché sur le vrai modèle : chaque saisie passe par
// `apply`, comme dans l'éditeur, et on lit le document qui en résulte.

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

const COLUMNS: CheckResult["columns"] = {
  n01: [["facture_id", "string"], ["client_id", "string"], ["montant", "decimal"]],
  n02: [["id", "string"], ["pays", "string"]],
  n03: [["code", "string"], ["libelle", "string"]],
};

function check(columns: CheckResult["columns"] = COLUMNS, fragments: Record<string, string> = {}): CheckResult {
  return {
    yaml: "", fragments, issues: [], columns, submittable: true,
    status: { schema: true, acyclic: true, cycle: null, compilable: {} },
  };
}

const KPI_DOC: Raw = {
  schema_version: 1,
  kind: "kpi",
  label: "Revenu net",
  data_product: { id: "revenu-net", owner: "claire.m", domain: "finance", description: "CA facturé" },
  semantics: { calendar: { key: "civil" }, timezone: "Europe/Paris" },
  graph: {
    nodes: [
      { id: "n01", type: "source", platform: "databricks", table: "gold.finance.factures", owner: "claire.m", columns: [{ name: "facture_id", type: "string" }] },
      { id: "n02", type: "source", platform: "databricks", table: "gold.ref.clients", owner: "claire.m" },
      { id: "n03", type: "source", platform: "databricks", table: "gold.ref.pays", owner: "claire.m" },
      { id: "n04", type: "join", inputs: { left: "n01", right: "n02" }, how: "left", keys: [["client_id", "id"]] },
      { id: "n05", type: "filter", inputs: ["n04"], condition: "pays:equals:FR", nulls: "keep" },
    ],
    output: "n05",
  },
};

type Live = { doc: Raw; ops: Op[]; onDuplicate: ReturnType<typeof vi.fn>; onRemove: ReturnType<typeof vi.fn> };

/** Rend le panneau avec un document vivant ; `selected` choisit le nœud affiché. */
function live(document: Raw, options: { selected?: string | null; mode?: Mode; canonical?: Raw | null; check?: CheckResult | null; extra?: Partial<PropertiesProps> } = {}) {
  const state: Live = { doc: document, ops: [], onDuplicate: vi.fn(), onRemove: vi.fn() };
  const mode = options.mode ?? "canonical";
  const canonical = options.canonical ?? null;
  function Harness() {
    const [doc, setDoc] = useState(document);
    const nodes = viewNodes(doc, mode, canonical);
    const graph = (mode === "override" && canonical ? canonical : doc).graph as Raw | undefined;
    return (
      <Properties
        doc={doc}
        mode={mode}
        canonical={canonical}
        node={nodes.find((n) => n.id === options.selected) ?? null}
        nodes={nodes}
        output={typeof graph?.output === "string" ? graph.output : undefined}
        check={options.check === undefined ? check() : options.check}
        vocabulary={VOCABULARY}
        kpis={[{ value: "marge-brute", label: "Marge brute (marge-brute)" }]}
        info={{ calendars: [], domains: [{ id: "finance", label: "Finance" }, { id: "ventes", label: "Ventes" }] }}
        dispatch={(op) => {
          state.ops.push(op);
          setDoc((current) => (state.doc = apply(current, op)));
        }}
        onDuplicate={state.onDuplicate}
        onRemove={state.onRemove}
        {...options.extra}
      />
    );
  }
  render(<Harness />);
  return state;
}

const node = (doc: Raw, id: string) => nodesOf(doc).find((n) => n.id === id) as NodeRaw;
const panel = () => screen.getByRole("complementary", { name: "Propriétés" });
const values = (label: string | RegExp) =>
  within(screen.getByLabelText(label)).getAllByRole("option").map((o) => o.getAttribute("value")).filter(Boolean);
const requiredLabels = () =>
  [...panel().querySelectorAll(".required")].map((mark) => mark.parentElement!.textContent!.replace(/ requis$/, ""));

describe("propriétés du document", () => {
  it("KPI canonique : libellé, description, propriétaire, domaine, fuseau, devise écrits dans le document", async () => {
    const state = live(structuredClone(KPI_DOC));
    expect(within(panel()).getByRole("heading", { name: "Document" })).toBeInTheDocument();
    expect(within(panel()).getByText("revenu-net")).toBeInTheDocument();
    expect(requiredLabels()).toEqual(["Libellé", "Propriétaire", "Domaine", "Calendrier", "Fuseau horaire"]);

    await userEvent.clear(screen.getByLabelText(/^Libellé/));
    await userEvent.type(screen.getByLabelText(/^Libellé/), "Revenu net HT");
    expect(state.doc.label).toBe("Revenu net HT");
    await userEvent.type(screen.getByLabelText("Description"), " et taxes déduites");
    expect((state.doc.data_product as Raw).description).toBe("CA facturé et taxes déduites");
    await userEvent.clear(screen.getByLabelText(/^Propriétaire/));
    await userEvent.type(screen.getByLabelText(/^Propriétaire/), "anna.k");
    expect((state.doc.data_product as Raw).owner).toBe("anna.k");
    expect(values(/^Domaine/)).toEqual(["finance", "ventes"]);
    await userEvent.selectOptions(screen.getByLabelText(/^Domaine/), "ventes");
    expect((state.doc.data_product as Raw).domain).toBe("ventes");
    await userEvent.clear(screen.getByLabelText(/^Fuseau horaire/));
    expect(state.doc.semantics).toEqual({ calendar: { key: "civil" } });
    await userEvent.type(screen.getByLabelText("Devise"), "EUR");
    expect((state.doc.semantics as Raw).currency).toBe("EUR");
    expect(screen.getByText("Périmètres et tolérance se déclarent dans la vue YAML.")).toBeInTheDocument();
  });

  it("vider un champ requis retire la clé : c'est la validation qui signale le manque", async () => {
    const state = live(structuredClone(KPI_DOC));
    await userEvent.clear(screen.getByLabelText(/^Libellé/));
    expect(state.doc).not.toHaveProperty("label");
    await userEvent.selectOptions(screen.getByLabelText(/^Domaine/), "");
    expect(state.doc.data_product).not.toHaveProperty("domain");
  });

  it("synonymes : ajout, saisie, retrait ; la liste vide disparaît du document", async () => {
    const state = live(structuredClone(KPI_DOC));
    await userEvent.click(screen.getByRole("button", { name: "Ajouter un synonyme" }));
    expect(state.doc.synonyms).toEqual([""]);
    await userEvent.type(screen.getByRole("textbox", { name: "Synonyme 1" }), "CA net");
    await userEvent.click(screen.getByRole("button", { name: "Ajouter un synonyme" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Synonyme 2" }), "net revenue");
    expect(state.doc.synonyms).toEqual(["CA net", "net revenue"]);
    await userEvent.click(screen.getByRole("button", { name: "Retirer la ligne 1 : Synonymes" }));
    expect(state.doc.synonyms).toEqual(["net revenue"]);
    expect(screen.getByRole("textbox", { name: "Synonyme 1" })).toHaveValue("net revenue");
    await userEvent.click(screen.getByRole("button", { name: "Retirer la ligne 1 : Synonymes" }));
    expect(state.doc).not.toHaveProperty("synonyms");
  });

  it("calendrier « À déclarer » : le TODO est écrit tel quel", async () => {
    const state = live(structuredClone(KPI_DOC));
    expect(screen.getByLabelText(/^Calendrier/)).toHaveValue("civil");
    await userEvent.selectOptions(screen.getByLabelText(/^Calendrier/), "TODO");
    expect((state.doc.semantics as Raw).calendar).toBe("TODO");
    expect(screen.getByLabelText(/^Calendrier/)).toHaveValue("TODO");
  });

  it("concept : déclarer l'entité, ses attributs typés, puis la clé parmi les attributs", async () => {
    const state = live({ schema_version: 1, kind: "concept", label: "Commande", data_product: { id: "commande", owner: "claire.m", domain: "ventes" } });
    expect(screen.queryByLabelText(/^Calendrier/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Déclarer l'entité" }));
    expect(state.doc.entity).toEqual({ key: [], attributes: [] });
    expect(screen.getByText("Aucune colonne en amont : relier une entrée.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Ajouter un attribut" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Nom de l'attribut 1" }), "commande_id");
    await userEvent.click(screen.getByRole("button", { name: "Ajouter un attribut" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Nom de l'attribut 2" }), "date");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Type de l'attribut 2" }), "date");
    expect((state.doc.entity as Raw).attributes).toEqual([{ name: "commande_id", type: "string" }, { name: "date", type: "date" }]);

    const key = screen.getByRole("group", { name: /^Clé/ });
    expect(within(key).getAllByRole("checkbox").map((c) => c.parentElement!.textContent)).toEqual(["commande_id", "date"]);
    await userEvent.click(within(key).getByRole("checkbox", { name: "commande_id" }));
    expect((state.doc.entity as Raw).key).toEqual(["commande_id"]);

    await userEvent.click(screen.getByRole("button", { name: "Retirer la ligne 2 : Attributs" }));
    expect((state.doc.entity as Raw).attributes).toEqual([{ name: "commande_id", type: "string" }]);
  });

  it("déclinaison indépendante : justification et concepts représentés", async () => {
    const state = live(
      { schema_version: 1, kind: "variant", variant_of: { id: "revenu-net", version: 4 }, entity: "nordis-de", mode: "from_scratch" },
      { mode: "from_scratch" },
    );
    expect(panel()).toHaveTextContent("Déclinaison de revenu-net pour l'entité nordis-de.");
    expect(screen.queryByLabelText(/^Libellé/)).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/^Justification de la déclinaison/), "TVA à 19 %.");
    expect(state.doc.justification).toBe("TVA à 19 %.");
    await userEvent.click(screen.getByRole("button", { name: "Ajouter un concept" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Concept 1" }), "facture");
    expect(state.doc.concepts).toEqual(["facture"]);
    await userEvent.click(screen.getByRole("button", { name: "Retirer la ligne 1 : Concepts représentés" }));
    expect(state.doc.concepts).toEqual([]);
  });

  it("déclinaison en surcharge : ni concepts ni champs du canonique, la vue YAML porte la sémantique", () => {
    live({ kind: "variant", variant_of: { id: "revenu-net" }, entity: "nordis-fr", mode: "override" }, { mode: "override", canonical: structuredClone(KPI_DOC) });
    expect(screen.queryByRole("group", { name: /Concepts représentés/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Propriétaire/)).not.toBeInTheDocument();
    expect(screen.getByText(/Sélectionner un nœud pour le remplacer/)).toBeInTheDocument();
  });

  it("figé pendant une reprise : le panneau devient inerte", () => {
    live(structuredClone(KPI_DOC), { extra: { inert: true } });
    expect(panel()).toHaveAttribute("inert");
  });
});

describe("propriétés d'un nœud", () => {
  it("onglets Propriétés / Entrées / YAML du nœud, YAML venu de la validation", async () => {
    live(structuredClone(KPI_DOC), { selected: "n05", check: check(COLUMNS, { n05: "- id: n05\n  type: filter\n" }) });
    const tabs = within(panel()).getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Propriétés", "Entrées", "YAML du nœud"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "props-tab-props");

    await userEvent.click(screen.getByRole("tab", { name: "YAML du nœud" }));
    expect(screen.getByRole("tab", { name: "YAML du nœud" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("YAML de n05")).toHaveTextContent("- id: n05 type: filter");
    expect(screen.queryByLabelText(/^Libellé/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "Entrées" }));
    expect(screen.getByLabelText(/^Entrée requis/)).toHaveValue("n04");
  });

  it("YAML du nœud vide tant que la validation n'a pas répondu", async () => {
    live(structuredClone(KPI_DOC), { selected: "n05", check: null });
    await userEvent.click(screen.getByRole("tab", { name: "YAML du nœud" }));
    expect(screen.getByLabelText("YAML de n05")).toBeEmptyDOMElement();
  });

  it("libellé et note de tout nœud ; vidés, ils quittent le document", async () => {
    const state = live(structuredClone(KPI_DOC), { selected: "n05" });
    expect(within(panel()).getByRole("heading", { name: "Filtre" })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Libellé"), "France");
    await userEvent.type(screen.getByLabelText("Note (pourquoi ce nœud)"), "Périmètre FR.");
    expect(node(state.doc, "n05")).toMatchObject({ label: "France", note: "Périmètre FR." });
    await userEvent.clear(screen.getByLabelText("Libellé"));
    expect(node(state.doc, "n05")).not.toHaveProperty("label");
  });

  it("point de variation d'un KPI canonique : coché, il s'ajoute à la liste triée", async () => {
    const state = live({ ...structuredClone(KPI_DOC), variation_points: ["n05"] }, { selected: "n04" });
    const box = screen.getByRole("checkbox", { name: "Point de variation (surchargeable par les entités)" });
    expect(box).not.toBeChecked();
    await userEvent.click(box);
    expect(state.doc.variation_points).toEqual(["n04", "n05"]);
    expect(box).toBeChecked();
    await userEvent.click(box);
    expect(state.doc.variation_points).toEqual(["n05"]);
  });

  it("un concept n'a pas de point de variation", () => {
    live({ kind: "concept", graph: { nodes: [{ id: "n01", type: "source" }] } }, { selected: "n01" });
    expect(screen.queryByRole("checkbox", { name: /Point de variation/ })).not.toBeInTheDocument();
  });

  it("sortie du graphe : indiquée sur le nœud de sortie, sinon proposée", async () => {
    const state = live(structuredClone(KPI_DOC), { selected: "n04" });
    await userEvent.click(screen.getByRole("button", { name: "Définir comme sortie du graphe" }));
    expect((state.doc.graph as Raw).output).toBe("n04");
    expect(screen.getByText("Sortie du graphe.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Définir comme sortie du graphe" })).not.toBeInTheDocument();
  });

  it("Dupliquer et Supprimer passent l'identifiant du nœud", async () => {
    const state = live(structuredClone(KPI_DOC), { selected: "n04" });
    await userEvent.click(screen.getByRole("button", { name: "Dupliquer" }));
    expect(state.onDuplicate).toHaveBeenCalledWith("n04");
    await userEvent.click(screen.getByRole("button", { name: "Supprimer" }));
    expect(state.onRemove).toHaveBeenCalledWith("n04");
  });

  // Chaque type a son formulaire (guide 10.3, tableau des champs obligatoires).
  it.each<[NodeType, string, string[]]>([
    ["source", "Source", ["Plateforme", "Table", "Propriétaire", "Colonnes"]],
    ["kpi_ref", "Référence à un KPI", ["KPI référencé", "Version"]],
    ["filter", "Filtre", ["Colonne", "Opérateur", "Valeur", "Valeurs nulles"]],
    ["deduplicate", "Dédoublonnage", ["Clés", "Ligne gardée : la première selon"]],
    ["compute", "Calcul de colonne", ["Colonne produite", "Expression"]],
    ["temporal", "Opération temporelle", ["Opération", "Colonne source", "Colonne produite"]],
    ["join", "Jointure", ["Type de jointure", "Clés (gauche = droite)", "Cardinalité attendue", "Contrôle de cardinalité"]],
    ["union", "Union", ["Mode", "Correspondance des colonnes"]],
    ["aggregate", "Agrégation", ["Mesures (source → cible, fonction)"]],
    ["metric_op", "Opération entre métriques", ["Métriques (nom = expression)", "Ordre calcul / agrégation"]],
  ])("%s : formulaire « %s » et ses champs requis", (type, title, required) => {
    live({ kind: "kpi", graph: { nodes: [{ id: "n09", type }] } }, { selected: "n09" });
    expect(within(panel()).getByRole("heading", { level: 2 })).toHaveTextContent(title);
    expect(requiredLabels()).toEqual(required);
  });

  it("une saisie dans le formulaire du type modifie le nœud du document", async () => {
    const state = live(structuredClone(KPI_DOC), { selected: "n05" });
    await userEvent.selectOptions(screen.getByLabelText(/^Opérateur/), "in");
    expect(node(state.doc, "n05").condition).toBe("pays:in:FR");
    await userEvent.click(screen.getByRole("radio", { name: "exclues" }));
    expect(node(state.doc, "n05").nulls).toBe("drop");
  });
});

describe("clés de jointure parmi les colonnes en amont (guide 10.3)", () => {
  it("chaque côté propose les colonnes de son entrée ; changer d'entrée change les colonnes proposées", async () => {
    const state = live(structuredClone(KPI_DOC), { selected: "n04" });
    expect(values("Clé gauche 1")).toEqual(["facture_id", "client_id", "montant"]);
    expect(values("Clé droite 1")).toEqual(["id", "pays"]);
    await userEvent.selectOptions(screen.getByLabelText("Clé droite 1"), "pays");
    expect(node(state.doc, "n04").keys).toEqual([["client_id", "pays"]]);
    await userEvent.click(screen.getByRole("button", { name: "Ajouter une paire de clés" }));
    await userEvent.selectOptions(screen.getByLabelText("Clé gauche 2"), "facture_id");
    expect(node(state.doc, "n04").keys).toEqual([["client_id", "pays"], ["facture_id", ""]]);

    await userEvent.click(screen.getByRole("tab", { name: "Entrées" }));
    await userEvent.selectOptions(screen.getByLabelText(/^Entrée droite/), "n03");
    expect(node(state.doc, "n04").inputs).toEqual({ left: "n01", right: "n03" });
    await userEvent.click(screen.getByRole("tab", { name: "Propriétés" }));
    expect(values("Clé droite 1")).toEqual(["pays", "code", "libelle"]);
    expect(within(screen.getByLabelText("Clé droite 1")).getByRole("option", { name: "pays (absente)" })).toBeInTheDocument();
  });

  it("sans colonnes connues en amont, aucune clé n'est proposée", () => {
    live(structuredClone(KPI_DOC), { selected: "n04", check: null });
    expect(values("Clé gauche 1")).toEqual(["client_id"]);
    expect(within(screen.getByLabelText("Clé gauche 1")).getByRole("option", { name: "client_id (absente)" })).toBeInTheDocument();
  });

  it("une jointure croisée n'exige pas de clés", async () => {
    const state = live(structuredClone(KPI_DOC), { selected: "n04" });
    expect(screen.getByRole("group", { name: /^Clés \(gauche = droite\)\s*requis$/ })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText(/^Type de jointure/), "cross");
    expect(node(state.doc, "n04").how).toBe("cross");
    expect(screen.getByRole("group", { name: "Clés (gauche = droite)" })).toBeInTheDocument();
  });
});

describe("onglet Entrées", () => {
  it("une source n'a pas d'entrée", async () => {
    live(structuredClone(KPI_DOC), { selected: "n01" });
    await userEvent.click(screen.getByRole("tab", { name: "Entrées" }));
    expect(screen.getByText("Source : une entrée du graphe, sans nœud amont.")).toBeInTheDocument();
  });

  it("entrée unique : ni le nœud lui-même ni ce qui en dépend (pas de cycle) ; vidée, elle quitte le document", async () => {
    const state = live(
      { kind: "kpi", graph: { nodes: [
        { id: "n01", type: "source", label: "Factures" },
        { id: "n02", type: "filter", inputs: ["n01"] },
        { id: "n03", type: "compute", inputs: ["n02"] },
        { id: "n04", type: "source" },
      ] } },
      { selected: "n02" },
    );
    await userEvent.click(screen.getByRole("tab", { name: "Entrées" }));
    const select = screen.getByLabelText(/^Entrée requis/);
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["Choisir…", "n01 · Source · Factures", "n04 · Source"]);
    await userEvent.selectOptions(select, "n04");
    expect(node(state.doc, "n02").inputs).toEqual(["n04"]);
    await userEvent.selectOptions(select, "");
    expect(node(state.doc, "n02")).not.toHaveProperty("inputs");
  });

  it("jointure : retirer un côté garde l'autre", async () => {
    const state = live(structuredClone(KPI_DOC), { selected: "n04" });
    await userEvent.click(screen.getByRole("tab", { name: "Entrées" }));
    expect(screen.getByLabelText(/^Entrée gauche/)).toHaveValue("n01");
    await userEvent.selectOptions(screen.getByLabelText(/^Entrée gauche/), "");
    expect(node(state.doc, "n04").inputs).toEqual({ right: "n02" });
  });

  it("union : ajouter, réordonner, remplacer et retirer des entrées", async () => {
    const state = live(
      { kind: "kpi", graph: { nodes: [
        { id: "n01", type: "source" }, { id: "n02", type: "source" }, { id: "n03", type: "source" },
        { id: "n04", type: "union", inputs: ["n01", "n02"] },
      ] } },
      { selected: "n04" },
    );
    await userEvent.click(screen.getByRole("tab", { name: "Entrées" }));
    expect(screen.getByRole("button", { name: "Monter l'entrée n01" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Descendre l'entrée n02" })).toBeDisabled();
    expect(within(screen.getByRole("combobox", { name: "Entrée 1" })).getAllByRole("option").map((o) => o.getAttribute("value"))).toEqual(["", "n01", "n03"]);

    await userEvent.click(screen.getByRole("button", { name: "Descendre l'entrée n01" }));
    expect(node(state.doc, "n04").inputs).toEqual(["n02", "n01"]);
    await userEvent.click(screen.getByRole("button", { name: "Monter l'entrée n01" }));
    expect(node(state.doc, "n04").inputs).toEqual(["n01", "n02"]);

    await userEvent.click(screen.getByRole("button", { name: "Ajouter une entrée" }));
    expect(node(state.doc, "n04").inputs).toEqual(["n01", "n02", "n03"]);
    await userEvent.click(screen.getByRole("button", { name: "Ajouter une entrée" }));
    expect(node(state.doc, "n04").inputs).toEqual(["n01", "n02", "n03"]);

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Entrée 2" }), "");
    expect(node(state.doc, "n04").inputs).toEqual(["n01", "n03"]);
    await userEvent.click(screen.getByRole("button", { name: "Retirer la ligne 1 : Ordre des entrées" }));
    await userEvent.click(screen.getByRole("button", { name: "Retirer la ligne 1 : Ordre des entrées" }));
    expect(node(state.doc, "n04")).not.toHaveProperty("inputs");
  });
});

describe("mode surcharge (plan 0015)", () => {
  const canonical = { ...structuredClone(KPI_DOC), variation_points: ["n05"] };
  const variant = (overrides: Raw[] = []): Raw => ({ kind: "variant", variant_of: { id: "revenu-net" }, entity: "nordis-de", mode: "override", overrides });

  it("un nœud du canonique se lit sans s'éditer, et se remplace", async () => {
    const state = live(variant(), { mode: "override", canonical, selected: "n05" });
    expect(screen.getByLabelText("Libellé")).toHaveAttribute("readonly");
    expect(screen.getByRole("radio", { name: "exclues" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Supprimer" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Définir comme sortie du graphe" })).not.toBeInTheDocument();
    expect(screen.getByText("Point de variation déclaré par le canonique.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Remplacer ce nœud" }));
    expect(state.doc.overrides).toEqual([{ node: "n05", replace: node(canonical, "n05") }]);
    expect(screen.getByLabelText("Libellé")).not.toHaveAttribute("readonly");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("surcharge déclarée : justification requise écrite dans la surcharge, puis retrait", async () => {
    const state = live(variant([{ node: "n05", replace: { ...node(canonical, "n05"), nulls: "drop" } }]), { mode: "override", canonical, selected: "n05" });
    expect(screen.getByRole("radio", { name: "exclues" })).toBeChecked();
    await userEvent.type(screen.getByLabelText(/^Justification de la surcharge requis/), "Nulls exclus en DE.");
    expect((state.doc.overrides as Raw[])[0].justification).toBe("Nulls exclus en DE.");
    await userEvent.click(screen.getByRole("radio", { name: "gardées" }));
    expect(((state.doc.overrides as Raw[])[0].replace as Raw).nulls).toBe("keep");

    await userEvent.click(screen.getByRole("button", { name: "Retirer la surcharge" }));
    expect(state.doc.overrides).toEqual([]);
    expect(screen.getByRole("button", { name: "Remplacer ce nœud" })).toBeInTheDocument();
  });

  it("surcharge hors des points déclarés : bandeau d'avertissement", () => {
    live(variant([{ node: "n04", replace: node(canonical, "n04") }]), { mode: "override", canonical, selected: "n04" });
    const banner = screen.getByRole("alert");
    expect(banner).toHaveTextContent("Hors points déclarés : la validation canonique s'appliquera");
    expect(banner).toHaveTextContent("n04 n'est pas un point de variation du canonique");
  });
});

it("les champs du panneau de propriétés suivent la sélection (un nœud chasse l'autre)", () => {
  const p: PropertiesProps = {
    doc: structuredClone(KPI_DOC), mode: "canonical", canonical: null, node: node(KPI_DOC, "n05"), nodes: nodesOf(KPI_DOC),
    check: check(), vocabulary: VOCABULARY, kpis: [], info: { calendars: [], domains: [] },
    dispatch: vi.fn(), onDuplicate: vi.fn(), onRemove: vi.fn(),
  };
  const { rerender } = render(<Properties {...p} />);
  fireEvent.click(screen.getByRole("tab", { name: "YAML du nœud" }));
  rerender(<Properties {...p} node={node(KPI_DOC, "n04")} />);
  expect(screen.getByRole("tab", { name: "Propriétés" })).toHaveAttribute("aria-selected", "true");
  expect(within(panel()).getByRole("heading", { name: "Jointure" })).toBeInTheDocument();
});

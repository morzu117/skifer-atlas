// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { NodeRaw } from "./model";
import { conditionText, summary } from "./summary";

const node = (raw: Record<string, unknown>) => raw as NodeRaw;

describe("summary", () => {
  it("un type de nœud inconnu garde une carte lisible (la validation le signale)", () => {
    expect(summary({ id: "n03", type: "pivot" } as unknown as Parameters<typeof summary>[0])).toEqual({ main: "pivot", meta: "type inconnu" });
  });

  // Texte d'une carte du canevas (guide 4) : expression puis métadonnées, champ par champ.
  it.each<[string, Record<string, unknown>, { main: string; meta: string }]>([
    // source
    ["source complète, colonne datée", { type: "source", table: "gold.finance.factures", columns: [{ name: "statut", type: "string" }, { name: "date_facture", type: "date", timezone: "Europe/Paris" }] },
      { main: "factures", meta: "gold.finance · 2 col. · date_facture · Europe/Paris" }],
    ["source avec horodatage", { type: "source", table: "s.t", columns: [{ name: "ts", type: "timestamp", timezone: "UTC" }] }, { main: "t", meta: "s · 1 col. · ts · UTC" }],
    ["source sans schéma", { type: "source", table: "factures" }, { main: "factures", meta: "" }],
    ["source vide", { type: "source" }, { main: "table ?", meta: "" }],
    ["source aux colonnes mal formées", { type: "source", table: "a.b", columns: ["x", null] }, { main: "b", meta: "a" }],
    // filtre
    ["filtre simple, nulls gardés", { type: "filter", condition: "statut:equals:validée", nulls: "keep" }, { main: "statut = validée", meta: "nulls : gardés" }],
    ["filtre sur liste, nulls exclus", { type: "filter", condition: "pays:in:FR,DE", nulls: "drop" }, { main: "pays dans FR, DE", meta: "nulls : exclus" }],
    ["filtre sans valeur", { type: "filter", condition: "remise:is_null" }, { main: "remise est nul", meta: "nulls : ?" }],
    ["filtre en SQL", { type: "filter", condition: { expr: "montant > 0" } }, { main: "montant > 0", meta: "nulls : ?" }],
    ["filtre vide", { type: "filter" }, { main: "condition ?", meta: "nulls : ?" }],
    // jointure
    ["jointure avec clés, contrôle requis", { type: "join", keys: [["client_id", "id"], ["pays", "pays"]], how: "left", cardinality: "N:1", check: "required" },
      { main: "client_id = id, pays = pays", meta: "left · N:1 · contrôle requis" }],
    ["jointure croisée sans clé, contrôle contourné", { type: "join", how: "cross", check: "bypass" }, { main: "cross", meta: "cross · contrôle contourné" }],
    ["jointure vide", { type: "join" }, { main: "clés ?", meta: "" }],
    // union
    ["union distincte", { type: "union", mode: "distinct", inputs: ["n01", "n02", "n03"] }, { main: "UNION DISTINCT", meta: "3 entrées" }],
    ["union par défaut", { type: "union" }, { main: "UNION ALL", meta: "0 entrées" }],
    // calcul
    ["calcul complet", { type: "compute", column: "ht", expr: "ttc / 1.2" }, { main: "ht", meta: "= ttc / 1.2" }],
    ["calcul vide", { type: "compute" }, { main: "colonne ?", meta: "" }],
    // dédoublonnage
    ["dédoublonnage", { type: "deduplicate", keys: ["facture_id", "ligne"] }, { main: "facture_id, ligne", meta: "une ligne gardée par clé" }],
    ["dédoublonnage vide", { type: "deduplicate" }, { main: "clés ?", meta: "une ligne gardée par clé" }],
    // agrégation
    ["agrégation", { type: "aggregate", measures: [["montant", "total", "sum"], ["*", "n", "count"]], group_by: ["mois", "pays"] },
      { main: "SUM(montant), COUNT(*)", meta: "par mois, pays" }],
    ["agrégation sans granularité", { type: "aggregate", measures: [["montant", "total", "avg"]] }, { main: "AVG(montant)", meta: "" }],
    ["agrégation vide", { type: "aggregate", measures: "?" }, { main: "mesures ?", meta: "" }],
    // temporel
    ["période", { type: "temporal", operation: "period", grain: "month", column: "date_facture", target: "mois" }, { main: "mois", meta: "mois de date_facture" }],
    ["période au grain inconnu", { type: "temporal", operation: "period", grain: "decade", column: "d", target: "x" }, { main: "x", meta: "decade de d" }],
    ["conversion en date", { type: "temporal", operation: "to_date", column: "ts", timezone: "Europe/Paris", target: "jour" }, { main: "jour", meta: "date de ts · Europe/Paris" }],
    ["changement de fuseau", { type: "temporal", operation: "convert_timezone", column: "ts", to: "UTC", target: "ts_utc" }, { main: "ts_utc", meta: "ts → UTC" }],
    ["fenêtre", { type: "temporal", operation: "window", function: "avg", frame: "ROWS BETWEEN 2 PRECEDING AND CURRENT ROW", target: "moy" },
      { main: "moy", meta: "avg sur ROWS BETWEEN 2 PRECEDING AND CURRENT ROW" }],
    ["temporel vide", { type: "temporal" }, { main: "cible ?", meta: "opération ?" }],
    // référence à un KPI
    ["référence versionnée", { type: "kpi_ref", kpi: "revenu-net", version: 4 }, { main: "revenu-net", meta: "v4" }],
    ["référence sans version", { type: "kpi_ref", version: "4" }, { main: "KPI ?", meta: "" }],
    // opération entre métriques
    ["métriques, lignes d'abord", { type: "metric_op", metrics: [{ name: "marge", expr: "a - b" }, { name: "taux", expr: "a / b" }], order: "rows_first" },
      { main: "marge, taux", meta: "lignes d'abord" }],
    ["métriques, agrégation d'abord", { type: "metric_op", metrics: [{ name: "m", expr: "x" }], order: "aggregate_first" }, { main: "m", meta: "agrégation d'abord" }],
    ["métriques vides", { type: "metric_op", metrics: ["a"] }, { main: "métriques ?", meta: "" }],
  ])("%s", (_, raw, expected) => {
    expect(summary(node({ id: "n01", ...raw }))).toEqual(expected);
  });

  // Le commentaire de summary.ts promet qu'un champ manquant est « simplement omis ».
  // bug : summary.ts:66 compose « nom · fuseau » sans filtrer un fuseau absent : la carte affiche « date_facture · ».
  it.fails("une colonne datée sans fuseau n'affiche pas de séparateur orphelin", () => {
    const text = summary(node({ id: "n01", type: "source", table: "s.t", columns: [{ name: "date_facture", type: "date" }] }));
    expect(text.meta).toBe("s · 1 col. · date_facture");
  });

  // bug : summary.ts:96 écrit « date de <colonne> · <fuseau> » même sans fuseau : « date de ts · ».
  it.fails("une conversion en date sans fuseau n'affiche pas de séparateur orphelin", () => {
    expect(summary(node({ id: "n01", type: "temporal", operation: "to_date", column: "ts", target: "jour" })).meta).toBe("date de ts");
  });
});

describe("conditionText", () => {
  it.each([
    ["statut:not_equals:annulée", "statut ≠ annulée"],
    ["montant:greater_than:0", "montant > 0"],
    ["montant:less_than_equal:100", "montant ≤ 100"],
    ["montant:between:1,10", "montant entre 1, 10"],
    ["code:starts_with:FR", "code commence par FR"],
    ["remise:is_not_null", "remise n'est pas nul"],
    ["code:inconnu:x", "code inconnu x"],
    ["pas une condition", "pas une condition"],
    ["", ""],
  ])("%s → %s", (condition, expected) => {
    expect(conditionText(condition)).toBe(expected);
  });

  it("une expression SQL s'affiche telle quelle", () => {
    expect(conditionText({ expr: "a > b" })).toBe("a > b");
    expect(conditionText({})).toBe("");
  });

  // Le moteur Skifer découpe « colonne:opérateur:valeur » en trois au plus
  // (schema_loader._normalize_filter_string, split(":", 2)) : la valeur peut contenir « : ».
  // bug : summary.ts:42 utilise split(":", 3), qui tronque la valeur au deuxième « : » (« 10:30 » devient « 10 »).
  it.fails("une valeur qui contient « : » s'affiche entière", () => {
    expect(conditionText("heure:equals:10:30")).toBe("heure = 10:30");
  });
});

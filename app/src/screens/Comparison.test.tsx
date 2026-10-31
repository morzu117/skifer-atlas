import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Comparison as Run, ComparisonPreview, ComparisonSetup, HistoryEntry, MatrixRow } from "../api";
import { useRoute } from "../router";
import { fakeServer, workspace, type Call } from "../test/fakeServer";
import { Comparison, tone } from "./Comparison";

vi.mock("../external", () => ({ openExternal: vi.fn(async () => undefined) }));
import { openExternal } from "../external";

const API = "/api/workspaces/groupe-nordis/comparisons";
const EXACT_GAP = 6.100137845975261;

const MATRIX: MatrixRow[] = [
  {
    kpi_id: "revenu-net",
    label: "Revenu net",
    domain: "finance",
    domain_label: "Finance",
    version: 4,
    variants: [
      { variant_id: "revenu-net--nordis-de", entity: "nordis-de", compared: true, comparison_id: 7, kpi_version: 4, validation_pct: 93.75, max_gap_pct: EXACT_GAP, divergent_node: "n02" },
      { variant_id: "revenu-net--nordis-es", entity: "nordis-es", compared: false },
      { variant_id: "revenu-net--nordis-fr", entity: "nordis-fr", compared: true, comparison_id: 7, kpi_version: 4, validation_pct: 100, max_gap_pct: 0, divergent_node: null },
    ],
  },
  {
    kpi_id: "taux-de-service",
    label: "Taux de service",
    domain: "supply",
    domain_label: "Supply",
    version: 2,
    variants: [
      { variant_id: "taux-de-service--nordis-fr", entity: "nordis-fr", compared: true, comparison_id: 6, kpi_version: 2, validation_pct: 85, max_gap_pct: 12.4, divergent_node: null },
    ],
  },
];

const SETUP: ComparisonSetup = {
  kpi_id: "revenu-net",
  label: "Revenu net",
  version: 4,
  variants: [
    { entity: "nordis-de", variant_id: "revenu-net--nordis-de", mode: "override", version: 3, platform: "databricks", outdated: false, unavailable: null },
    {
      entity: "nordis-es",
      variant_id: "revenu-net--nordis-es",
      mode: "from_scratch",
      version: 1,
      platform: "snowflake",
      outdated: false,
      unavailable: "Le canonique ne se rebranche pas sur les sources de « nordis-es ».",
    },
    { entity: "nordis-fr", variant_id: "revenu-net--nordis-fr", mode: "override", version: 2, platform: "databricks", outdated: false, unavailable: null },
  ],
  scopes: [
    {
      id: "fy2026-mois-entite",
      period: { from: "2026-02-01", to: "2026-09-30" },
      granularity: ["mois_fiscal", "entite"],
      granularities: [["mois_fiscal", "entite"], ["mois_fiscal"], ["entite"]],
    },
  ],
  tolerance: { kpi: 1.5, workspace: 1 },
  local: false,
};

const PREVIEW: ComparisonPreview = {
  alerts: [{ code: "cardinality_bypass", entity: "nordis-de", nodes: ["n04"], message: "La jointure n04 contourne le contrôle de cardinalité." }],
  plans: [
    { entity: "nordis-de", platform: "databricks", access_point: "dbx-de" },
    { entity: "nordis-fr", platform: "databricks", access_point: "dbx-fr" },
  ],
  tolerance: 1.5,
  granularity: ["mois_fiscal", "entite"],
  missing_access: [],
};

const RUN: Run = {
  id: 7,
  started_at: "2026-10-31T09:10:00",
  finished_at: "2026-10-31T09:10:01",
  user_account: "julien.h",
  kpi_id: "revenu-net",
  kpi_version: 4,
  scope: { id: "fy2026-mois-entite", granularity: ["mois_fiscal", "entite"] },
  tolerance_pct: 1.5,
  status: "done",
  error: null,
  progress: null,
  results: [
    {
      variant_id: "revenu-net--nordis-de",
      entity: "nordis-de",
      variant_version: 3,
      platform: "databricks",
      access_point: null,
      cell_count: 2,
      validation_pct: 50,
      max_gap_pct: EXACT_GAP,
      divergent_node: "n02",
      divergent: { node_id: "n02", node_type: "filter", classification: "override_undeclared", message: "", label: "Factures validées" },
      bypass_nodes: [],
      cells: [
        { dims: { mois_fiscal: "2026-02-01", entite: "DE" }, canonical_value: 3850200, variant_value: 3861750, gap_pct: 0.3, within_tolerance: true, missing: null },
        { dims: { mois_fiscal: "2026-09-01", entite: "DE" }, canonical_value: 4410720, variant_value: 4679780.125, gap_pct: EXACT_GAP, within_tolerance: false, missing: null },
      ],
    },
  ],
};

function entry(id: number, overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    ...RUN,
    id,
    results: [{ variant_id: "revenu-net--nordis-de", entity: "nordis-de", validation_pct: 93.75, max_gap_pct: EXACT_GAP, divergent_node: "n02" }],
    ...overrides,
  };
}

const HISTORY = [
  entry(7),
  entry(6, { kpi_id: "taux-de-service", kpi_version: 2, user_account: "claire.m", started_at: "2026-10-20T14:00:00" }),
  entry(5, { user_account: "claire.m", started_at: "2026-09-02T10:00:00", status: "cancelled", results: [] }),
];

type Handler = (call: Call) => { status?: number; json?: unknown } | undefined;

function comparisonServer(extra: Handler = () => undefined) {
  return fakeServer((call) => {
    const found = extra(call);
    if (found) return found;
    const { method, path } = call;
    if (path === `${API}/matrix`) return { json: MATRIX };
    if (path.startsWith(`${API}/setup`)) return { json: SETUP };
    if (path === `${API}/preview` && method === "POST") return { json: PREVIEW };
    if (path.startsWith(`${API}?limit=`)) return { json: HISTORY.slice(0, Number(path.split("=")[1])) };
    if (path === `${API}/7`) return { json: RUN };
    return undefined;
  });
}

function Harness() {
  const route = useRoute();
  const heading = useRef<HTMLHeadingElement>(null);
  if (route.name !== "workspace") return null;
  return <Comparison ws={workspace()} params={route.params} heading={heading} />;
}

const launchButton = () => screen.findByRole("button", { name: /Lancer la comparaison|Relancer/ });
const starts = (calls: Call[]) => calls.filter((c) => c.method === "POST" && c.path === API);

beforeEach(() => {
  window.location.hash = "#/w/groupe-nordis/comparaison";
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(openExternal).mockClear();
});

describe("seuils de la matrice", () => {
  it("99 % et plus en vert, 90 % et plus en orange, en dessous en rouge", () => {
    expect([100, 99, 98.9, 90, 89.9, null].map(tone)).toEqual(["pass", "pass", "warn", "warn", "bad", "bad"]);
  });
});

describe("comparaison", () => {
  it("matrice : couleurs, écart max, cellule jamais comparée, filtre de domaine (critère 1)", async () => {
    comparisonServer();
    render(<Harness />);
    const de = await screen.findByRole("link", { name: "Revenu net × nordis-de : 94 % de validation, écart max 6,1 %" });
    expect(de.closest("td")).toHaveClass("tone-cell-warn");
    expect(screen.getByRole("link", { name: /Revenu net × nordis-fr : 100 %/ }).closest("td")).toHaveClass("tone-cell-pass");
    expect(screen.getByRole("link", { name: /Taux de service × nordis-fr : 85 %/ }).closest("td")).toHaveClass("tone-cell-bad");
    expect(screen.getByText("non comparé")).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Domaine" }), "supply");
    await waitFor(() => expect(screen.queryByRole("link", { name: /Revenu net × nordis-de/ })).not.toBeInTheDocument());
    expect(screen.getByRole("link", { name: /Taux de service × nordis-fr/ })).toBeInTheDocument();
  });

  it("détail d'une cellule : hors tolérance, valeur exacte au survol, nœud divergent (critères 2 et 6)", async () => {
    comparisonServer();
    render(<Harness />);
    await userEvent.click(await screen.findByRole("link", { name: /Revenu net × nordis-de/ }));
    expect(window.location.hash).toContain("id=7");
    expect(window.location.hash).toContain("variant=nordis-de");
    const detail = await screen.findByRole("region", { name: /Détail · Revenu net · nordis-de · par Mois fiscal × Entité/ });
    const node = within(detail).getByRole("link", { name: "Nœud divergent : n02 · Factures validées" });
    expect(node).toHaveAttribute("href", "#/w/groupe-nordis/fiche/revenu-net--nordis-de?diff=canonique&node=n02");

    const september = within(detail).getByRole("row", { name: /Sept\. 2026/ });
    expect(september).toHaveClass("is-out");
    expect(september).toHaveTextContent("+6,1 % hors tolérance");
    expect(within(september).getByText("+6,1 %")).toHaveAttribute("title", String(EXACT_GAP));
    expect(within(september).getByTitle("4679780.125")).toHaveTextContent(/4\s679\s780,13/);
    expect(within(detail).getByRole("row", { name: /Févr\. 2026/ })).not.toHaveClass("is-out");
    expect(screen.getByRole("link", { name: /Revenu net × nordis-de/ })).toHaveAttribute("aria-current", "true");
  });

  it("[S-0015-03] [S-0009-05] panneau de lancement : déclinaison non comparable, alerte de bypass avant tout lancement (critère 3)", async () => {
    const server = comparisonServer();
    render(<Harness />);
    const es = await screen.findByRole("checkbox", { name: /nordis-es/ });
    expect(es).toBeDisabled();
    expect(es).not.toBeChecked();
    expect(es).toHaveAccessibleDescription(/Non comparable : Le canonique ne se rebranche pas/);
    expect(screen.getByRole("checkbox", { name: /nordis-de/ })).toBeChecked();

    expect(await screen.findByText("Contrôle de cardinalité contourné")).toBeInTheDocument();
    const preview = server.calls.find((c) => c.path === `${API}/preview`)!;
    expect(preview.body).toEqual({ kpi_id: "revenu-net", variants: ["nordis-de", "nordis-fr"], scope_id: "fy2026-mois-entite" });
    expect(starts(server.calls)).toHaveLength(0);
    expect(screen.getByLabelText(/Tolérance : 1,5 %/)).toBeInTheDocument();

    // Granularité plus grossière et tolérance choisie : un scope ad hoc.
    await userEvent.selectOptions(screen.getByLabelText("Granularité"), "1");
    fireEvent.change(screen.getByLabelText(/Tolérance/), { target: { value: "2" } });
    await waitFor(() => {
      const last = server.calls.filter((c) => c.path === `${API}/preview`).at(-1)!;
      expect(last.body).toEqual({
        kpi_id: "revenu-net",
        variants: ["nordis-de", "nordis-fr"],
        scope: { period: { from: "2026-02-01", to: "2026-09-30" }, granularity: ["mois_fiscal"] },
        tolerance: 2,
      });
    });
  });

  it("accès manquant : connexion sur place, puis le lancement reprend (critère 4)", async () => {
    let connected = false;
    let statusReads = 0;
    const server = comparisonServer(({ method, path }) => {
      if (path === API && method === "POST") {
        if (!connected) {
          const issues = [{ access_point: "dbx-de", code: "not_connected", message: "Pas d'accès." }];
          return { status: 409, json: { detail: { code: "needs_auth", message: "Se connecter d'abord à : dbx-de.", issues } } };
        }
        return { json: { id: 7, status: "running", alerts: [] } };
      }
      if (path.endsWith("/connections/dbx-de/authorize")) return { json: { authorize_url: "https://login.example/authorize?state=x" } };
      if (path.endsWith("/connections/dbx-de/status")) {
        statusReads += 1;
        connected = statusReads >= 2;
        return { json: { access_point: "dbx-de", platform: "databricks", entity: "nordis-de", my_access: connected ? "connected" : "never", flow: { status: connected ? "connected" : "pending", error: null } } };
      }
      return undefined;
    });
    render(<Harness />);
    await screen.findByText("Contrôle de cardinalité contourné");
    await userEvent.click(await launchButton());

    expect(await screen.findByText("Connexion requise")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /token|jeton/i })).not.toBeInTheDocument();
    expect(await launchButton()).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(screen.getByRole("button", { name: "Se connecter à dbx-de" }));
    expect(openExternal).toHaveBeenCalledWith("https://login.example/authorize?state=x");
    expect(await screen.findByRole("button", { name: "En attente de dbx-de…" })).toBeInTheDocument();

    await waitFor(() => expect(starts(server.calls)).toHaveLength(2), { timeout: 4000 });
    await waitFor(() => expect(screen.queryByText("Connexion requise")).not.toBeInTheDocument());
    expect(await screen.findByRole("button", { name: "Relancer" }, { timeout: 3000 })).toBeInTheDocument();
  });

  it("[S-0015-05] progression par plateforme, Annuler, statut annulée (critère 5)", async () => {
    let cancelled = false;
    const server = comparisonServer(({ method, path }) => {
      if (path === API && method === "POST") return { json: { id: 8, status: "running", alerts: [] } };
      if (path === `${API}/8/cancel` && method === "POST") {
        cancelled = true;
        return { json: { id: 8, status: "cancelling" } };
      }
      if (path === `${API}/8`) {
        const progress = [{ platform: "databricks", entities: ["nordis-de", "nordis-fr"], state: "running", percent: 40 }];
        return { json: { ...RUN, id: 8, status: cancelled ? "cancelled" : "running", finished_at: null, progress: cancelled ? null : progress, results: [] } };
      }
      return undefined;
    });
    render(<Harness />);
    await screen.findByText("Contrôle de cardinalité contourné");
    await userEvent.click(await launchButton());

    const bar = await screen.findByRole("progressbar", { name: "Databricks · nordis-de, nordis-fr" });
    await waitFor(() => expect(bar).toHaveAttribute("aria-valuenow", "40"));
    expect(screen.getByText("En cours · 40 %")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Annuler" }));
    expect(server.calls.some((c) => c.path === `${API}/8/cancel`)).toBe(true);

    expect(await screen.findByText("Comparaison n° 8 annulée.", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Annuler" })).not.toBeInTheDocument();
    expect(screen.getByText("Annulé")).toBeInTheDocument();
    await waitFor(() => expect(window.location.hash).toContain("id=8"));
  });

  it("historique : bandeau des trois dernières, liste complète filtrée (critère 7)", async () => {
    comparisonServer();
    render(<Harness />);
    const strip = await screen.findByRole("region", { name: "Dernières comparaisons" });
    expect(await within(strip).findByRole("link", { name: "n° 7 · Revenu net" })).toBeInTheDocument();
    await userEvent.click(within(strip).getByRole("link", { name: "Tout voir" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Historique des comparaisons" })).toBeInTheDocument();
    const table = await screen.findByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(4);

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Utilisateur" }), "claire.m");
    await waitFor(() => expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(3));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "KPI" }), "taux-de-service");
    await waitFor(() => expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(2));
    expect(screen.getByRole("link", { name: "n° 6" })).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "KPI" }), "");
    fireEvent.change(screen.getByLabelText("Depuis le"), { target: { value: "2026-10-01" } });
    await waitFor(() => expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(2));
    expect(window.location.hash).toContain("user=claire.m");
    expect(window.location.hash).toContain("depuis=2026-10-01");
  });
});

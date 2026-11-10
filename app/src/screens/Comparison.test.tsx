import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Comparison as Run, ComparisonPreview, ComparisonSetup, HistoryEntry, MatrixRow } from "../api";
import { useRoute } from "../router";
import { expectAccessibleLandmarks } from "../test/accessibility";
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
      common_sources: [],
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

type Handler = (call: Call) => { status?: number; json?: unknown } | Promise<{ status?: number; json?: unknown }> | undefined;

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
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.mocked(openExternal).mockClear();
});

describe("seuils de la matrice", () => {
  it("99 % et plus en vert, 90 % et plus en orange, en dessous en rouge", () => {
    expect([100, 99, 98.9, 90, 89.9, null].map(tone)).toEqual(["pass", "pass", "warn", "warn", "bad", "bad"]);
  });
});

describe("comparaison", () => {
  it.each([
    ["result_too_large: Le résultat dépasse la limite de lignes.", "Le résultat dépasse la limite de lignes", "Restreignez la période ou les entités"],
    ["code_inconnu: Détail du serveur.", "La comparaison a échoué", "Détail du serveur."],
  ])("affiche l'échec enregistré dans le détail : %s", async (error, title, message) => {
    window.location.hash = "#/w/groupe-nordis/comparaison?id=7";
    comparisonServer(({ path }) => path === `${API}/7` ? { json: { ...RUN, status: "failed", error, results: [] } } : undefined);
    const { container } = render(<Harness />);
    expect(await screen.findByText("Comparaison n° 7 en échec")).toBeInTheDocument();
    expect(screen.getByText(title, { exact: false })).toBeInTheDocument();
    expect(screen.getByText(message, { exact: false })).toBeInTheDocument();
    expect(container.textContent).not.toContain(error.split(":")[0]);
  });

  it.each([
    ["partial", "partielle"],
    ["failed", "en échec"],
    ["cancelled", "annulée"],
  ])("affiche le statut %s et l'erreur secondaire après le suivi et dans le détail", async (status, label) => {
    comparisonServer(({ method, path }) => {
      if (method === "POST" && path === API) return { json: { id: 8 } };
      if (path === `${API}/8`) return { json: { ...RUN, id: 8, status, error: "result_too_large: Le résultat dépasse 50000 lignes." } };
      return undefined;
    });
    const { container } = render(<Harness />);
    await screen.findByText("Contrôle de cardinalité contourné");
    await userEvent.click(await launchButton());
    await waitFor(() => expect(screen.getAllByText(`Comparaison n° 8 ${label}`).length).toBeGreaterThanOrEqual(2));
    expect(screen.getAllByText(/Le résultat dépasse 50 000 lignes/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/Restreignez la période ou les entités/).length).toBeGreaterThanOrEqual(2);
    expect(container.textContent).not.toContain("result_too_large");
  });

  it("évite les repères dupliqués et rend les tableaux accessibles", async () => {
    comparisonServer();
    render(<Harness />);
    await screen.findByRole("group", { name: "Matrice des comparaisons" });
    await expectAccessibleLandmarks();
    const strip = await screen.findByRole("region", { name: "Dernières comparaisons" });
    await userEvent.click(within(strip).getByRole("link", { name: "Tout voir" }));
    await screen.findByRole("group", { name: "Tableau : Historique des comparaisons" });
    await expectAccessibleLandmarks();
  });

  it("[S-0015-08] un double clic ne lance qu'une requête", async () => {
    const server = comparisonServer(({ method, path }) => method === "POST" && path === API ? { json: { id: 8 } } : undefined);
    render(<Harness />);
    await screen.findByText("Contrôle de cardinalité contourné");
    const button = await launchButton();
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(starts(server.calls)).toHaveLength(1));
  });

  it("[S-0015-08] deux clics dans le même tick sont protégés avant le rendu", async () => {
    const server = comparisonServer(({ method, path }) => method === "POST" && path === API ? { json: { id: 8 } } : undefined);
    render(<Harness />);
    await screen.findByText("Contrôle de cardinalité contourné");
    const button = await launchButton();
    await act(async () => {
      button.click();
      button.click();
    });
    expect(starts(server.calls)).toHaveLength(1);
  });

  it("[S-0015-09] cinq erreurs de suivi espacées affichent l'échec et débloquent le lancement", async () => {
    const server = comparisonServer(({ method, path }) => {
      if (method === "POST" && path === API) return { json: { id: 8 } };
      if (path === `${API}/8`) return { status: 500, json: { detail: { code: "oops", message: "Suivi impossible" } } };
      return undefined;
    });
    render(<Harness />);
    await screen.findByText("Contrôle de cardinalité contourné");
    const button = await launchButton();
    vi.useFakeTimers();
    await act(async () => button.click());
    const reads = () => server.calls.filter((c) => c.path === `${API}/8`);
    for (const [index, delay] of [400, 400, 800, 1600, 3200].entries()) {
      await act(async () => vi.advanceTimersByTimeAsync(delay - 1));
      expect(reads()).toHaveLength(index);
      expect(screen.queryByText("Suivi impossible")).not.toBeInTheDocument();
      expect(button).toHaveAttribute("aria-disabled", "true");
      await act(async () => vi.advanceTimersByTimeAsync(1));
      expect(reads()).toHaveLength(index + 1);
    }
    expect(screen.getByText("Suivi impossible")).toBeInTheDocument();
    expect(button).not.toHaveAttribute("aria-disabled", "true");
    await act(async () => vi.advanceTimersByTimeAsync(10000));
    expect(reads()).toHaveLength(5);
    await act(async () => button.click());
    expect(starts(server.calls)).toHaveLength(2);
  });

  it("[S-0015-09] une comparaison inconnue termine immédiatement le suivi", async () => {
    const server = comparisonServer(({ method, path }) => {
      if (method === "POST" && path === API) return { json: { id: 8 } };
      if (path === `${API}/8`) return { status: 404, json: { detail: { code: "not_found", message: "Comparaison introuvable" } } };
      return undefined;
    });
    render(<Harness />);
    await screen.findByText("Contrôle de cardinalité contourné");
    await userEvent.click(await launchButton());
    expect(await screen.findByText("Comparaison introuvable")).toBeInTheDocument();
    expect(server.calls.filter((c) => c.path === `${API}/8`)).toHaveLength(1);
    expect(await launchButton()).not.toHaveAttribute("aria-disabled", "true");
  });

  it("[S-0015-10] affiche l'échec de l'annulation", async () => {
    comparisonServer(({ method, path }) => {
      if (method === "POST" && path === API) return { json: { id: 8 } };
      if (path === `${API}/8/cancel`) return { status: 500, json: { detail: { code: "oops", message: "Annulation impossible" } } };
      return undefined;
    });
    render(<Harness />);
    await screen.findByText("Contrôle de cardinalité contourné");
    await userEvent.click(await launchButton());
    await userEvent.click(await screen.findByRole("button", { name: "Annuler" }));
    expect(await screen.findByText("Annulation impossible")).toBeInTheDocument();
  });

  it.each(["oops", "not_running"])("[S-0015-10] une annulation refusée (%s) ne laisse pas d'erreur après la fin", async (code) => {
    let finished = false;
    comparisonServer(({ method, path }) => {
      if (method === "POST" && path === API) return { json: { id: 8 } };
      if (path === `${API}/8/cancel`) return { status: code === "not_running" ? 409 : 500, json: { detail: { code, message: "Annulation impossible" } } };
      if (path === `${API}/8`) return { json: { ...RUN, id: 8, status: finished ? "done" : "running" } };
      return undefined;
    });
    render(<Harness />);
    await screen.findByText("Contrôle de cardinalité contourné");
    await userEvent.click(await launchButton());
    const cancel = await screen.findByRole("button", { name: "Annuler" });
    await act(async () => cancel.click());
    if (code === "not_running") expect(screen.queryByText("Annulation impossible")).not.toBeInTheDocument();
    else expect(screen.getByText("Annulation impossible")).toBeInTheDocument();
    finished = true;
    await screen.findByRole("button", { name: "Relancer" });
    expect(screen.queryByText("Annulation impossible")).not.toBeInTheDocument();
  });

  it("[S-0015-11] une tolérance de 8 % reste affichée et envoyée", async () => {
    const server = comparisonServer(({ method, path }) => {
      if (path.startsWith(`${API}/setup`)) return { json: { ...SETUP, tolerance: { kpi: 8, workspace: 1 } } };
      if (path === `${API}/preview`) return { json: { ...PREVIEW, tolerance: 8 } };
      if (method === "POST" && path === API) return { json: { id: 8 } };
      return undefined;
    });
    render(<Harness />);
    await screen.findByText("Contrôle de cardinalité contourné");
    const slider = screen.getByRole("slider", { name: /Tolérance/ });
    expect(slider).toHaveValue("8");
    expect(slider).toHaveAttribute("max", "8");
    fireEvent.change(slider, { target: { value: "7" } });
    fireEvent.change(slider, { target: { value: "8" } });
    await userEvent.click(await launchButton());
    await waitFor(() => expect(starts(server.calls)[0].body).toMatchObject({ tolerance: 8 }));
  });

  it("[S-0015-11] une tolérance de 7,25 % donne une borne à 7,3 et envoie la valeur choisie", async () => {
    const server = comparisonServer(({ method, path }) => {
      if (path.startsWith(`${API}/setup`)) return { json: { ...SETUP, tolerance: { kpi: 7.25, workspace: 1 } } };
      if (path === `${API}/preview`) return { json: { ...PREVIEW, tolerance: 7.25 } };
      if (method === "POST" && path === API) return { json: { id: 8 } };
      return undefined;
    });
    render(<Harness />);
    await screen.findByText("Contrôle de cardinalité contourné");
    const slider = screen.getByRole("slider", { name: /Tolérance/ });
    expect(slider).toHaveAttribute("max", "7.3");
    fireEvent.change(slider, { target: { value: "7.3" } });
    expect(slider).toHaveValue("7.3");
    expect(slider).toHaveAttribute("aria-valuetext", "7,3 %");
    await userEvent.click(await launchButton());
    expect(starts(server.calls)[0].body).toMatchObject({ tolerance: 7.3 });
  });

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

  it("[S-0029-01] [S-0029-02] source commune : annoncée avant le lancement, listée dans le détail", async () => {
    const common = { node: "n06", label: "Jours comptables", table: "gold.finance.dim_date", platform: "snowflake" };
    const alert = { code: "common_source", entity: "nordis-es", nodes: ["n06"], message: "nordis-es : n06 · Jours comptables (gold.finance.dim_date) n'a pas d'équivalent dans la déclinaison ; la table du canonique est lue sur snowflake, des deux côtés." };
    const run = { ...RUN, results: [{ ...RUN.results[0], entity: "nordis-es", platform: "snowflake", common_sources: [common] }] };
    comparisonServer(({ method, path }) => {
      if (path === `${API}/preview` && method === "POST") return { json: { ...PREVIEW, alerts: [alert] } };
      if (path === `${API}/7`) return { json: run };
      return undefined;
    });
    window.location.hash = "#/w/groupe-nordis/comparaison?id=7&variant=nordis-es";
    render(<Harness />);
    const banner = (await screen.findByText("Source commune")).closest(".banner")!;
    expect(banner).toHaveAttribute("role", "status");
    expect(banner).toHaveTextContent(alert.message);
    expect(await screen.findByText("Sources communes, lues sur snowflake des deux côtés : n06 · Jours comptables (gold.finance.dim_date).")).toBeInTheDocument();
  });

  it("code d'alerte inconnu : titre générique ; sources communes regroupées par plateforme", async () => {
    const source = (node: string, platform: string) => ({ node, label: null, table: `t_${node}`, platform });
    const run = { ...RUN, results: [{ ...RUN.results[0], common_sources: [source("n06", "snowflake"), source("n07", "databricks"), source("n08", "snowflake")] }] };
    comparisonServer(({ method, path }) => {
      if (path === `${API}/preview` && method === "POST") return { json: { ...PREVIEW, alerts: [{ code: "nouveau_code", entity: "nordis-de", nodes: [], message: "Un message." }] } };
      if (path === `${API}/7`) return { json: run };
      return undefined;
    });
    window.location.hash = "#/w/groupe-nordis/comparaison?id=7&variant=nordis-de";
    render(<Harness />);
    expect(await screen.findByText("Alerte")).toBeInTheDocument();
    expect(screen.queryByText("Surcharge hors des points déclarés")).not.toBeInTheDocument();
    expect(await screen.findByText("Sources communes, lues sur snowflake des deux côtés : n06 (t_n06), n08 (t_n08).")).toBeInTheDocument();
    expect(screen.getByText("Sources communes, lues sur databricks des deux côtés : n07 (t_n07).")).toBeInTheDocument();
  });

  it("[S-0015-04] accès manquant : connexion sur place, puis le lancement reprend (critère 4)", async () => {
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

  it("[S-0015-12] un accès perdu pendant le lancement est expliqué, mène à Mes connexions et ressort en « Connexion requise »", async () => {
    let lost = false;
    let previews = 0;
    const server = comparisonServer(({ method, path }) => {
      if (path === API && method === "POST") {
        lost = true;
        return { status: 409, json: { detail: { code: "access_expired", message: "Accès expiré : texte brut du serveur." } } };
      }
      if (path === `${API}/preview` && method === "POST") {
        previews += 1;
        const missing_access = lost ? [{ access_point: "dbx-de", code: "access_expired", message: "Accès expiré." }] : [];
        return { json: { ...PREVIEW, missing_access } };
      }
      return undefined;
    });
    render(<Harness />);
    await screen.findByText("Contrôle de cardinalité contourné");
    await userEvent.click(await launchButton());

    const banner = await screen.findByText("Accès expiré");
    expect(banner.closest("[role='alert']")).toHaveTextContent("Reconnectez-vous depuis Mes connexions, puis réessayez.");
    expect(banner.closest("[role='alert']")).not.toHaveTextContent("texte brut");
    expect(screen.getByRole("link", { name: "Reconnecter dans Mes connexions" })).toHaveAttribute("href", "#/w/groupe-nordis/connexions");
    // L'aperçu est relu : le bandeau « Connexion requise » et son bouton existent déjà.
    expect(await screen.findByText("Connexion requise")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Se connecter à dbx-de" })).toBeInTheDocument();
    expect(previews).toBeGreaterThanOrEqual(2);
    expect(starts(server.calls)).toHaveLength(1);
  });

  it("[S-0015-13] deux clics rapides sur « Se connecter à… » ne lancent qu'une autorisation OAuth", async () => {
    let release!: () => void;
    const held = new Promise<{ json: unknown }>((resolve) => {
      release = () => resolve({ json: { authorize_url: "https://login.example/authorize?state=x" } });
    });
    const server = comparisonServer(({ method, path }) => {
      if (path === `${API}/preview` && method === "POST") {
        return { json: { ...PREVIEW, missing_access: [{ access_point: "dbx-de", code: "not_connected", message: "Pas d'accès." }] } };
      }
      if (path.endsWith("/connections/dbx-de/authorize")) return held;
      if (path.endsWith("/connections/dbx-de/status")) return { json: { access_point: "dbx-de", my_access: "never", flow: { status: "pending", error: null } } };
      return undefined;
    });
    render(<Harness />);
    const button = await screen.findByRole("button", { name: "Se connecter à dbx-de" });
    await act(async () => {
      button.click();
      button.click();
    });
    expect(button).toBeDisabled();
    release();
    expect(await screen.findByRole("button", { name: "En attente de dbx-de…" })).toBeInTheDocument();
    expect(server.calls.filter((c) => c.method === "POST" && c.path.endsWith("/authorize"))).toHaveLength(1);
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Connexion échouée/)).not.toBeInTheDocument();
  });

  it("[S-0015-13] page d'autorisation abandonnée : « Recommencer la connexion » relance l'autorisation", async () => {
    const server = comparisonServer(({ method, path }) => {
      if (path === `${API}/preview` && method === "POST") {
        return { json: { ...PREVIEW, missing_access: [{ access_point: "dbx-de", code: "not_connected", message: "Pas d'accès." }] } };
      }
      if (path.endsWith("/connections/dbx-de/authorize")) return { json: { authorize_url: "https://login.example/authorize?state=x" } };
      if (path.endsWith("/connections/dbx-de/status")) return { json: { access_point: "dbx-de", my_access: "never", flow: { status: "pending", error: null } } };
      return undefined;
    });
    render(<Harness />);
    await userEvent.click(await screen.findByRole("button", { name: "Se connecter à dbx-de" }));
    // Le flux attend : le bouton d'attente est désactivé et dit pourquoi, la relance reste offerte.
    expect(await screen.findByRole("button", { name: "En attente de dbx-de…" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Recommencer la connexion à dbx-de" }));
    await waitFor(() => expect(server.calls.filter((c) => c.method === "POST" && c.path.endsWith("/authorize"))).toHaveLength(2));
    expect(openExternal).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/Connexion échouée/)).not.toBeInTheDocument();
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

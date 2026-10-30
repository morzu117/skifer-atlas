import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogRow, DocumentSummary, Workspace } from "../api";
import { useRoute } from "../router";
import { fakeServer, workspace, type Call } from "../test/fakeServer";
import { Catalogue } from "./Catalogue";

const WS = "/api/workspaces/groupe-nordis";

function row(overrides: Partial<CatalogRow>): CatalogRow {
  return {
    id: "x",
    kind: "kpi",
    label: "X",
    domain: "finance",
    owner: "claire.m",
    version: 1,
    status: "validated",
    description: null,
    synonyms: [],
    variant_count: 0,
    convergence: "converged",
    ...overrides,
  };
}

const ROWS: CatalogRow[] = [
  row({ id: "commande", kind: "concept", label: "Commande", domain: "ventes", version: 5, convergence: null }),
  row({ id: "marge-brute", label: "Marge brute", version: 2, variant_count: 3 }),
  row({ id: "panier-moyen", label: "Panier moyen", domain: "ventes", variant_count: 3, convergence: "divergences:2" }),
  row({
    id: "revenu-net",
    label: "Revenu net",
    version: 4,
    variant_count: 3,
    synonyms: ["CA net", "net revenue"],
    convergence: "candidates:1",
  }),
  row({ id: "taux-de-service", label: "Taux de service", domain: "supply", variant_count: 2, convergence: "never_compared" }),
];

const SUMMARY: DocumentSummary = {
  id: "revenu-net",
  kind: "kpi",
  label: "Revenu net",
  domain: "finance",
  domain_label: "Finance",
  owner: "claire.m",
  owner_name: "Claire M.",
  version: 4,
  status: "validated",
  description: "Chiffre d'affaires facturé, taxes déduites.",
  synonyms: ["CA net", "net revenue"],
  variation_points: [
    { node_id: "n03", label: "déduction des taxes" },
    { node_id: "n04", label: "calendrier" },
  ],
  variants: [
    { id: "revenu-net--nordis-de", entity: "nordis-de", mode: "override" },
    { id: "revenu-net--nordis-es", entity: "nordis-es", mode: "from_scratch" },
  ],
  referenced_by: [
    { id: "marge-brute", label: "Marge brute", kind: "kpi" },
    { id: "panier-moyen", label: "Panier moyen", kind: "kpi" },
  ],
  last_comparison: { id: 1, finished_at: "2026-10-27T10:00:00", kpi_version: 4, validation_pct: 94.2, stale: false },
};

const FACETS = {
  domain: [
    { value: "finance", label: "Finance" },
    { value: "supply", label: "Supply chain" },
    { value: "ventes", label: "Ventes" },
  ],
  owner: [{ value: "claire.m", label: "Claire M." }],
  status: ["validated"],
  kind: ["concept", "kpi"],
};

const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** Le serveur filtre comme l'API : libellé ou synonymes, domaine, type. */
function catalogServer(overrides: (call: Call) => ReturnType<Parameters<typeof fakeServer>[0]> = () => undefined) {
  return fakeServer((call) => {
    const found = overrides(call);
    if (found !== undefined) return found;
    const url = new URL(call.path, "http://srv");
    if (url.pathname === `${WS}/index`) return { json: { fresh: true } };
    if (url.pathname === `${WS}/catalog/facets`) return { json: FACETS };
    if (url.pathname === `${WS}/catalog`) {
      const q = fold(url.searchParams.get("q") ?? "");
      const domain = url.searchParams.get("domain");
      const kind = url.searchParams.get("kind");
      return {
        json: ROWS.filter(
          (r) =>
            (!q || [r.label, ...r.synonyms].some((t) => fold(t).includes(q))) &&
            (!domain || r.domain === domain) &&
            (!kind || r.kind === kind),
        ),
      };
    }
    if (url.pathname === `${WS}/documents/revenu-net/summary`) return { json: SUMMARY };
    return undefined;
  });
}

function Harness({ ws }: { ws: Workspace }) {
  const route = useRoute();
  const heading = useRef<HTMLHeadingElement>(null);
  return route.name === "workspace" ? <Catalogue ws={ws} params={route.params} heading={heading} /> : null;
}

const catalogue = (ws: Workspace = workspace()) => render(<Harness ws={ws} />);
const catalogCalls = (calls: Call[]) => calls.filter((c) => c.path.startsWith(`${WS}/catalog`) && !c.path.includes("facets"));

beforeEach(() => {
  window.location.hash = "#/w/groupe-nordis/catalogue";
});
afterEach(() => vi.unstubAllGlobals());

describe("catalogue", () => {
  it("liste les documents avec type, domaine, version, déclinaisons et convergence (critère 1)", async () => {
    catalogServer();
    catalogue();
    const table = await screen.findByRole("table", { name: "Concepts et KPI" });
    await waitFor(() => expect(within(table).getAllByRole("row")).toHaveLength(6));
    const cells = (name: string) =>
      within(screen.getByRole("link", { name }).closest("tr")!)
        .getAllByRole("cell")
        .map((cell) => cell.textContent);
    expect(cells("Revenu net")).toEqual(["Revenu net", "KPI", "Finance", "v4", "3", "1 candidate"]);
    expect(cells("Commande")).toEqual(["Commande", "Concept", "Ventes", "v5", "—", "—sans objet pour un concept"]);
    expect(cells("Panier moyen")[5]).toBe("2 divergences");
    expect(cells("Taux de service")[2]).toBe("Supply chain");
    expect(cells("Taux de service")[5]).toBe("Jamais comparé");
    expect(screen.getByText("1 candidate")).toHaveClass("tone-warn");
    expect(screen.getByText("2 divergences")).toHaveClass("tone-bad");
    expect(screen.getByRole("link", { name: "Revenu net" })).toHaveAttribute("href", "#/w/groupe-nordis/fiche/revenu-net");
  });

  it("recherche temporisée sur les synonymes, gardée dans l'adresse (critère 2)", async () => {
    const server = catalogServer();
    catalogue();
    await screen.findByRole("link", { name: "Revenu net" });
    await userEvent.type(screen.getByRole("searchbox", { name: "Rechercher dans le catalogue" }), "CA net");
    await waitFor(() => expect(window.location.hash).toBe("#/w/groupe-nordis/catalogue?q=CA+net"));
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(2));
    expect(screen.getByRole("link", { name: "Revenu net" })).toBeInTheDocument();
    // Une seule requête après la frappe, pas une par lettre.
    expect(catalogCalls(server.calls).map((c) => c.path)).toEqual([`${WS}/catalog`, `${WS}/catalog?q=CA+net`]);
  });

  it("les filtres se combinent, l'adresse garde leur état, le retour arrière les restaure (critère 3)", async () => {
    const server = catalogServer();
    catalogue();
    await screen.findByRole("option", { name: "Supply chain" });
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Domaine" }), "ventes");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Type" }), "kpi");
    await waitFor(() => expect(window.location.hash).toBe("#/w/groupe-nordis/catalogue?domain=ventes&kind=kpi"));
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(2));
    expect(screen.getByRole("link", { name: "Panier moyen" })).toBeInTheDocument();
    expect(catalogCalls(server.calls).at(-1)?.path).toBe(`${WS}/catalog?domain=ventes&kind=kpi`);

    act(() => window.history.back());
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Type" })).toHaveValue(""));
    expect(screen.getByRole("combobox", { name: "Domaine" })).toHaveValue("ventes");
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(3));
  });

  it("cliquer une ligne ouvre l'aperçu : points de variation, déclinaisons, références (critère 4)", async () => {
    catalogServer();
    catalogue();
    const name = await screen.findByText("Taux de service");
    await userEvent.click(within(screen.getByRole("link", { name: "Revenu net" }).closest("tr")!).getByText("Finance"));
    const preview = await screen.findByRole("complementary", { name: "Revenu net" });
    expect(window.location.hash).toBe("#/w/groupe-nordis/catalogue?sel=revenu-net");
    expect(screen.getByRole("link", { name: "Revenu net" }).closest("tr")).toHaveAttribute("aria-current", "true");
    const panel = within(preview);
    expect(panel.getByText("Finance · v4 · propriétaire : Claire M.")).toBeInTheDocument();
    expect(panel.getByText(/taxes déduites\. Synonymes : CA net, net revenue\./)).toBeInTheDocument();
    const fact = (term: string) => panel.getByText(term).nextElementSibling?.textContent;
    expect(fact("Points de variation")).toBe("n03 déduction des taxes · n04 calendrier");
    expect(fact("Déclinaisons")).toBe("nordis-de · nordis-es (from scratch)");
    expect(fact("Référencé par")).toBe("Marge brute, Panier moyen");
    expect(fact("Dernière comparaison")).toMatch(/^94 % · il y a \d+ j$/);
    expect(panel.getByRole("link", { name: "Ouvrir la fiche" })).toHaveAttribute("href", "#/w/groupe-nordis/fiche/revenu-net");
    expect(name).toBeInTheDocument();
  });

  it("flèches pour changer de ligne, la ligne qui a le focus est sélectionnée", async () => {
    catalogServer(({ path }) => (path.endsWith("/summary") ? { json: { ...SUMMARY, id: "x" } } : undefined));
    catalogue();
    const table = within(await screen.findByRole("table"));
    const first = await table.findByRole("link", { name: "Commande" });
    expect(table.getByRole("link", { name: "Marge brute" })).toHaveAttribute("tabindex", "-1");
    await userEvent.click(screen.getByRole("searchbox"));
    for (let i = 0; i < 4; i += 1) await userEvent.tab(); // les quatre filtres
    await userEvent.tab(); // une seule ligne dans l'ordre de tabulation
    expect(first).toHaveFocus();
    await waitFor(() => expect(window.location.hash).toContain("sel=commande"));
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    expect(table.getByRole("link", { name: "Panier moyen" })).toHaveFocus();
    await waitFor(() => expect(window.location.hash).toContain("sel=panier-moyen"));
    await userEvent.keyboard("{End}");
    expect(table.getByRole("link", { name: "Taux de service" })).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}{Home}");
    expect(first).toHaveFocus();
  });

  it("« + Nouveau » pour les contributeurs, absent pour un lecteur (critère 5)", async () => {
    catalogServer();
    const { unmount } = catalogue(workspace({ role: "contributeur" }));
    expect(await screen.findByRole("link", { name: "Nouveau concept ou KPI" })).toHaveAttribute(
      "href",
      "#/w/groupe-nordis/editeur",
    );
    unmount();
    catalogue(workspace({ role: "lecteur" }));
    await screen.findByRole("link", { name: "Revenu net" });
    expect(screen.queryByRole("link", { name: "Nouveau concept ou KPI" })).toBeNull();
  });

  it("squelette pendant le chargement, message si l'index se reconstruit", async () => {
    let release: () => void = () => {};
    const pending = new Promise<{ json: CatalogRow[] }>((resolve) => {
      release = () => resolve({ json: ROWS });
    });
    catalogServer(({ path }) => {
      if (path === `${WS}/index`) return { json: { fresh: false } };
      if (path === `${WS}/catalog`) return pending;
      return undefined;
    });
    catalogue();
    expect(await screen.findByText("Reconstruction de l'index de l'espace depuis le dépôt…")).toBeInTheDocument();
    expect(screen.getByRole("table")).toHaveAttribute("aria-busy", "true");
    expect(document.querySelectorAll("tr.skeleton")).toHaveLength(5);
    release();
    await screen.findByRole("link", { name: "Revenu net" });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("aucun résultat, et catalogue vide", async () => {
    catalogServer();
    window.location.hash = "#/w/groupe-nordis/catalogue?q=zzz";
    const { unmount } = catalogue();
    expect(await screen.findByText("Aucun concept ou KPI ne correspond")).toBeInTheDocument();
    expect(screen.getByRole("searchbox")).toHaveValue("zzz");
    unmount();
    catalogServer(({ path }) => (path === `${WS}/catalog` ? { json: [] } : undefined));
    window.location.hash = "#/w/groupe-nordis/catalogue";
    catalogue();
    expect(await screen.findByText("Le catalogue est vide")).toBeInTheDocument();
  });

  it("une erreur d'API s'affiche dans un bandeau", async () => {
    catalogServer(({ path }) =>
      path === `${WS}/catalog` ? { status: 500, json: { detail: { code: "boom", message: "Index illisible." } } } : undefined,
    );
    catalogue();
    expect(await screen.findByText("Index illisible.")).toBeInTheDocument();
  });
});

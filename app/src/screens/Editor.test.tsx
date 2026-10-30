import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CheckResult, EditorDocument, Workspace } from "../api";
import { useRoute } from "../router";
import { fakeServer, workspace, type Call } from "../test/fakeServer";
import { mockReactFlow } from "../test/reactFlow";
import { Editor } from "./Editor";

const EDITOR = "/api/workspaces/groupe-nordis/editor";

const DOCUMENT = {
  schema_version: 1,
  kind: "kpi",
  data_product: { id: "revenu-net", version: 5, owner: "claire.m", domain: "finance" },
  label: "Revenu net",
  semantics: { calendar: { key: "fiscal-nordis", version: "2026.1" }, timezone: "Europe/Paris" },
  graph: {
    nodes: [
      { id: "n01", type: "source", platform: "databricks", table: "gold.finance.f", owner: "claire.m", columns: [{ name: "statut", type: "string" }] },
      { id: "n02", type: "filter", inputs: ["n01"], condition: "statut:equals:validée" },
    ],
    output: "n02",
  },
};

function opened(overrides: Partial<EditorDocument> = {}): EditorDocument {
  return {
    id: "revenu-net",
    mode: "canonical",
    kind: "kpi",
    base_version: 4,
    document: structuredClone(DOCUMENT),
    canonical: null,
    highest: 7,
    positions: { n01: { x: 24, y: 24 }, n02: { x: 288, y: 24 } },
    draft: null,
    calendars: [{ key: "fiscal-nordis", version: "2026.1" }],
    domains: [{ id: "finance", label: "Finance" }],
    vocabulary: { operators: [{ name: "equals", arity: "single", label: "égal à" }], aggregates: ["sum"], platforms: ["databricks"], column_types: ["string"] },
    ...overrides,
  };
}

type Nodes = { id: string; type: string; nulls?: string }[];

/** Le serveur valide comme le vrai pour ce qui compte ici : un filtre sans nulls bloque. */
function checked(document: { graph?: { nodes: Nodes } }): CheckResult {
  const nodes = document.graph?.nodes ?? [];
  const issues = nodes
    .filter((n) => n.type === "filter" && !n.nulls)
    .map((n) => ({ path: `/graph/nodes/${n.id}/nulls`, node_id: n.id, code: "missing_field", message: "« nulls » est requis : gardés ou exclus.", severity: "error" as const }));
  return {
    yaml: `label: Revenu net\n# ${nodes.length} nœuds\n`,
    fragments: Object.fromEntries(nodes.map((n) => [n.id, `- id: ${n.id}\n`])),
    issues,
    status: {
      schema: issues.length === 0,
      acyclic: true,
      cycle: null,
      compilable: issues.length
        ? { databricks: { status: "blocked" }, snowflake: { status: "blocked" } }
        : { databricks: { status: "ok", sql: "SELECT 1", node_sql: null }, snowflake: { status: "ok", sql: "SELECT 1", node_sql: null } },
    },
    columns: { n01: [["statut", "string"]], n02: [["statut", "string"]] },
    submittable: issues.length === 0,
  };
}

function server(info: EditorDocument = opened(), extra: (call: Call) => ReturnType<Parameters<typeof fakeServer>[0]> = () => undefined) {
  return fakeServer((call) => {
    const found = extra(call);
    if (found !== undefined) return found;
    if (call.path === `${EDITOR}/documents/revenu-net` && call.method === "GET") return { json: info };
    if (call.path === `${EDITOR}/check`) return { json: checked((call.body as { document: { graph?: { nodes: Nodes } } }).document) };
    if (call.path === `${EDITOR}/documents/revenu-net/draft`) return { json: { saved_at: "2026-10-30T10:00:00+00:00" } };
    if (call.path.startsWith("/api/workspaces/groupe-nordis/catalog")) return { json: [] };
    return undefined;
  });
}

function Harness({ ws }: { ws: Workspace }) {
  const route = useRoute();
  const heading = useRef<HTMLHeadingElement>(null);
  if (route.name !== "workspace") return null;
  return <Editor ws={ws} params={route.params} heading={heading} />;
}

const editor = () => render(<Harness ws={workspace({ account: "anna.k", role: "contributeur" })} />);
const panel = () => screen.getByRole("complementary", { name: "Propriétés" });
const bottom = () => screen.getByRole("region", { name: "Validation du document" });

beforeEach(() => {
  mockReactFlow();
  window.location.hash = "#/w/groupe-nordis/editeur?from=revenu-net";
});
afterEach(() => vi.unstubAllGlobals());

describe("éditeur", () => {
  it("ouvre la copie en v5 ; un filtre sans nulls bloque la soumission et « Aller au nœud » le sélectionne (critère 4)", async () => {
    server();
    editor();
    expect(await screen.findByRole("heading", { level: 1, name: "Revenu net : v5 · brouillon" })).toBeInTheDocument();
    expect(screen.getByText("schéma 1 · 2 nœuds · 1 arête")).toBeInTheDocument();
    await screen.findByText("Schéma invalide");
    const problem = within(bottom()).getByText("« nulls » est requis : gardés ou exclus.").closest("li")!;
    expect(within(problem).getByText("ERREUR")).toBeInTheDocument();
    expect(screen.getByText("Schéma invalide")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Soumettre la proposition" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Soumission bloquée : 1 erreur à corriger");

    await userEvent.click(within(problem).getByRole("button", { name: "Aller au nœud n02" }));
    expect(within(panel()).getByRole("heading", { name: "Filtre" })).toBeInTheDocument();
    await userEvent.click(within(panel()).getByRole("radio", { name: "exclues" }));
    await waitFor(() => expect(within(bottom()).queryByText("« nulls » est requis : gardés ou exclus.")).not.toBeInTheDocument());
    expect(await screen.findByText("Compilable Databricks, Snowflake")).toBeInTheDocument();
  });

  it("la palette ajoute n08 relié au nœud sélectionné ; le brouillon s'enregistre ; Annuler le retire", async () => {
    const { calls } = server();
    editor();
    await userEvent.click(await screen.findByRole("button", { name: "Aller au nœud n02" }));
    await userEvent.click(screen.getByRole("button", { name: "Calcul de colonne" }));
    expect(within(panel()).getByRole("heading", { name: "Calcul de colonne" })).toBeInTheDocument();
    expect(within(panel()).getByText("n08")).toBeInTheDocument();
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true), { timeout: 2000 });
    const saved = calls.filter((c) => c.method === "PUT").at(-1)!.body as { document: typeof DOCUMENT; highest: number; base_version: number };
    expect(saved.document.graph.nodes.at(-1)).toEqual({ id: "n08", type: "compute", inputs: ["n02"] });
    expect(saved.document.graph.output).toBe("n08");
    expect(saved).toMatchObject({ highest: 8, base_version: 4 });
    expect(await screen.findByText(/Enregistré .* \(local\)/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Annuler" }));
    expect(screen.getByText("schéma 1 · 2 nœuds · 1 arête")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Rétablir" }));
    expect(screen.getByText("schéma 1 · 3 nœuds · 2 arêtes")).toBeInTheDocument();
  });

  it("reprend le brouillon local, et peut repartir de la version courante (critère 9)", async () => {
    const draft = { ...structuredClone(DOCUMENT), label: "Revenu net corrigé" };
    const { calls } = server(opened({ draft: { document: draft, positions: {}, highest: 7, base_version: 4, saved_at: "2026-10-30T09:00:00+00:00" } }));
    editor();
    expect(await screen.findByText("Brouillon local repris")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Revenu net corrigé : v5 · brouillon" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Repartir de la v4" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Revenu net : v5 · brouillon" })).toBeInTheDocument();
    expect(calls.some((c) => c.method === "DELETE" && c.path.endsWith("/draft"))).toBe(true);
  });

  it("soumet le YAML du serveur avec la justification, puis supprime le brouillon (critère 10)", async () => {
    const info = opened();
    (info.document.graph as { nodes: Nodes }).nodes[1].nulls = "drop";
    const { calls } = server(info, (call) => {
      if (call.path === `${EDITOR}/preview`) return { json: { nature: "new_version", domain: "finance", required: 2, mention: null, diff: null } };
      if (call.path === "/api/workspaces/groupe-nordis/proposals") return { status: 201, json: { id: 12, title: "Revenu net v5", branch: "atlas/revenu-net-canonical", state: "open" } };
      return undefined;
    });
    editor();
    expect(await screen.findByText("Compilable Databricks, Snowflake")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Soumettre la proposition" }));
    const dialog = await screen.findByRole("dialog", { name: "Soumettre la proposition" });
    expect(await within(dialog).findByText("Nouvelle version")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Soumettre" }));
    expect(within(dialog).getByText("Expliquer la modification aux validateurs.")).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText(/Justification/), "Nouvelle source de factures.");
    await userEvent.click(within(dialog).getByRole("button", { name: "Soumettre" }));
    expect(await screen.findByRole("heading", { name: "Proposition n° 12 créée" })).toBeInTheDocument();
    const created = calls.find((c) => c.path === "/api/workspaces/groupe-nordis/proposals")!;
    expect(created.body).toEqual({ document_yaml: "label: Revenu net\n# 2 nœuds\n", justification: "Nouvelle source de factures.", base_version: 4 });
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.path.endsWith("/draft"))).toBe(true));
  });

  it("mode surcharge : seuls les nœuds se remplacent, hors points déclarés signalés (critère 7)", async () => {
    const canonical = { ...structuredClone(DOCUMENT), variation_points: ["n01"] };
    server(
      opened({
        mode: "override",
        kind: "variant",
        canonical,
        document: { schema_version: 1, kind: "variant", data_product: { id: "revenu-net--nordis-de", version: 4, owner: "anna.k" }, variant_of: { id: "revenu-net", version: 4 }, entity: "nordis-de", mode: "override", justification: "x" },
      }),
    );
    const { container } = editor();
    await screen.findByText("schéma 1 · 2 nœuds · 1 arête");
    // Clic direct : la pression de souris de userEvent réveille d3-drag, sans fenêtre sous jsdom.
    fireEvent.click(container.querySelector('[data-node-id="n02"]')!);
    expect(screen.getByRole("button", { name: "Calcul de colonne" })).toBeDisabled();
    expect(within(panel()).queryByRole("button", { name: /Supprimer/ })).not.toBeInTheDocument();
    expect(within(panel()).getByLabelText(/^Valeur/)).toHaveAttribute("readonly");
    await userEvent.click(within(panel()).getByRole("button", { name: "Remplacer ce nœud" }));
    expect(within(panel()).getByText("Hors points déclarés : la validation canonique s'appliquera")).toBeInTheDocument();
    expect(within(panel()).getByLabelText(/^Valeur/)).not.toHaveAttribute("readonly");
    expect(within(panel()).getByLabelText(/Justification de la surcharge/)).toBeInTheDocument();
  });
});

describe("nouveau document", () => {
  it("un identifiant déjà pris est refusé sous le champ ; sinon l'éditeur s'ouvre", async () => {
    window.location.hash = "#/w/groupe-nordis/editeur";
    const { calls } = fakeServer((call) => {
      if (call.path !== `${EDITOR}/documents`) return undefined;
      const body = call.body as { id: string };
      if (body.id === "revenu-net") return { status: 409, json: { detail: { code: "document_exists", message: "« revenu-net » existe déjà dans l'espace." } } };
      return { status: 201, json: opened({ id: body.id }) };
    });
    editor();
    expect(await screen.findByRole("heading", { level: 1, name: "Nouveau concept ou KPI" })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/^Libellé/), "Revenu net");
    expect(screen.getByLabelText(/^Identifiant/)).toHaveValue("revenu-net");
    expect(screen.getByLabelText(/^Propriétaire/)).toHaveValue("anna.k");
    await userEvent.click(screen.getByRole("button", { name: "Créer et ouvrir l'éditeur" }));
    expect(await screen.findByText("« revenu-net » existe déjà dans l'espace.")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Identifiant/)).toHaveAttribute("aria-invalid", "true");

    await userEvent.clear(screen.getByLabelText(/^Identifiant/));
    await userEvent.type(screen.getByLabelText(/^Identifiant/), "revenu-net-2");
    await userEvent.click(screen.getByRole("button", { name: "Créer et ouvrir l'éditeur" }));
    await waitFor(() => expect(window.location.hash).toBe("#/w/groupe-nordis/editeur?from=revenu-net-2"));
    expect(calls.filter((c) => c.method === "POST").at(-1)?.body).toEqual({ kind: "kpi", id: "revenu-net-2", label: "Revenu net", domain: "finance", owner: "anna.k" });
  });
});

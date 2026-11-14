import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, type CheckResult, type EditorDocument, type Workspace } from "../api";
import * as model from "../editor/model";
import { useRoute } from "../router";
import { fakeServer, settle, workspace, type Call } from "../test/fakeServer";
import { mockReactFlow } from "../test/reactFlow";
import { Editor } from "./Editor";

vi.mock("../editor/YamlView", () => ({ YamlView: ({ initial, onChange, label }: { initial: string; onChange: (s: string) => void; label: string }) => <textarea aria-label={label} defaultValue={initial} onChange={(e) => onChange(e.target.value)} /> }));

const tauri = vi.hoisted(() => ({
  enabled: false,
  onCloseRequested: vi.fn(),
  destroy: vi.fn(),
  unlisten: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => tauri.enabled }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => tauri }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

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
  tauri.enabled = false;
  tauri.onCloseRequested.mockReset().mockResolvedValue(tauri.unlisten);
  tauri.destroy.mockReset().mockResolvedValue(undefined);
  tauri.unlisten.mockReset();
  mockReactFlow();
  window.location.hash = "#/w/groupe-nordis/editeur?from=revenu-net";
});
// L'éditeur enregistre son brouillon en partant : on laisse finir cet envoi avant de
// retirer le faux serveur et l'environnement.
afterEach(async () => { await settle(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("éditeur", () => {
  it.each([
    ["Surcharge du canonique", "override"],
    ["Graphe indépendant", "from_scratch"],
  ] as const)("crée une déclinaison en mode %s puis ouvre son brouillon", async (label, mode) => {
    window.location.hash = "#/w/groupe-nordis/editeur?variant_of=revenu-net";
    const { calls } = fakeServer(({ path, method, body }) => {
      if (path === "/api/workspaces/groupe-nordis/documents/revenu-net/sheet") {
        return { json: { kind: "kpi", variants: [{ entity: "nordis-fr" }, { entity: "nordis-de" }, { entity: "nordis-es" }] } };
      }
      if (path === `${EDITOR}/variants` && method === "POST") {
        return { status: 201, json: { id: `revenu-net--${(body as { entity: string }).entity}` } };
      }
      if (path === `${EDITOR}/documents/revenu-net--nordis-it`) {
        const document = { schema_version: 1, kind: "variant", data_product: { id: "revenu-net--nordis-it", version: 1, owner: "anna.k" },
          variant_of: { id: "revenu-net", version: 4 }, entity: "nordis-it", mode, justification: "Règle locale." };
        return { json: opened({ id: "revenu-net--nordis-it", kind: "variant", mode, base_version: null,
          document, canonical: structuredClone(DOCUMENT),
          draft: { document, positions: {}, highest: 0, base_version: null, saved_at: "2026-11-06T10:00:00Z" } }) };
      }
      if (path.startsWith("/api/workspaces/groupe-nordis/catalog")) return { json: [] };
      if (path === `${EDITOR}/check`) return { json: checked((body as { document: { graph?: { nodes: Nodes } } }).document) };
      return undefined;
    });
    render(<Harness ws={workspace({ account: "anna.k", role: "contributeur", entities: ["nordis-fr", "nordis-de", "nordis-es", "nordis-it"] })} />);
    expect(await screen.findByRole("heading", { level: 1, name: "Nouvelle déclinaison de revenu-net" })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Entité/)).toHaveValue("nordis-it");
    expect(screen.queryByRole("option", { name: "nordis-fr" })).toBeNull();
    await userEvent.click(screen.getByRole("radio", { name: label }));
    await userEvent.type(screen.getByLabelText(/^Justification/), "Règle locale.");
    await userEvent.click(screen.getByRole("button", { name: "Créer et ouvrir l'éditeur" }));
    await waitFor(() => expect(window.location.hash).toBe("#/w/groupe-nordis/editeur?from=revenu-net--nordis-it"));
    await screen.findByRole("button", { name: "Éditer en YAML" });
    expect(screen.queryByText(/Brouillon local repris/)).toBeNull();
    expect(calls.find((call) => call.path === `${EDITOR}/variants` && call.method === "POST")?.body).toEqual({
      kpi_id: "revenu-net", entity: "nordis-it", mode, owner: "anna.k", justification: "Règle locale.",
    });
  });

  it("la liste des entités qui arrive ne déplace pas le formulaire : le mode choisi pendant le chargement reste", async () => {
    // Sous WebKit, un message de chargement retiré entre l'appui et le relâchement décalait le
    // formulaire de 28 px : le relâchement tombait hors du bouton radio et le clic était perdu.
    window.location.hash = "#/w/groupe-nordis/editeur?variant_of=revenu-net";
    const sheet = deferred<{ json: unknown }>();
    fakeServer(({ path }) => (path === "/api/workspaces/groupe-nordis/documents/revenu-net/sheet" ? sheet.promise : undefined));
    render(<Harness ws={workspace({ account: "anna.k", role: "contributeur", entities: ["nordis-fr", "nordis-it"] })} />);
    const form = (await screen.findByRole("heading", { level: 1, name: "Nouvelle déclinaison de revenu-net" })).closest("form")!;
    // Blocs qui occupent de la place au-dessus du choix du mode.
    const above = () => {
      const blocks = Array.from(form.children);
      return blocks.slice(0, blocks.findIndex((block) => block.tagName === "FIELDSET")).filter((block) => !block.classList.contains("sr-only"));
    };
    expect(screen.getByRole("status")).toHaveTextContent("Chargement des entités…");
    const during = above();
    await userEvent.click(screen.getByRole("radio", { name: "Graphe indépendant" }));

    await act(async () => sheet.resolve({ json: { kind: "kpi", variants: [{ entity: "nordis-fr" }] } }));
    expect(await screen.findByRole("option", { name: "nordis-it" })).toBeInTheDocument();
    expect(above()).toEqual(during);
    expect(screen.getByRole("status")).toHaveTextContent("");
    expect(screen.getByRole("radio", { name: "Graphe indépendant" })).toBeChecked();
  });

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
    await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Supprimer le brouillon" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Revenu net : v5 · brouillon" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Revenu net : v5 · brouillon" })).toHaveFocus();
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

  it("[S-0013-12] bloque la soumission après modification puis soumet le YAML du document validé", async () => {
    const info = opened();
    (info.document.graph as { nodes: Nodes }).nodes[1].nulls = "drop";
    const { calls } = server(info, (call) => {
      if (call.path === `${EDITOR}/check`) {
        const doc = (call.body as { document: typeof DOCUMENT }).document;
        return { json: { ...checked(doc), yaml: `label: ${doc.label}\n# ${doc.graph.nodes.length} nœuds\n` } };
      }
      if (call.path === `${EDITOR}/preview`) return { json: { nature: "new_version", domain: null, required: 1, mention: null, diff: null } };
      if (call.path.endsWith("/proposals")) return { json: { id: 12, title: "OK", branch: "test" } };
      return undefined;
    });
    editor();
    await screen.findByText("Compilable Databricks, Snowflake");
    await userEvent.click(screen.getByRole("button", { name: "Calcul de colonne" }));
    await userEvent.click(screen.getByRole("button", { name: "Soumettre la proposition" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Validation lancée : réessayer dans un instant.");
    await waitFor(() => expect(screen.getByRole("button", { name: "Soumettre la proposition" })).not.toHaveAttribute("aria-disabled"));
    await userEvent.click(screen.getByRole("button", { name: "Soumettre la proposition" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("Nouvelle version");
    await userEvent.type(within(dialog).getByLabelText(/Justification/), "Modification");
    await userEvent.click(within(dialog).getByRole("button", { name: "Soumettre" }));
    await waitFor(() => expect(calls.find((c) => c.path.endsWith("/proposals"))?.body).toMatchObject({ document_yaml: "label: Revenu net\n# 3 nœuds\n" }));
    expect((calls.find((c) => c.path.endsWith("/preview"))!.body as { document: typeof DOCUMENT }).document.graph.nodes).toHaveLength(3);
  });

  it("[S-0013-13] affiche l'échec de validation et bloque la soumission sans supprimer le brouillon", async () => {
    const { calls } = server(opened(), (call) => call.path === `${EDITOR}/check` ? { status: 500, json: { detail: "Validation impossible." } } : undefined);
    editor();
    expect(await screen.findByRole("alert")).toHaveTextContent("Validation impossible.");
    expect(screen.getByRole("button", { name: "Soumettre la proposition" })).toHaveAttribute("aria-disabled", "true");
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  });

  it("[S-0013-14] enregistre une modification en attente au démontage", async () => {
    const { calls } = server();
    const view = editor();
    await screen.findByText("Schéma invalide");
    await userEvent.click(screen.getByRole("button", { name: "Calcul de colonne" }));
    view.unmount();
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    expect((calls.find((c) => c.method === "PUT")!.body as { document: typeof DOCUMENT }).document.graph.nodes).toHaveLength(3);
  });

  it("[S-0013-14] [S-0013-21] déclenche l'enregistrement keepalive sur pagehide", async () => {
    const { calls } = server();
    editor();
    await screen.findByText("Schéma invalide");
    await userEvent.click(screen.getByRole("button", { name: "Calcul de colonne" }));
    fireEvent(window, new Event("pagehide"));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    const request = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "PUT");
    expect(request?.[1]?.keepalive).toBe(true);
  });

  it("[S-0013-14] conserve et reprend le texte YAML inachevé au départ", async () => {
    const { calls } = server();
    const view = editor();
    await screen.findByText("Schéma invalide");
    await userEvent.click(screen.getByRole("button", { name: "Éditer en YAML" }));
    const input = await screen.findByRole("textbox", { name: "YAML de Revenu net" });
    fireEvent.change(input, { target: { value: "label: [inachevé" } });
    view.unmount();
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    const draft = calls.find((c) => c.method === "PUT")!.body as NonNullable<EditorDocument["draft"]>;
    expect(draft.yaml_text).toBe("label: [inachevé");
    server(opened({ draft: { ...draft, saved_at: "2026-10-30T09:00:00Z" } }));
    editor();
    expect(await screen.findByRole("textbox", { name: "YAML de Revenu net" })).toHaveValue("label: [inachevé");
  });

  it("[S-0013-15] confirme la reprise, permet d'annuler et conserve la session si la suppression échoue", async () => {
    const draft = { document: { ...structuredClone(DOCUMENT), label: "Corrigé" }, positions: {}, highest: 7, base_version: 4, saved_at: "2026-10-30T09:00:00Z" };
    const { calls } = server(opened({ draft }), (call) => call.method === "DELETE" ? { status: 500, json: { detail: "Suppression impossible." } } : undefined);
    editor();
    await userEvent.click(await screen.findByRole("button", { name: "Repartir de la v4" }));
    expect(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Annuler" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Repartir de la v4" })).toHaveFocus();
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Repartir de la v4" }));
    await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Supprimer le brouillon" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Suppression impossible.");
    expect(screen.getByRole("heading", { name: "Corrigé : v5 · brouillon" })).toBeInTheDocument();
  });

  it("[S-0013-16] affiche l'échec de retour depuis YAML", async () => {
    server(opened(), (call) => call.path === `${EDITOR}/parse` ? { status: 500, json: { detail: "Analyse impossible." } } : undefined);
    editor();
    await screen.findByText("Schéma invalide");
    await userEvent.click(screen.getByRole("button", { name: "Éditer en YAML" }));
    await screen.findByRole("textbox", { name: "YAML de Revenu net" });
    await userEvent.click(screen.getByRole("button", { name: "Revenir au canevas" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Analyse impossible.");
  });

  it("[S-0013-13] relance une validation échouée et distingue une requête en cours", async () => {
    const info = opened();
    (info.document.graph as { nodes: Nodes }).nodes[1].nulls = "drop";
    const retry = deferred<CheckResult>();
    server(info);
    const validate = vi.spyOn(api, "editorCheck")
      .mockRejectedValueOnce(new Error("Validation indisponible."))
      .mockReturnValueOnce(retry.promise);
    editor();
    await screen.findByText(/Validation indisponible/);
    await userEvent.click(screen.getByRole("button", { name: "Soumettre la proposition" }));
    expect(screen.getByRole("alert")).toHaveTextContent("La validation a échoué : nouvelle tentative lancée.");
    expect(validate).toHaveBeenCalledTimes(2);
    await userEvent.click(screen.getByRole("button", { name: "Soumettre la proposition" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Validation en cours : réessayer dans un instant.");
    expect(validate).toHaveBeenCalledTimes(2);
    await act(async () => retry.resolve(checked(info.document)));
    expect(screen.getByRole("button", { name: "Soumettre la proposition" })).not.toHaveAttribute("aria-disabled");
  });

  it("[S-0013-18] écarte un brouillon YAML illisible, puis permet de modifier la nouvelle session", async () => {
    const draft = { document: structuredClone(DOCUMENT), yaml_text: "label: [ouvert", positions: {}, highest: 7, base_version: 4, saved_at: "2026-10-30T09:00:00Z" };
    const { calls } = server(opened({ draft }), (call) => call.path === `${EDITOR}/parse` ? { json: { document: null, issues: [] } } : undefined);
    const view = editor();
    await screen.findByRole("textbox", { name: "YAML de Revenu net" });
    expect(screen.getByText("Brouillon local repris")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Repartir de la v4" }));
    await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Annuler" }));
    expect(screen.getByRole("button", { name: "Repartir de la v4" })).toHaveFocus();
    expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "Repartir de la v4" }));
    await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Supprimer le brouillon" }));
    await screen.findByRole("region", { name: "Graphe" });
    expect(screen.getByRole("heading", { level: 1, name: "Revenu net : v5 · brouillon" })).toHaveFocus();
    expect(screen.queryByRole("textbox", { name: "YAML de Revenu net" })).toBeNull();
    fireEvent(window, new Event("pagehide"));
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "Calcul de colonne" }));
    view.unmount();
    await waitFor(() => expect(calls.filter((c) => c.method === "PUT")).toHaveLength(1));
    expect(calls.find((c) => c.method === "PUT")!.body).toMatchObject({ yaml_text: null });
  });

  it("[S-0013-22] garde Revenir au canevas actif pendant la frappe et conserve une saisie arrivée pendant l'analyse", async () => {
    server();
    const parsing = deferred<Awaited<ReturnType<typeof api.editorParse>>>();
    vi.spyOn(api, "editorParse").mockReturnValue(parsing.promise);
    const { unmount } = editor();
    await screen.findByText("Schéma invalide");
    await userEvent.click(screen.getByRole("button", { name: "Éditer en YAML" }));
    const input = await screen.findByRole("textbox", { name: "YAML de Revenu net" });
    fireEvent.change(input, { target: { value: "label: première saisie" } });
    const back = screen.getByRole("button", { name: "Revenir au canevas" });
    expect(back).not.toHaveAttribute("aria-disabled");
    await userEvent.click(back);
    fireEvent.change(input, { target: { value: "label: deuxième saisie" } });
    await act(async () => parsing.resolve({ document: { ...DOCUMENT, label: "première saisie" }, issues: [] }));
    expect(input).toHaveValue("label: deuxième saisie");
    expect(screen.getByRole("alert")).toHaveTextContent("Le YAML a changé pendant l'analyse");
    const save = vi.spyOn(api, "saveDraft");
    unmount();
    expect(save).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.objectContaining({ yaml_text: "label: deuxième saisie" }), false);
  });

  it("[S-0013-22] reste en YAML avec le texte et l'avis quand l'opération replace est refusée", async () => {
    const apply = model.apply;
    vi.spyOn(model, "apply").mockImplementation((doc, op) => {
      if (op.kind === "replace") throw new model.OpError("Remplacement refusé.");
      return apply(doc, op);
    });
    server();
    vi.spyOn(api, "editorParse").mockResolvedValue({ document: { ...DOCUMENT, label: "Modifié" }, issues: [] });
    editor();
    await screen.findByText("Schéma invalide");
    await userEvent.click(screen.getByRole("button", { name: "Éditer en YAML" }));
    const input = await screen.findByRole("textbox", { name: "YAML de Revenu net" });
    fireEvent.change(input, { target: { value: "label: Modifié" } });
    await userEvent.click(screen.getByRole("button", { name: "Revenir au canevas" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Remplacement refusé.");
    expect(input).toHaveValue("label: Modifié");
  });

  it.each(["soumission", "repartir"])("[S-0013-19] une sauvegarde échouée tardivement ne recrée pas le brouillon après %s", async (action) => {
    const info = opened();
    (info.document.graph as { nodes: Nodes }).nodes[1].nulls = "drop";
    info.draft = { document: info.document, positions: {}, highest: 7, base_version: 4, saved_at: "2026-10-30T09:00:00Z" };
    const { calls } = server(info, (call) => {
      if (call.path === `${EDITOR}/preview`) return { json: { nature: "new_version", domain: null, required: 1, mention: null, diff: null } };
      if (call.path.endsWith("/proposals")) return { json: { id: 12, title: "OK", branch: "test" } };
      return undefined;
    });
    const writing = deferred<{ saved_at: string }>();
    const save = vi.spyOn(api, "saveDraft").mockReturnValueOnce(writing.promise);
    const view = editor();
    await screen.findByText("Compilable Databricks, Snowflake");
    await userEvent.click(screen.getByRole("button", { name: "Calcul de colonne" }));
    fireEvent(window, new Event("pagehide"));
    expect(save).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole("button", { name: "Soumettre la proposition" })).not.toHaveAttribute("aria-disabled"));
    if (action === "soumission") {
      await userEvent.click(screen.getByRole("button", { name: "Soumettre la proposition" }));
      const dialog = await screen.findByRole("dialog");
      await within(dialog).findByText("Nouvelle version");
      await userEvent.type(within(dialog).getByLabelText(/Justification/), "Modification");
      await userEvent.click(within(dialog).getByRole("button", { name: "Soumettre" }));
      await screen.findByRole("heading", { name: "Proposition n° 12 créée" });
    } else {
      await userEvent.click(screen.getByRole("button", { name: "Repartir de la v4" }));
      await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Supprimer le brouillon" }));
    }
    expect(calls.some((c) => c.method === "DELETE")).toBe(false); // attend le PUT déjà lancé
    await act(async () => writing.reject(new Error("Écriture interrompue.")));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE")).toBe(true));
    if (action === "soumission") {
      fireEvent.keyDown(window, { key: "z", ctrlKey: true });
      fireEvent.keyDown(window, { key: "z", metaKey: true });
    }
    expect(screen.getByText(action === "soumission" ? "schéma 1 · 3 nœuds · 1 arête" : "schéma 1 · 2 nœuds · 1 arête")).toBeInTheDocument();
    fireEvent(window, new Event("pagehide"));
    view.unmount();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("[S-0013-14] [S-0013-20] [S-0013-21] enregistre sur visibilitychange hidden et réserve keepalive aux corps de moins de 60 Kio", async () => {
    server();
    editor();
    await screen.findByText("Schéma invalide");
    await userEvent.click(screen.getByRole("button", { name: "Éditer en YAML" }));
    const input = await screen.findByRole("textbox", { name: "YAML de Revenu net" });
    // Moins de 60 000 caractères, mais plus de 60 Kio en UTF-8.
    fireEvent.change(input, { target: { value: "é".repeat(31_000) } });
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    fireEvent(document, new Event("visibilitychange"));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === "PUT")).toBe(true));
    const request = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "PUT");
    expect(request?.[1]?.keepalive).toBe(false);
  });

  it.each(["succès", "délai dépassé"])("[S-0013-20] intercepte la fermeture Tauri, attend la sauvegarde puis détruit la fenêtre : %s", async (outcome) => {
    tauri.enabled = true;
    server();
    const writing = deferred<{ saved_at: string }>();
    const save = vi.spyOn(api, "saveDraft").mockReturnValueOnce(writing.promise);
    const view = editor();
    await screen.findByText("Schéma invalide");
    await waitFor(() => expect(tauri.onCloseRequested).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole("button", { name: "Calcul de colonne" }));
    fireEvent(window, new Event("pagehide"));
    expect(save).not.toHaveBeenCalled(); // pagehide est le repli navigateur
    if (outcome === "succès") {
      vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
      fireEvent(document, new Event("visibilitychange"));
      expect(save).toHaveBeenCalledTimes(1); // la fermeture attend aussi un PUT déjà lancé
    }
    vi.useFakeTimers();
    const event = { preventDefault: vi.fn() };
    let closing!: Promise<void>;
    act(() => { closing = tauri.onCloseRequested.mock.calls[0][0](event); });
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(tauri.destroy).not.toHaveBeenCalled();
    if (outcome === "succès") {
      await act(async () => { writing.resolve({ saved_at: "2026-11-06T10:00:00Z" }); await closing; });
    } else {
      await act(async () => vi.advanceTimersByTimeAsync(1999));
      expect(tauri.destroy).not.toHaveBeenCalled();
      await act(async () => { await vi.advanceTimersByTimeAsync(1); await closing; });
      await act(async () => writing.resolve({ saved_at: "2026-11-06T10:00:00Z" }));
    }
    expect(tauri.destroy).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(tauri.unlisten).toHaveBeenCalledTimes(1);
  });

  it("[S-0013-12] lance la validation pendant les 300 ms sans annoncer un échec", async () => {
    server();
    editor();
    await screen.findByText("Schéma invalide");
    const pending = deferred<CheckResult>();
    const validate = vi.spyOn(api, "editorCheck").mockReturnValueOnce(pending.promise);
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Calcul de colonne" }));
    expect(validate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Soumettre la proposition" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Validation lancée : réessayer dans un instant.");
    expect(screen.getByRole("alert")).not.toHaveTextContent("échoué");
    expect(validate).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(checked(DOCUMENT)));
  });

  it.each(["canevas", "YAML"])("[S-0013-15] annonce le gel pendant Repartir en vue %s et rétablit l'édition si la suppression échoue", async (view) => {
    const draft = { document: structuredClone(DOCUMENT), positions: {}, highest: 7, base_version: 4, saved_at: "2026-11-06T10:00:00Z",
      yaml_text: view === "YAML" ? "label: Revenu net" : null };
    server(opened({ draft }));
    const writing = deferred<{ saved_at: string }>();
    const deleting = deferred<null>();
    const save = vi.spyOn(api, "saveDraft").mockReturnValueOnce(writing.promise);
    const remove = vi.spyOn(api, "deleteDraft").mockReturnValueOnce(deleting.promise);
    const { container, unmount } = editor();
    const trigger = await screen.findByRole("button", { name: "Repartir de la v4" });
    const status = screen.getByRole("status", { name: "Reprise du brouillon" });
    expect(status).toBeEmptyDOMElement();
    if (view === "YAML") {
      fireEvent.change(await screen.findByRole("textbox", { name: "YAML de Revenu net" }), { target: { value: "label: avant reprise" } });
    } else {
      await userEvent.click(screen.getByRole("button", { name: "Calcul de colonne" }));
    }
    fireEvent(window, new Event("pagehide"));
    expect(save).toHaveBeenCalledTimes(1);
    await userEvent.click(trigger);
    await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Supprimer le brouillon" }));
    const zone = container.querySelector(view === "YAML" ? ".editor-yaml" : ".editor-body")!;
    expect(zone).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status", { name: "Reprise du brouillon" })).toBe(status);
    expect(status).toHaveTextContent("Reprise en cours : l'édition est suspendue");
    expect(screen.getByRole("alertdialog").closest("[inert]")).toBeNull();
    if (view === "canevas") {
      expect(container.querySelector(".canvas")).toHaveAttribute("inert");
      expect(container.querySelector(".props")).toHaveAttribute("inert");
      expect(container.querySelector(".editor-center")).not.toHaveAttribute("inert");
    }
    expect(remove).not.toHaveBeenCalled();
    await act(async () => writing.resolve({ saved_at: "2026-11-06T10:01:00Z" }));
    expect(remove).toHaveBeenCalledTimes(1);
    expect(zone).toHaveAttribute("aria-busy", "true");
    await act(async () => deleting.reject(new Error("Suppression refusée.")));
    expect(zone).toHaveAttribute("aria-busy", "false");
    expect(screen.getByRole("status", { name: "Reprise du brouillon" })).toBe(status);
    expect(status).toBeEmptyDOMElement();
    if (view === "canevas") {
      expect(container.querySelector(".canvas")).not.toHaveAttribute("inert");
      expect(container.querySelector(".props")).not.toHaveAttribute("inert");
    }
    expect(screen.queryByText(/Reprise en cours : l'édition est suspendue/)).toBeNull();
    expect(trigger).not.toBeDisabled();
    if (view === "YAML") {
      fireEvent.change(screen.getByRole("textbox", { name: "YAML de Revenu net" }), { target: { value: "label: après échec" } });
    } else {
      await userEvent.click(screen.getByRole("button", { name: "Calcul de colonne" }));
    }
    unmount();
    expect(save).toHaveBeenCalledTimes(2);
    const saved = save.mock.calls[1][2];
    if (view === "YAML") expect(saved.yaml_text).toBe("label: après échec");
    else expect((saved.document.graph as { nodes: Nodes }).nodes).toHaveLength(4);
  });

  it("[S-0013-18] rend le focus au déclencheur même si le clic laisse activeElement sur body", async () => {
    server(opened({ draft: { document: structuredClone(DOCUMENT), positions: {}, highest: 7, base_version: 4, saved_at: "2026-11-06T10:00:00Z" } }));
    editor();
    const trigger = await screen.findByRole("button", { name: "Repartir de la v4" });
    expect(document.activeElement).toBe(document.body);
    fireEvent.click(trigger);
    expect(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Annuler" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(trigger).toHaveFocus();
  });

  it("[S-0013-20] affiche un échec de destroy et permet une nouvelle demande de fermeture", async () => {
    tauri.enabled = true;
    tauri.destroy.mockRejectedValueOnce(new Error("Fermeture refusée."));
    server();
    editor();
    await screen.findByText("Schéma invalide");
    await waitFor(() => expect(tauri.onCloseRequested).toHaveBeenCalledTimes(1));
    const close = tauri.onCloseRequested.mock.calls[0][0];
    const event = { preventDefault: vi.fn() };
    await act(async () => close(event));
    expect(screen.getByRole("alert")).toHaveTextContent("Fermeture refusée.");
    expect(tauri.destroy).toHaveBeenCalledTimes(1);
    await act(async () => close(event));
    expect(tauri.destroy).toHaveBeenCalledTimes(2);
    expect(event.preventDefault).toHaveBeenCalledTimes(2);
  });

  it("[S-0013-20] une double demande de fermeture partage la sauvegarde et ne détruit la fenêtre qu'une fois", async () => {
    tauri.enabled = true;
    server();
    const writing = deferred<{ saved_at: string }>();
    const save = vi.spyOn(api, "saveDraft").mockReturnValueOnce(writing.promise);
    editor();
    await screen.findByText("Schéma invalide");
    await userEvent.click(screen.getByRole("button", { name: "Calcul de colonne" }));
    const close = tauri.onCloseRequested.mock.calls[0][0];
    const first = { preventDefault: vi.fn() };
    const second = { preventDefault: vi.fn() };
    let closing!: Promise<void>;
    act(() => { closing = close(first); });
    await act(async () => close(second));
    expect(first.preventDefault).toHaveBeenCalledTimes(1);
    expect(second.preventDefault).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(tauri.destroy).not.toHaveBeenCalled();
    await act(async () => { writing.resolve({ saved_at: "2026-11-06T10:00:00Z" }); await closing; });
    expect(tauri.destroy).toHaveBeenCalledTimes(1);
  });

  it.each([[61_439, true], [61_440, false]] as const)("[S-0013-21] un corps de %i octets utilise keepalive=%s", async (size, expected) => {
    server();
    const draft = { document: {}, positions: {}, highest: 0, base_version: null, yaml_text: "" };
    const overhead = new TextEncoder().encode(JSON.stringify(draft)).byteLength;
    draft.yaml_text = "x".repeat(size - overhead);
    await api.saveDraft("groupe-nordis", "revenu-net", draft, true);
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(new TextEncoder().encode(String(init?.body)).byteLength).toBe(size);
    expect(init?.keepalive).toBe(expected);
  });

  it("[S-0013-10] une suppression échouée après soumission laisse la proposition créée et ses liens accessibles", async () => {
    const info = opened();
    (info.document.graph as { nodes: Nodes }).nodes[1].nulls = "drop";
    server(info, (call) => {
      if (call.path === `${EDITOR}/preview`) return { json: { nature: "new_version", domain: null, required: 1, mention: null, diff: null } };
      if (call.path.endsWith("/proposals")) return { json: { id: 12, title: "OK", branch: "test" } };
      if (call.method === "DELETE") return { status: 500, json: { detail: "Suppression refusée." } };
      return undefined;
    });
    const save = vi.spyOn(api, "saveDraft");
    const { unmount } = editor();
    await screen.findByText("Compilable Databricks, Snowflake");
    await userEvent.click(screen.getByRole("button", { name: "Soumettre la proposition" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("Nouvelle version");
    await userEvent.type(within(dialog).getByLabelText(/Justification/), "Modification");
    await userEvent.click(within(dialog).getByRole("button", { name: "Soumettre" }));
    const notice = await screen.findByText("La proposition est créée, mais le brouillon local n'a pas pu être supprimé.");
    expect(notice).toHaveAttribute("role", "status");
    expect(notice.parentElement?.closest('[role="status"]')).toBeNull();
    expect(notice.previousElementSibling).toHaveClass("card");
    expect(screen.getByRole("heading", { name: "Proposition n° 12 créée" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Voir les propositions" })).toHaveAttribute("href", "#/w/groupe-nordis/propositions");
    expect(screen.getByRole("link", { name: "Retour à la fiche" })).toBeInTheDocument();
    expect(screen.queryByText(/Le brouillon local est supprimé/)).toBeNull();
    fireEvent(window, new Event("pagehide"));
    unmount();
    expect(save).not.toHaveBeenCalled();
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
  it("ne présente le brouillon comme repris qu'après une nouvelle ouverture", async () => {
    window.location.hash = "#/w/groupe-nordis/editeur";
    const draft = { document: structuredClone(DOCUMENT), positions: {}, highest: 0, base_version: null, saved_at: "2026-11-06T10:00:00Z" };
    fakeServer((call) => {
      if (call.path === `${EDITOR}/documents` && call.method === "POST") return { status: 201, json: { id: "revenu-net" } };
      if (call.path === `${EDITOR}/documents/revenu-net`) return { json: opened({ base_version: null, draft }) };
      if (call.path === `${EDITOR}/check`) return { json: checked((call.body as { document: { graph?: { nodes: Nodes } } }).document) };
      if (call.path.startsWith("/api/workspaces/groupe-nordis/catalog")) return { json: [] };
      return undefined;
    });
    const view = render(<StrictMode><Harness ws={workspace({ account: "anna.k", role: "contributeur" })} /></StrictMode>);
    fireEvent.change(screen.getByLabelText(/^Libellé/), { target: { value: "Revenu net" } });
    fireEvent.click(screen.getByRole("button", { name: "Créer et ouvrir l'éditeur" }));
    await screen.findByRole("button", { name: "Éditer en YAML" });
    expect(screen.queryByText(/Brouillon local repris/)).toBeNull();
    view.unmount();
    render(<StrictMode><Harness ws={workspace({ account: "anna.k", role: "contributeur" })} /></StrictMode>);
    expect(await screen.findByText(/Brouillon local repris/)).toBeInTheDocument();
  });

  it("conserve la création si la session est démontée pendant son chargement", async () => {
    window.location.hash = "#/w/groupe-nordis/editeur";
    const loading = deferred<EditorDocument>();
    const draft = { document: structuredClone(DOCUMENT), positions: {}, highest: 0, base_version: null, saved_at: "2026-11-06T10:00:00Z" };
    const info = opened({ base_version: null, draft });
    fakeServer((call) => {
      if (call.path === `${EDITOR}/documents` && call.method === "POST") return { status: 201, json: {} };
      if (call.path === `${EDITOR}/check`) return { json: checked((call.body as { document: { graph?: { nodes: Nodes } } }).document) };
      if (call.path.startsWith("/api/workspaces/groupe-nordis/catalog")) return { json: [] };
      return undefined;
    });
    vi.spyOn(api, "editorOpen").mockReturnValueOnce(loading.promise).mockResolvedValue(info);
    const view = editor();
    fireEvent.change(screen.getByLabelText(/^Libellé/), { target: { value: "Revenu net" } });
    fireEvent.click(screen.getByRole("button", { name: "Créer et ouvrir l'éditeur" }));
    await waitFor(() => expect(api.editorOpen).toHaveBeenCalled());
    view.unmount();
    loading.resolve(info);
    const reopened = editor();
    await screen.findByRole("button", { name: "Éditer en YAML" });
    expect(screen.queryByText(/Brouillon local repris/)).toBeNull();
    reopened.unmount();
    editor();
    expect(await screen.findByText(/Brouillon local repris/)).toBeInTheDocument();
  });

  it("propose de reprendre le brouillon qui occupe l'identifiant", async () => {
    window.location.hash = "#/w/groupe-nordis/editeur";
    fakeServer((call) => {
      if (call.path === `${EDITOR}/documents` && call.method === "POST") return { status: 409, json: { detail: { code: "draft_exists", message: "Un brouillon local existe déjà." } } };
      if (call.path === `${EDITOR}/documents/stock-moyen`) return { json: opened({ base_version: null, draft: { document: structuredClone(DOCUMENT), positions: {}, highest: 0, base_version: null, saved_at: "2026-11-06T10:00:00Z" } }) };
      if (call.path === `${EDITOR}/check`) return { json: checked((call.body as { document: { graph?: { nodes: Nodes } } }).document) };
      if (call.path.startsWith("/api/workspaces/groupe-nordis/catalog")) return { json: [] };
      return undefined;
    });
    editor();
    fireEvent.change(screen.getByLabelText(/^Libellé/), { target: { value: "Stock moyen" } });
    fireEvent.click(screen.getByRole("button", { name: "Créer et ouvrir l'éditeur" }));
    const resume = await screen.findByRole("link", { name: "Reprendre le brouillon" });
    expect(resume).toHaveAttribute("href", "#/w/groupe-nordis/editeur?from=stock-moyen");
    await userEvent.click(resume);
    expect(await screen.findByText(/Brouillon local repris/)).toBeInTheDocument();
  });

  it.each(["a", "a".repeat(65), "-ab", "ab_", "stock--moyen"])("refuse l'identifiant invalide %s", async (id) => {
    window.location.hash = "#/w/groupe-nordis/editeur";
    const { calls } = fakeServer(() => undefined);
    editor();
    fireEvent.change(screen.getByLabelText(/^Libellé/), { target: { value: "Concept" } });
    fireEvent.change(screen.getByLabelText(/^Identifiant/), { target: { value: id } });
    fireEvent.click(screen.getByRole("button", { name: "Créer et ouvrir l'éditeur" }));
    expect(screen.getByLabelText(/^Identifiant/)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(/De 2 à 64 caractères/)).toBeInTheDocument();
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it("valide aussi l'identifiant déduit et affiche le refus serveur sous le champ", async () => {
    window.location.hash = "#/w/groupe-nordis/editeur";
    const { calls } = fakeServer((call) => call.path === `${EDITOR}/documents`
      ? { status: 422, json: { detail: { code: "invalid_document", message: "Identifiant refusé par le serveur." } } } : undefined);
    editor();
    fireEvent.change(screen.getByLabelText(/^Libellé/), { target: { value: "A" } });
    fireEvent.click(screen.getByRole("button", { name: "Créer et ouvrir l'éditeur" }));
    expect(screen.getByText(/De 2 à 64 caractères/)).toBeInTheDocument();
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
    fireEvent.change(screen.getByLabelText(/^Libellé/), { target: { value: "Ab" } });
    fireEvent.click(screen.getByRole("button", { name: "Créer et ouvrir l'éditeur" }));
    expect(await screen.findByText("Identifiant refusé par le serveur.")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Identifiant/)).toHaveAccessibleDescription("Identifiant refusé par le serveur.");
  });
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

// --- formulaires de création, barre d'outils, clavier, YAML, surcharge ---------------------

const SHEET_PATH = "/api/workspaces/groupe-nordis/documents/revenu-net/sheet";
const counter = () => screen.getByText(/^schéma 1 ·/);
const node = (container: HTMLElement, id: string) => container.querySelector(`[data-node-id="${id}"]`)!;

describe("nouvelle déclinaison : refus et erreurs", () => {
  beforeEach(() => {
    window.location.hash = "#/w/groupe-nordis/editeur?variant_of=revenu-net";
  });

  const variantWs = (overrides = {}) => workspace({ account: "anna.k", role: "contributeur", entities: ["nordis-fr", "nordis-it"], ...overrides });

  it("sans entité libre, le formulaire le dit et ne peut pas être envoyé", async () => {
    fakeServer(({ path }) => path === SHEET_PATH ? { json: { kind: "kpi", variants: [{ entity: "nordis-fr" }, { entity: "nordis-it" }] } } : undefined);
    render(<Harness ws={variantWs()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Chargement des entités…");
    expect(await screen.findByText("Aucune entité de cet espace n'est disponible pour une nouvelle déclinaison.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Créer et ouvrir l'éditeur" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "Annuler" })).toHaveAttribute("href", "#/w/groupe-nordis/fiche/revenu-net?tab=declinaisons");
  });

  it("signale chaque champ requis manquant sans rien envoyer", async () => {
    const { calls } = fakeServer(({ path }) => path === SHEET_PATH ? { json: { kind: "kpi", variants: [] } } : undefined);
    render(<Harness ws={variantWs()} />);
    const entity = await screen.findByLabelText(/^Entité/);
    await waitFor(() => expect(entity).toHaveValue("nordis-fr"));
    await userEvent.selectOptions(entity, "");
    await userEvent.clear(screen.getByLabelText(/^Propriétaire/));
    await userEvent.click(screen.getByRole("button", { name: "Créer et ouvrir l'éditeur" }));
    expect(entity).toHaveAccessibleDescription("Choisir une entité sans déclinaison.");
    expect(screen.getByLabelText(/^Propriétaire/)).toHaveAccessibleDescription("Indiquer le propriétaire.");
    expect(screen.getByLabelText(/^Justification/)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Expliquer pourquoi cette déclinaison est nécessaire.")).toBeInTheDocument();
    expect(screen.getByText("Vous remplacerez les nœuds nécessaires du canonique.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "Graphe indépendant" }));
    expect(screen.getByText("Vous construirez un graphe à partir d'un canevas vide.")).toBeInTheDocument();
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it("un brouillon existant pour l'entité propose sa reprise ; changer d'entité retire le lien", async () => {
    fakeServer(({ path, method }) => {
      if (path === SHEET_PATH) return { json: { kind: "kpi", variants: [] } };
      if (path === `${EDITOR}/variants` && method === "POST") return { status: 409, json: { detail: { code: "draft_exists", message: "Un brouillon existe déjà pour nordis-fr." } } };
      return undefined;
    });
    render(<Harness ws={variantWs()} />);
    await waitFor(() => expect(screen.getByLabelText(/^Entité/)).toHaveValue("nordis-fr"));
    await userEvent.type(screen.getByLabelText(/^Justification/), "Règle locale.");
    await userEvent.click(screen.getByRole("button", { name: "Créer et ouvrir l'éditeur" }));
    expect(await screen.findByText("Un brouillon existe déjà pour nordis-fr.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Reprendre le brouillon" })).toHaveAttribute("href", "#/w/groupe-nordis/editeur?from=revenu-net--nordis-fr");
    expect(screen.getByRole("button", { name: "Créer et ouvrir l'éditeur" })).toBeEnabled();
    await userEvent.selectOptions(screen.getByLabelText(/^Entité/), "nordis-it");
    expect(screen.queryByRole("link", { name: "Reprendre le brouillon" })).toBeNull();
  });

  it("un échec inattendu à la création s'affiche en bandeau, pas sous un champ", async () => {
    fakeServer(({ path, method }) => {
      if (path === SHEET_PATH) return { json: { kind: "kpi", variants: [] } };
      if (path === `${EDITOR}/variants` && method === "POST") return { status: 500, json: { detail: "Dépôt verrouillé." } };
      return undefined;
    });
    render(<Harness ws={variantWs()} />);
    await waitFor(() => expect(screen.getByLabelText(/^Entité/)).toHaveValue("nordis-fr"));
    await userEvent.type(screen.getByLabelText(/^Justification/), "Règle locale.");
    await userEvent.click(screen.getByRole("button", { name: "Créer et ouvrir l'éditeur" }));
    expect(await screen.findByText("Dépôt verrouillé.")).toBeInTheDocument();
    expect(screen.getByText("L'opération a échoué")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Entité/)).not.toHaveAttribute("aria-invalid");
    expect(window.location.hash).toBe("#/w/groupe-nordis/editeur?variant_of=revenu-net");
  });

  it("la fiche du KPI illisible : bandeau d'échec, plus de chargement annoncé", async () => {
    fakeServer(({ path }) => path === SHEET_PATH ? { status: 500, json: { detail: "Fiche illisible." } } : undefined);
    render(<Harness ws={variantWs()} />);
    expect(await screen.findByText("Fiche illisible.")).toBeInTheDocument();
    expect(screen.queryByText("Chargement des entités…")).toBeNull();
    expect(screen.getByRole("button", { name: "Créer et ouvrir l'éditeur" })).toBeDisabled();
  });
});

describe("nouveau document : type, domaine et échecs", () => {
  beforeEach(() => {
    window.location.hash = "#/w/groupe-nordis/editeur";
  });

  it("crée un concept : le type choisi part au serveur", async () => {
    const { calls } = fakeServer((call) => call.path === `${EDITOR}/documents` ? { status: 201, json: {} } : undefined);
    editor();
    await userEvent.click(screen.getByRole("radio", { name: "Concept" }));
    fireEvent.change(screen.getByLabelText(/^Libellé/), { target: { value: "Commande client" } });
    await userEvent.selectOptions(screen.getByLabelText(/^Domaine/), "ventes");
    await userEvent.click(screen.getByRole("button", { name: "Créer et ouvrir l'éditeur" }));
    await waitFor(() => expect(window.location.hash).toBe("#/w/groupe-nordis/editeur?from=commande-client"));
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ kind: "concept", id: "commande-client", label: "Commande client", domain: "ventes", owner: "anna.k" });
  });

  it("libellé, domaine et propriétaire vides : une erreur sous chacun", async () => {
    const { calls } = fakeServer(() => undefined);
    editor();
    await userEvent.selectOptions(screen.getByLabelText(/^Domaine/), "");
    await userEvent.clear(screen.getByLabelText(/^Propriétaire/));
    await userEvent.click(screen.getByRole("button", { name: "Créer et ouvrir l'éditeur" }));
    expect(screen.getByLabelText(/^Libellé/)).toHaveAccessibleDescription("Donner un libellé.");
    expect(screen.getByLabelText(/^Domaine/)).toHaveAccessibleDescription("Choisir un domaine.");
    expect(screen.getByLabelText(/^Propriétaire/)).toHaveAccessibleDescription("Indiquer le propriétaire.");
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it("un échec inattendu s'affiche en bandeau et rend le bouton", async () => {
    fakeServer((call) => call.path === `${EDITOR}/documents` ? { status: 500, json: { detail: "Écriture impossible." } } : undefined);
    editor();
    fireEvent.change(screen.getByLabelText(/^Libellé/), { target: { value: "Stock moyen" } });
    await userEvent.click(screen.getByRole("button", { name: "Créer et ouvrir l'éditeur" }));
    expect(await screen.findByText("Écriture impossible.")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Identifiant/)).not.toHaveAttribute("aria-invalid");
    expect(screen.getByRole("button", { name: "Créer et ouvrir l'éditeur" })).toBeEnabled();
  });
});

describe("session d'édition : ouverture, outils et clavier", () => {
  it("annonce l'ouverture puis l'échec, avec un titre neutre", async () => {
    const opening = deferred<{ status: number; json: unknown }>();
    fakeServer((call) => {
      if (call.path === `${EDITOR}/documents/revenu-net`) return opening.promise;
      if (call.path.startsWith("/api/workspaces/groupe-nordis/catalog")) return { json: [] };
      return undefined;
    });
    editor();
    expect(screen.getByRole("heading", { level: 1, name: "Ouverture de l'éditeur…" })).toBeInTheDocument();
    await act(async () => opening.resolve({ status: 500, json: { detail: "Document illisible." } }));
    expect(await screen.findByRole("heading", { level: 1, name: "Éditeur" })).toBeInTheDocument();
    expect(screen.getByText("Document illisible.")).toBeInTheDocument();
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("outil arête : guide, Échap annule le départ, une arête existante est refusée puis le message se ferme", async () => {
    server();
    const { container } = editor();
    await screen.findByText("Schéma invalide");
    await userEvent.click(screen.getByRole("button", { name: "Ajouter une arête" }));
    expect(screen.getByRole("button", { name: "Ajouter une arête" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Cliquer le nœud de départ, puis celui d'arrivée.")).toBeInTheDocument();
    fireEvent.click(node(container, "n01"));
    expect(screen.getByText("Arête depuis n01 : cliquer le nœud d'arrivée.")).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.getByText("Cliquer le nœud de départ, puis celui d'arrivée.")).toBeInTheDocument();
    fireEvent.click(node(container, "n01"));
    fireEvent.click(node(container, "n02"));
    expect(screen.getByRole("alert")).toHaveTextContent("Cette arête existe déjà entre n01 et n02.");
    expect(counter()).toHaveTextContent("2 nœuds · 1 arête");
    await userEvent.click(screen.getByRole("button", { name: "Fermer le message" }));
    expect(screen.queryByRole("alert")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Sélection" }));
    expect(screen.queryByText(/Cliquer le nœud de départ/)).toBeNull();
  });

  it("outil arête : relie deux nœuds dans l'ordre des clics", async () => {
    const { calls } = server();
    const { container } = editor();
    await screen.findByText("Schéma invalide");
    await userEvent.click(screen.getByRole("button", { name: "Calcul de colonne" }));
    expect(counter()).toHaveTextContent("3 nœuds · 1 arête");
    await userEvent.click(screen.getByRole("button", { name: "Ajouter une arête" }));
    fireEvent.click(node(container, "n02"));
    fireEvent.click(node(container, "n08"));
    expect(counter()).toHaveTextContent("3 nœuds · 2 arêtes");
    expect(screen.getByText("Cliquer le nœud de départ, puis celui d'arrivée.")).toBeInTheDocument();
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true), { timeout: 2000 });
    const saved = calls.filter((c) => c.method === "PUT").at(-1)!.body as { document: typeof DOCUMENT };
    expect(saved.document.graph.nodes.find((n) => n.id === "n08")).toMatchObject({ inputs: ["n02"] });
  });

  it("Dupliquer puis Supprimer depuis le panneau de propriétés", async () => {
    server();
    const { container } = editor();
    await screen.findByText("Schéma invalide");
    fireEvent.click(node(container, "n02"));
    await userEvent.click(within(panel()).getByRole("button", { name: "Dupliquer" }));
    expect(counter()).toHaveTextContent("3 nœuds · 2 arêtes");
    expect(within(panel()).getByText("n08")).toBeInTheDocument();
    expect(node(container, "n08")).toHaveTextContent("statut = validée");
    await userEvent.click(within(panel()).getByRole("button", { name: "Supprimer" }));
    expect(counter()).toHaveTextContent("2 nœuds · 1 arête");
    expect(within(panel()).getByRole("heading", { name: "Document" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Annuler" }));
    expect(counter()).toHaveTextContent("3 nœuds · 2 arêtes");
  });

  it("Disposition automatique et Aligner réécrivent les positions du brouillon, jamais le document", async () => {
    const { calls } = server(opened({ positions: { n01: { x: 30, y: 37 }, n02: { x: 301, y: 50 } } }));
    editor();
    await screen.findByText("Schéma invalide");
    await userEvent.click(screen.getByRole("button", { name: "Aligner" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true), { timeout: 2000 });
    const aligned = calls.filter((c) => c.method === "PUT").at(-1)!.body as { positions: model.Positions; document: typeof DOCUMENT };
    expect(aligned.positions).toEqual(model.snap({ n01: { x: 30, y: 37 }, n02: { x: 301, y: 50 } }));
    expect(aligned.positions).not.toEqual({ n01: { x: 30, y: 37 }, n02: { x: 301, y: 50 } });
    expect(aligned.document).toEqual(DOCUMENT);
    const before = calls.filter((c) => c.method === "PUT").length;
    await userEvent.click(screen.getByRole("button", { name: "Disposition automatique" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "PUT").length).toBeGreaterThan(before), { timeout: 2000 });
    const laid = calls.filter((c) => c.method === "PUT").at(-1)!.body as { positions: model.Positions };
    expect(laid.positions).toEqual(model.autoLayout(model.nodesOf(DOCUMENT)));
    // Les positions ne passent pas par l'historique.
    expect(screen.getByRole("button", { name: "Annuler" })).toBeDisabled();
  });

  it("Aperçu SQL ouvre l'onglet SQL ; Valider le graphe relance la validation sur l'onglet Problèmes", async () => {
    const { calls } = server();
    editor();
    await screen.findByText("Schéma invalide");
    await userEvent.click(screen.getByRole("button", { name: "Aperçu SQL (Databricks)" }));
    expect(within(bottom()).getByRole("tab", { name: "SQL compilé" })).toHaveAttribute("aria-selected", "true");
    expect(within(bottom()).getByText("Le SQL se compile une fois les erreurs corrigées.")).toBeInTheDocument();
    await userEvent.click(within(bottom()).getByRole("radio", { name: "Snowflake" }));
    expect(screen.getByRole("button", { name: "Aperçu SQL (Snowflake)" })).toBeInTheDocument();
    const checks = calls.filter((c) => c.path === `${EDITOR}/check`).length;
    await userEvent.click(screen.getByRole("button", { name: "Valider le graphe" }));
    expect(within(bottom()).getByRole("tab", { name: /Problèmes/ })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(calls.filter((c) => c.path === `${EDITOR}/check`).length).toBe(checks + 1));
  });

  it("Ctrl+Z annule, Ctrl+Maj+Z et Ctrl+Y rétablissent ; pas dans un champ de saisie", async () => {
    server();
    editor();
    await screen.findByText("Schéma invalide");
    await userEvent.click(screen.getByRole("button", { name: "Calcul de colonne" }));
    expect(counter()).toHaveTextContent("3 nœuds");
    // Dans un champ, la frappe garde son propre historique.
    fireEvent.keyDown(within(panel()).getByLabelText(/^Libellé/), { key: "z", ctrlKey: true });
    expect(counter()).toHaveTextContent("3 nœuds");
    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    expect(counter()).toHaveTextContent("2 nœuds");
    fireEvent.keyDown(document.body, { key: "Z", ctrlKey: true, shiftKey: true });
    expect(counter()).toHaveTextContent("3 nœuds");
    fireEvent.keyDown(document.body, { key: "z", metaKey: true });
    expect(counter()).toHaveTextContent("2 nœuds");
    fireEvent.keyDown(document.body, { key: "y", ctrlKey: true });
    expect(counter()).toHaveTextContent("3 nœuds");
    // Sans modificateur, rien ne bouge.
    fireEvent.keyDown(document.body, { key: "z" });
    expect(counter()).toHaveTextContent("3 nœuds");
  });

  it("une validation en cours sur le document déjà validé retient la soumission", async () => {
    const info = opened();
    (info.document.graph as { nodes: Nodes }).nodes[1].nulls = "drop";
    server(info);
    editor();
    await screen.findByText("Compilable Databricks, Snowflake");
    const again = deferred<CheckResult>();
    vi.spyOn(api, "editorCheck").mockReturnValue(again.promise);
    await userEvent.click(screen.getByRole("button", { name: "Valider le graphe" }));
    await userEvent.click(screen.getByRole("button", { name: "Soumettre la proposition" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Validation en cours : réessayer dans un instant.");
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () => again.resolve(checked(info.document)));
  });

  it("un échec d'enregistrement du brouillon est signalé", async () => {
    server(opened(), (call) => call.method === "PUT" ? { status: 500, json: { detail: "Disque plein." } } : undefined);
    editor();
    await screen.findByText("Schéma invalide");
    await userEvent.click(screen.getByRole("button", { name: "Calcul de colonne" }));
    expect(await screen.findByText("Le brouillon n'a pas pu être enregistré sur ce poste.", {}, { timeout: 2000 })).toBeInTheDocument();
    expect(screen.getByText("Non enregistré")).toBeInTheDocument();
  });

  it("mode surcharge : outil arête désactivé ; Retirer la surcharge rend le nœud en lecture", async () => {
    server(
      opened({
        mode: "override",
        kind: "variant",
        canonical: { ...structuredClone(DOCUMENT), variation_points: ["n02"] },
        document: { schema_version: 1, kind: "variant", data_product: { id: "revenu-net--nordis-de", version: 4, owner: "anna.k" }, variant_of: { id: "revenu-net", version: 4 }, entity: "nordis-de", mode: "override", justification: "x" },
      }),
    );
    const { container } = editor();
    await screen.findByText("schéma 1 · 2 nœuds · 1 arête");
    expect(screen.getByRole("button", { name: "Ajouter une arête" })).toBeDisabled();
    expect(screen.getByText("Surcharge : seuls les nœuds existants se remplacent.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "revenu-net" })).toHaveAttribute("href", "#/w/groupe-nordis/fiche/revenu-net");
    fireEvent.click(node(container, "n02"));
    expect(within(panel()).getByText("Point de variation déclaré par le canonique.")).toBeInTheDocument();
    expect(within(panel()).queryByRole("button", { name: "Définir comme sortie du graphe" })).toBeNull();
    await userEvent.click(within(panel()).getByRole("button", { name: "Remplacer ce nœud" }));
    expect(within(panel()).queryByText(/Hors points déclarés/)).toBeNull();
    expect(node(container, "n02")).toHaveTextContent("Surcharge");
    await userEvent.click(within(panel()).getByRole("button", { name: "Retirer la surcharge" }));
    expect(within(panel()).getByRole("button", { name: "Remplacer ce nœud" })).toBeInTheDocument();
    expect(within(panel()).getByLabelText(/^Valeur/)).toHaveAttribute("readonly");
    expect(node(container, "n02")).not.toHaveTextContent("Surcharge");
  });
});

describe("session d'édition : vue YAML", () => {
  it("le texte saisi est analysé puis validé ; une erreur de syntaxe bloque le retour", async () => {
    const parsed = { ...structuredClone(DOCUMENT), label: "Revenu net modifié" };
    const { calls } = server(opened(), (call) => {
      if (call.path !== `${EDITOR}/parse`) return undefined;
      const text = (call.body as { text: string }).text;
      if (text.includes("[")) return { json: { document: null, issues: [{ path: "/", node_id: null, code: "yaml_syntax", message: "Crochet non fermé ligne 1.", severity: "error" }] } };
      return { json: { document: parsed, issues: [] } };
    });
    editor();
    await screen.findByText("Schéma invalide");
    await userEvent.click(screen.getByRole("button", { name: "Éditer en YAML" }));
    const input = await screen.findByRole("textbox", { name: "YAML de Revenu net" });
    expect(input).toHaveValue("label: Revenu net\n# 2 nœuds\n");
    expect(screen.queryByRole("toolbar")).toBeNull();
    expect(screen.getByRole("button", { name: "Soumettre la proposition" })).toHaveAttribute("aria-disabled", "true");

    fireEvent.change(input, { target: { value: "label: [Revenu" } });
    expect(await within(bottom()).findByText("Crochet non fermé ligne 1.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revenir au canevas" })).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(screen.getByRole("button", { name: "Revenir au canevas" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("YAML illisible : corriger l'erreur signalée pour revenir au canevas.");
    expect(input).toBeInTheDocument();

    const checks = calls.filter((c) => c.path === `${EDITOR}/check`).length;
    fireEvent.change(input, { target: { value: "label: Revenu net modifié" } });
    await waitFor(() => expect(calls.filter((c) => c.path === `${EDITOR}/check`).length).toBe(checks + 1));
    expect(await within(bottom()).findByText("« nulls » est requis : gardés ou exclus.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revenir au canevas" })).not.toHaveAttribute("aria-disabled");
  });

  it("revenir au canevas applique le YAML au document, annulable, et l'enregistre", async () => {
    const parsed = { ...structuredClone(DOCUMENT), label: "Revenu net modifié" };
    const { calls } = server(opened(), (call) => call.path === `${EDITOR}/parse` ? { json: { document: parsed, issues: [] } } : undefined);
    editor();
    await screen.findByText("Schéma invalide");
    await userEvent.click(screen.getByRole("button", { name: "Éditer en YAML" }));
    fireEvent.change(await screen.findByRole("textbox", { name: "YAML de Revenu net" }), { target: { value: "label: Revenu net modifié" } });
    await userEvent.click(screen.getByRole("button", { name: "Revenir au canevas" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Revenu net modifié : v5 · brouillon" })).toBeInTheDocument();
    expect(screen.getByRole("toolbar", { name: "Outils du canevas" })).toBeInTheDocument();
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true), { timeout: 2000 });
    expect(calls.filter((c) => c.method === "PUT").at(-1)!.body).toMatchObject({ document: { label: "Revenu net modifié" }, yaml_text: null });
    await userEvent.click(screen.getByRole("button", { name: "Annuler" }));
    expect(screen.getByRole("heading", { level: 1, name: "Revenu net : v5 · brouillon" })).toBeInTheDocument();
  });
});

describe("session d'édition : zoom", () => {
  it("Zoom avant et Zoom arrière changent le pourcentage affiché", async () => {
    server();
    editor();
    await screen.findByText("Schéma invalide");
    const zoom = screen.getByLabelText("Zoom");
    const value = () => Number(zoom.textContent!.replace(/\D/g, ""));
    await waitFor(() => expect(value()).toBeGreaterThan(0));
    const start = value();
    await userEvent.click(screen.getByRole("button", { name: "Zoom avant" }));
    await waitFor(() => expect(value()).toBeGreaterThan(start));
    const zoomed = value();
    await userEvent.click(screen.getByRole("button", { name: "Zoom arrière" }));
    await waitFor(() => expect(value()).toBeLessThan(zoomed));
  });
});

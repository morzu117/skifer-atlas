import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiffReport, GraphLayout, GraphNode, ProposalDetail, ProposalGraphs, ProposalItem, ProposalQueue } from "../api";
import { useRoute } from "../router";
import { fakeServer, workspace } from "../test/fakeServer";
import { mockReactFlow } from "../test/reactFlow";
import { diffMarks } from "../components/DiffColumns";
import { Proposals, PROPOSALS_CHANGED } from "./Proposals";

const API = "/api/workspaces/groupe-nordis/proposals";

function item(id: number, overrides: Partial<ProposalItem> = {}): ProposalItem {
  return {
    id,
    title: "Revenu net — nordis-de v4",
    branch: `atlas/revenu-net--nordis-de/v4-${id}`,
    author: "anna.k",
    state: "open",
    created_at: "2026-10-30T08:00:00+01:00",
    document_id: "revenu-net--nordis-de",
    document_kind: "variant",
    kpi_id: "revenu-net",
    entity: "nordis-de",
    nature: "undeclared",
    domain: "finance",
    base_version: 3,
    version: 4,
    approvals: { obtained: 0, required: 2 },
    approvers: [],
    changes_requested_by: [],
    ready_to_merge: false,
    mention: "Validation canonique exigée",
    explanation: "0 validation(s) sur 2.",
    ...overrides,
  };
}

const DE = item(5);
const SERVICE = item(2, {
  title: "Taux de service v3",
  author: "julien.h",
  document_id: "taux-de-service",
  document_kind: "kpi",
  kpi_id: null,
  entity: null,
  nature: "new_version",
  domain: "supply",
  base_version: 2,
  version: 3,
  approvals: { obtained: 1, required: 1 },
  ready_to_merge: true,
  mention: null,
  explanation: "Prête à fusionner.",
});
const CANONICAL = item(3, {
  title: "Revenu net v5",
  author: "julien.h",
  document_id: "revenu-net",
  document_kind: "kpi",
  kpi_id: null,
  entity: null,
  nature: "new_version",
  base_version: 4,
  version: 5,
  approvals: { obtained: 1, required: 2 },
  mention: null,
  explanation: "1 validation(s) sur 2.",
});

const QUEUE: ProposalQueue = {
  account: "claire.m",
  role: "referent",
  review_domains: ["finance"],
  domains: [
    { id: "finance", label: "Finance" },
    { id: "supply", label: "Supply" },
  ],
  entities: ["nordis-de", "nordis-es", "nordis-fr"],
  members: { "anna.k": "Anna K.", "claire.m": "Claire M.", "julien.h": "Julien H." },
  items: [DE, CANONICAL, SERVICE],
};

const VIEWER: ProposalDetail["viewer"] = {
  account: "claire.m",
  can_review: true,
  review_reason: null,
  can_merge: false,
  merge_reason: "0 validation(s) sur 2.",
};

function detail(of: ProposalItem, overrides: Partial<ProposalDetail> = {}): ProposalDetail {
  return {
    ...of,
    justification: "En Allemagne, une commande expédiée est comptabilisée comme revenu.",
    reviews: [],
    comments: [{ account: "claire.m", body: "FR a la même demande.", created_at: "2026-10-30T09:00:00+01:00" }],
    viewer: VIEWER,
    ...overrides,
  };
}

function node(id: string, layer: number, overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    type: "filter",
    type_label: "Filtre",
    family: "rows",
    title: `titre ${id}`,
    detail: `détail ${id}`,
    variation: false,
    output: false,
    layer,
    rank: 0,
    ...overrides,
  };
}

const LAYOUT: GraphLayout = {
  output: "n03",
  nodes: [node("n01", 0, { family: "source" }), node("n02", 1), node("n03", 2, { variation: true, output: true })],
  edges: [
    { id: "n01-n02", source: "n01", target: "n02", side: null },
    { id: "n02-n03", source: "n02", target: "n03", side: null },
  ],
  overrides: [],
};

const REPORT: DiffReport = {
  identical: false,
  relation: "override",
  base: { id: "revenu-net", version: 4, fingerprint: "a" },
  other: { id: "revenu-net--nordis-de", version: 4, fingerprint: "b" },
  differences: [
    {
      kind: "modified",
      node_ref: { base: "n02", other: "n02" },
      node_type: "filter",
      changes: [{ field: "condition", before: "statut:eq:validée", after: "statut:in:validée,expédiée" }],
      classification: "override_undeclared",
      severity: "critical",
      message: "Filtre : surcharge hors des points déclarés.",
    },
    {
      kind: "modified",
      node_ref: { base: "n03", other: "n03" },
      node_type: "compute",
      changes: [{ field: "label", before: "déduction des taxes", after: "déduction des taxes (MwSt DE 19 %)" }],
      classification: "override_declared",
      severity: "warn",
      message: "Calcul : surcharge sur un point déclaré.",
    },
    {
      kind: "modified",
      node_ref: null,
      node_type: "semantics",
      changes: [{ field: "timezone", before: "Europe/Paris", after: "Europe/Berlin" }],
      classification: "override_undeclared",
      severity: "critical",
      message: "Fuseau horaire : Europe/Paris → Europe/Berlin.",
    },
  ],
  summary: { by_classification: {}, by_severity: { info: 0, warn: 1, critical: 2 } },
};

const GRAPHS: ProposalGraphs = {
  base: { ...LAYOUT, label: "Canonique v4" },
  proposed: { ...LAYOUT, label: "Déclinaison nordis-de v4 (proposée)", overrides: ["n02", "n03"] },
  report: REPORT,
  undeclared: [
    { node: "n02", label: "Factures validées" },
    { node: "semantics.timezone", label: null },
  ],
  recurring: [{ node: "n02", label: "Factures validées", entities: ["nordis-de", "nordis-fr"] }],
};

type Overrides = { queue?: ProposalQueue; detail?: (n: number, call: number) => ProposalDetail };

function proposalServer({ queue = QUEUE, detail: detailOf }: Overrides = {}) {
  const items = () => queue.items;
  let reads = 0;
  return fakeServer(({ method, path }) => {
    if (path.startsWith(`${API}/queue`)) return { json: queue };
    const match = path.match(new RegExp(`^${API}/(\\d+)(/graphs|/reviews|/comments|/merge)?$`));
    if (!match) return undefined;
    const number = Number(match[1]);
    const found = items().find((i) => i.id === number)!;
    if (match[2] === "/graphs") return { json: number === 5 ? GRAPHS : { ...GRAPHS, undeclared: [], recurring: [] } };
    if (match[2] === "/reviews" && method === "POST") return { json: found };
    if (match[2] === "/comments" && method === "POST") return { json: { account: "claire.m", body: "ok", created_at: "" } };
    if (match[2] === "/merge" && method === "POST") return { json: { id: number, commit: "abc", tag: "t", version: found.version } };
    return { json: detailOf ? detailOf(number, reads++) : detail(found) };
  });
}

function Harness() {
  const route = useRoute();
  const heading = useRef<HTMLHeadingElement>(null);
  if (route.name !== "workspace") return null;
  return <Proposals ws={workspace()} params={route.params} heading={heading} />;
}

const queueList = () => screen.findByRole("list", { name: "File des propositions" });
const selection = () => screen.getByRole("region", { name: "Proposition sélectionnée" });

beforeEach(() => {
  mockReactFlow();
  window.location.hash = "#/w/groupe-nordis/propositions";
});
afterEach(() => vi.unstubAllGlobals());

describe("propositions", () => {
  it("file : badges, compteurs et « Mes domaines » par défaut (critères 1 et 2)", async () => {
    proposalServer();
    render(<Harness />);
    const list = await queueList();
    expect(within(list).getAllByRole("link")).toHaveLength(2); // Supply masqué : claire.m valide Finance
    const de = within(list).getAllByRole("link")[0];
    expect(within(de).getByText("Revenu net · nordis-de")).toBeInTheDocument();
    expect(within(de).getByText("Hors points déclarés")).toHaveClass("badge-warn-solid");
    expect(within(de).getByText("Validations : 0 / 2 (canonique requis)")).toBeInTheDocument();
    expect(de).toHaveAttribute("aria-current", "true");
    expect(within(list).getByText("Revenu net · canonique v5")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Domaine" })).toHaveValue("mes-domaines");

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Domaine" }), "tous");
    const all = await queueList();
    await waitFor(() => expect(within(all).getAllByRole("link")).toHaveLength(3));
    expect(within(all).getByText("Validations : 1 / 1 · prête à fusionner")).toBeInTheDocument();
    expect(window.location.hash).toContain("domain=tous");
  });

  it("filtre d'entité : le canonique seul", async () => {
    window.location.hash = "#/w/groupe-nordis/propositions?domain=tous&entity=canonique";
    proposalServer();
    render(<Harness />);
    const list = await queueList();
    expect(within(list).getAllByRole("link").map((l) => l.querySelector(".queue-item-title")?.textContent)).toEqual([
      "Revenu net · canonique v5",
      "Taux de service · canonique v3",
    ]);
  });

  it("détail de la surcharge DE : bandeau, verdicts des nœuds, liste des écarts (critères 3 et 7)", async () => {
    proposalServer();
    render(<Harness />);
    expect(await screen.findByRole("heading", { level: 2, name: "Surcharge sur Revenu net — nordis-de" })).toBeInTheDocument();
    const banner = await screen.findByText("Surcharge hors des points de variation déclarés");
    const text = banner.closest(".banner")!.textContent!;
    expect(text).toContain("« Factures validées » (n02), « semantics.timezone »");
    expect(text).toContain("(2 validateurs)");
    expect(text).toContain("nordis-de et nordis-fr surchargent tous n02");

    const proposed = await screen.findByRole("figure", { name: "Graphe : Déclinaison nordis-de v4 (proposée)" });
    await waitFor(() => expect(proposed.querySelectorAll(".graph-card")).toHaveLength(3));
    const card = (figure: HTMLElement, label: string) =>
      [...figure.querySelectorAll(".graph-card")].find((c) => c.textContent!.includes(label))!;
    expect(card(proposed, "titre n02")).toHaveClass("mark-modified");
    expect(card(proposed, "titre n02").querySelector(".graph-card-note")).toHaveTextContent("Divergence critique");
    expect(card(proposed, "titre n03")).toHaveClass("mark-overridden");
    expect(card(proposed, "titre n03").querySelector(".graph-card-note")).toHaveTextContent("Normal");
    const base = screen.getByRole("figure", { name: "Graphe : Canonique v4" });
    await waitFor(() => expect(base.querySelectorAll(".graph-card")).toHaveLength(3));
    expect(base.querySelectorAll("[class*='mark-']")).toHaveLength(0); // la référence n'est pas marquée

    // Critère 7 : chaque écart, y compris celui sans nœud, est repris en texte.
    const diff = screen.getByRole("region", { name: "Diff de la proposition" });
    const listed = diff.querySelectorAll(".diff-item");
    expect(listed).toHaveLength(3);
    expect(listed[2]).toHaveTextContent("Fuseau horaire : Europe/Paris → Europe/Berlin.");
    expect(within(diff).getByText("3 écarts", { exact: false })).toBeInTheDocument();

    expect(screen.getByText("En Allemagne, une commande expédiée est comptabilisée comme revenu.")).toBeInTheDocument();
    expect(screen.getByText("FR a la même demande.")).toBeInTheDocument();
  });

  it("l'auteur ne peut pas approuver : bouton grisé et raison (critère 4)", async () => {
    const reason = "Vous êtes l'auteur de cette proposition : un autre compte doit l'approuver.";
    const server = proposalServer({
      detail: (n) => detail(QUEUE.items.find((i) => i.id === n)!, { viewer: { ...VIEWER, account: "anna.k", can_review: false, review_reason: reason } }),
    });
    render(<Harness />);
    const approve = await screen.findByRole("button", { name: "Approuver (0 / 2)" });
    await waitFor(() => expect(approve).toHaveAttribute("aria-disabled", "true"));
    expect(approve).toHaveAccessibleDescription(reason);
    expect(screen.getByRole("tooltip")).toHaveTextContent(reason);
    await userEvent.click(approve);
    await userEvent.click(screen.getByRole("button", { name: "Demander des changements" }));
    expect(server.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    expect(screen.queryByRole("form", { name: "Demander des changements" })).not.toBeInTheDocument();
  });

  it("approuver relit le décompte et prévient la coque (critère 4)", async () => {
    const changed = vi.fn();
    window.addEventListener(PROPOSALS_CHANGED, changed);
    const server = proposalServer({
      detail: (n, call) => {
        const found = QUEUE.items.find((i) => i.id === n)!;
        return call < 1 ? detail(found) : detail({ ...found, approvals: { obtained: 1, required: 2 } }, { reviews: [
          { account: "claire.m", state: "approved", submitted_at: "2026-10-30T10:00:00+01:00", body: "", outdated: false },
        ] });
      },
    });
    render(<Harness />);
    const approve = await screen.findByRole("button", { name: "Approuver (0 / 2)" });
    await waitFor(() => expect(approve).not.toHaveAttribute("aria-disabled"));
    await userEvent.click(approve);
    expect(await screen.findByRole("button", { name: "Approuver (1 / 2)" })).toBeInTheDocument();
    expect(server.calls.find((c) => c.method === "POST")).toMatchObject({
      path: `${API}/5/reviews`,
      body: { event: "approve", body: "" },
    });
    expect(changed).toHaveBeenCalled();
    expect(screen.getByText("a approuvé", { exact: false })).toBeInTheDocument();
    window.removeEventListener(PROPOSALS_CHANGED, changed);
  });

  it("demander des changements exige un commentaire (critère 5)", async () => {
    const server = proposalServer();
    render(<Harness />);
    const ask = await screen.findByRole("button", { name: "Demander des changements" });
    await waitFor(() => expect(ask).not.toHaveAttribute("aria-disabled"));
    await userEvent.click(ask);
    const form = screen.getByRole("form", { name: "Demander des changements" });
    await userEvent.click(within(form).getByRole("button", { name: "Envoyer la demande" }));
    const field = within(form).getByLabelText(/Ce qui doit changer/);
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription("Expliquer ce qui doit changer : la demande part avec ce commentaire.");
    expect(server.calls.filter((c) => c.method === "POST")).toHaveLength(0);

    await userEvent.type(field, "Chiffrer l'écart de 6 %.");
    await userEvent.click(within(form).getByRole("button", { name: "Envoyer la demande" }));
    await waitFor(() => expect(screen.queryByRole("form", { name: "Demander des changements" })).not.toBeInTheDocument());
    expect(server.calls.find((c) => c.method === "POST")).toMatchObject({
      path: `${API}/5/reviews`,
      body: { event: "request_changes", body: "Chiffrer l'écart de 6 %." },
    });
  });

  it("répondre : commentaire vide refusé, puis envoyé", async () => {
    const server = proposalServer();
    render(<Harness />);
    const reply = await screen.findByLabelText("Répondre");
    await userEvent.click(within(selection()).getByRole("button", { name: "Envoyer" }));
    expect(reply).toHaveAccessibleDescription("Écrire un commentaire avant d'envoyer.");
    expect(server.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    await userEvent.type(reply, "Je regarde demain.");
    await userEvent.click(within(selection()).getByRole("button", { name: "Envoyer" }));
    await waitFor(() => expect(reply).toHaveValue(""));
    expect(server.calls.find((c) => c.method === "POST")).toMatchObject({ path: `${API}/5/comments`, body: { body: "Je regarde demain." } });
  });

  it("prête : « Fusionner », puis l'avis et le lien vers la fiche (critère 6)", async () => {
    window.location.hash = "#/w/groupe-nordis/propositions?domain=tous&n=2";
    const server = proposalServer({
      detail: (n) => detail(QUEUE.items.find((i) => i.id === n)!, { viewer: { ...VIEWER, can_merge: true, merge_reason: null } }),
    });
    render(<Harness />);
    expect(await screen.findByRole("heading", { level: 2, name: "Nouvelle version de Taux de service (v3)" })).toBeInTheDocument();
    const merge = await screen.findByRole("button", { name: "Fusionner" });
    expect(screen.queryByRole("button", { name: /Approuver/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Demander des changements" })).not.toBeInTheDocument();
    await userEvent.click(merge);
    expect(await screen.findByText("Proposition n° 2 fusionnée")).toBeInTheDocument();
    expect(screen.getByText("Taux de service passe en v3 sur la branche principale.")).toBeInTheDocument();
    expect(within(selection()).getAllByRole("link", { name: "Voir la fiche" })[0]).toHaveAttribute(
      "href",
      "#/w/groupe-nordis/fiche/taux-de-service",
    );
    expect(server.calls.find((c) => c.method === "POST")).toMatchObject({ path: `${API}/2/merge`, body: {} });
    expect(server.calls.filter((c) => c.path.startsWith(`${API}/queue`)).length).toBeGreaterThan(1);
  });
});

describe("diffMarks", () => {
  it("à gauche seulement le retiré, à droite modifié, ajouté ou surchargé, avec le verdict", () => {
    const report: DiffReport = {
      ...REPORT,
      differences: [
        ...REPORT.differences,
        { ...REPORT.differences[0], kind: "added", node_ref: { base: null, other: "n09" }, classification: "to_verify", severity: "warn" },
        { ...REPORT.differences[0], kind: "removed", node_ref: { base: "n04", other: null }, classification: "cosmetic", severity: "info" },
      ],
    };
    expect(diffMarks(report)).toEqual({
      base: { n04: "removed" },
      other: { n02: "modified", n03: "overridden", n09: "added" },
      baseNotes: { n04: "Sans effet" },
      otherNotes: { n02: "Divergence critique", n03: "Normal", n09: "À examiner" },
    });
  });
});

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiffReport, ProposalPreview } from "../api";
import { fakeServer } from "../test/fakeServer";
import { SubmitDialog } from "./SubmitDialog";

// Soumission (guide 10.3) : récapitulatif, nature, validations requises, écarts classés,
// justification obligatoire, et le YAML soumis tel que le serveur l'a produit.

const API = "/api/workspaces/groupe-nordis";
const DOCUMENT = { kind: "kpi", label: "Revenu net" };

const REPORT: DiffReport = {
  identical: false,
  relation: "version",
  base: { id: "revenu-net", version: 4, fingerprint: "a" },
  other: { id: "revenu-net", version: 5, fingerprint: "b" },
  differences: [{
    kind: "added", node_ref: { base: null, other: "n08" }, node_type: "compute", changes: [],
    classification: "critical", severity: "critical", message: "Calcul de colonne : nœud ajouté. Le résultat change.",
  }],
  summary: { by_classification: {}, by_severity: { info: 0, warn: 0, critical: 1 } },
};

function preview(overrides: Partial<ProposalPreview> = {}): ProposalPreview {
  return { nature: "new_version", domain: "finance", required: 2, mention: null, diff: REPORT, ...overrides };
}

function dialog(previewReply: Parameters<typeof fakeServer>[0] extends (c: never) => infer R ? R : never, proposal: Parameters<typeof fakeServer>[0] extends (c: never) => infer R ? R : never = { status: 201, json: { id: 12, title: "Revenu net v5", branch: "atlas/revenu-net", state: "open" } }) {
  const server = fakeServer((call) => {
    if (call.path === `${API}/editor/preview`) return previewReply;
    if (call.path === `${API}/proposals`) return proposal;
    return undefined;
  });
  const onClose = vi.fn();
  const onSubmitted = vi.fn();
  render(<SubmitDialog ws="groupe-nordis" document={DOCUMENT} yaml={"label: Revenu net\n"} baseVersion={4} onClose={onClose} onSubmitted={onSubmitted} />);
  return { ...server, onClose, onSubmitted, panel: () => screen.getByRole("dialog", { name: "Soumettre la proposition" }) };
}

afterEach(() => vi.unstubAllGlobals());

describe("SubmitDialog", () => {
  it("présente la nature, le domaine, les validations requises et les écarts", async () => {
    const { calls, panel } = dialog({ json: preview({ mention: "Le référent finance sera notifié." }) });
    expect(within(panel()).getByRole("status")).toHaveTextContent("Préparation du récapitulatif…");
    expect(within(panel()).getByRole("button", { name: "Soumettre" })).toBeDisabled();
    expect(await within(panel()).findByText("Nouvelle version")).toHaveClass("badge-pale");
    expect(within(panel()).getByText("finance")).toBeInTheDocument();
    expect(within(panel()).getByText("2")).toBeInTheDocument();
    expect(within(panel()).getByText("Le référent finance sera notifié.")).toBeInTheDocument();
    const diff = within(panel()).getByRole("region", { name: "Écarts" });
    expect(within(diff).getByRole("heading", { name: "1 écart" })).toBeInTheDocument();
    expect(diff).toHaveTextContent("Calcul de colonne : nœud ajouté. Le résultat change.");
    expect(calls.find((c) => c.path === `${API}/editor/preview`)?.body).toEqual({ document: DOCUMENT });
  });

  it("hors points déclarés : bandeau d'avertissement ; nouveau document : rien à comparer", async () => {
    const { panel } = dialog({ json: preview({ nature: "undeclared", domain: null, diff: null }) });
    expect(await within(panel()).findByText("Hors points déclarés : la validation canonique s'appliquera")).toBeInTheDocument();
    expect(within(panel()).getByText("Hors points déclarés", { selector: ".badge" })).toHaveClass("badge-warn-solid");
    expect(within(panel()).getByText("—")).toBeInTheDocument();
    expect(within(panel()).getByText("Nouveau document : pas de version à comparer.")).toBeInTheDocument();
    expect(within(panel()).queryByRole("region", { name: "Écarts" })).toBeNull();
  });

  it("une nature inconnue reste lisible, sous son code", async () => {
    const { panel } = dialog({ json: preview({ nature: "mystere" }) });
    expect(await within(panel()).findByText("mystere")).toHaveClass("badge-neutral");
  });

  it("un récapitulatif impossible est expliqué et la soumission reste fermée", async () => {
    const { panel } = dialog({ status: 422, json: { detail: { code: "preview_refused", message: "Le document est invalide." } } });
    await waitFor(() => expect(within(panel()).queryByText("Préparation du récapitulatif…")).toBeNull());
    expect(within(panel()).getByRole("alert")).toHaveTextContent("L'opération a échouéLe document est invalide.");
    expect(within(panel()).getByRole("button", { name: "Soumettre" })).toBeDisabled();
  });

  it("refuse une justification vide, puis soumet le YAML du serveur avec la justification nettoyée", async () => {
    const { calls, onSubmitted, panel } = dialog({ json: preview() });
    await within(panel()).findByText("Nouvelle version");
    const field = within(panel()).getByLabelText(/^Justification/);
    await userEvent.type(field, "   ");
    await userEvent.click(within(panel()).getByRole("button", { name: "Soumettre" }));
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(within(panel()).getByText("Expliquer la modification aux validateurs.")).toHaveClass("field-error");
    expect(calls.some((c) => c.path === `${API}/proposals`)).toBe(false);
    await userEvent.type(field, "TVA corrigée.  ");
    expect(field).not.toHaveAttribute("aria-invalid");
    await userEvent.click(within(panel()).getByRole("button", { name: "Soumettre" }));
    await waitFor(() => expect(onSubmitted).toHaveBeenCalledWith(expect.objectContaining({ id: 12, branch: "atlas/revenu-net" })));
    expect(calls.find((c) => c.path === `${API}/proposals`)?.body).toEqual({
      document_yaml: "label: Revenu net\n", justification: "TVA corrigée.", base_version: 4,
    });
  });

  it("un refus du serveur s'affiche et rend la main pour réessayer", async () => {
    const { onSubmitted, panel } = dialog(
      { json: preview() },
      { status: 409, json: { detail: { code: "branch_exists", message: "Une proposition est déjà ouverte pour ce document." } } },
    );
    await within(panel()).findByText("Nouvelle version");
    await userEvent.type(within(panel()).getByLabelText(/^Justification/), "TVA corrigée.");
    await userEvent.click(within(panel()).getByRole("button", { name: "Soumettre" }));
    expect(await within(panel()).findByText("Une proposition est déjà ouverte pour ce document.")).toBeInTheDocument();
    expect(onSubmitted).not.toHaveBeenCalled();
    expect(within(panel()).getByRole("button", { name: "Soumettre" })).toBeEnabled();
    expect(within(panel()).getByLabelText(/^Justification/)).toBeEnabled();
  });

  it("Annuler ferme le panneau", async () => {
    const { onClose, panel } = dialog({ json: preview() });
    await userEvent.click(within(panel()).getByRole("button", { name: "Annuler" }));
    expect(onClose).toHaveBeenCalled();
  });
});

import type { Ref } from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { fakeServer, workspace } from "../test/fakeServer";
import type { Workspace } from "../api";
import { WorkspaceShell } from "./WorkspaceShell";

vi.mock("./Administration", () => ({ Administration: ({ onMerged, onWorkspaceChange, ws, heading }: { onMerged: () => void; onWorkspaceChange: (next: Workspace) => void; ws: Workspace; heading: Ref<HTMLHeadingElement> }) => <><h1 ref={heading} tabIndex={-1}>Administration</h1><button onClick={onMerged}>Fusion administration</button><button onClick={() => onWorkspaceChange({ ...ws, git_remote: "depot" })}>Rattacher</button><input aria-label="Domaine suivant" /><span>{ws.domains.join(", ")}</span></> }));
vi.mock("./Proposals", () => ({ PROPOSALS_CHANGED: "proposals-changed", Proposals: ({ onMerged, heading }: { onMerged: () => void; heading: Ref<HTMLHeadingElement> }) => <><h1 ref={heading} tabIndex={-1}>Propositions</h1><button onClick={onMerged}>Fusion proposition</button></> }));

afterEach(() => vi.unstubAllGlobals());

it("le remplacement après rattachement rend le focus au titre", async () => {
  fakeServer(({ path }) => path === "/api/workspaces/groupe-nordis" ? { json: workspace() } : path.includes("proposals") ? { json: [] } : undefined);
  render(<WorkspaceShell wsId="groupe-nordis" view="administration" onUnknown={vi.fn()} />);
  await userEvent.click(await screen.findByRole("button", { name: "Rattacher" }));
  expect(screen.getByRole("heading", { level: 1, name: "Administration" })).toHaveFocus();
});

it("la réinitialisation depuis la bannière rend le focus au titre", async () => {
  fakeServer(({ path, method }) => {
    if (path.endsWith("/remote/reset") && method === "POST") return { json: { ...workspace(), reset: { status: "reset" } } };
    if (path === "/api/workspaces/groupe-nordis") return { json: workspace({ attachment: "interrupted" }) };
    if (path.includes("proposals")) return { json: [] };
    return undefined;
  });
  render(<WorkspaceShell wsId="groupe-nordis" view="propositions" onUnknown={vi.fn()} />);
  await userEvent.click(await screen.findByRole("button", { name: "Réinitialiser le rattachement" }));
  const dialog = screen.getByRole("alertdialog");
  expect(within(dialog).getByRole("button", { name: "Annuler" })).toHaveFocus();
  await userEvent.click(within(dialog).getByRole("button", { name: "Confirmer la réinitialisation" }));
  await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "Propositions" })).toHaveFocus());
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
});

it.each([
  ["administration", "Fusion administration"],
  ["propositions", "Fusion proposition"],
] as const)("[S-0033-12] une fusion depuis %s actualise les domaines de l'éditeur", async (view, action) => {
  let domains: string[] = [];
  const server = fakeServer(({ path }) => {
    if (path === "/api/workspaces/groupe-nordis") return { json: workspace({ domains: [...domains] }) };
    if (path.includes("proposals")) return { json: [] };
    return undefined;
  });
  const props = { wsId: "groupe-nordis", onUnknown: vi.fn() };
  const rendered = render(<WorkspaceShell {...props} view={view} />);
  await screen.findByRole("button", { name: action });
  domains = ["finance"];
  await userEvent.click(screen.getByRole("button", { name: action }));
  await waitFor(() => expect(server.calls.filter((call) => call.path === "/api/workspaces/groupe-nordis")).toHaveLength(2));
  rendered.rerender(<WorkspaceShell {...props} view="editeur" />);
  const select = await screen.findByLabelText(/Domaine/);
  expect(await within(select).findByRole("option", { name: "finance" })).toBeInTheDocument();
});

it("[S-0033-12] la relecture après fusion ne déplace pas le focus pendant la saisie", async () => {
  let resolveRefresh!: (value: { json: ReturnType<typeof workspace> }) => void;
  let reads = 0;
  const server = fakeServer(({ path }) => {
    if (path === "/api/workspaces/groupe-nordis") {
      reads += 1;
      if (reads === 2) return new Promise<{ json: ReturnType<typeof workspace> }>((resolve) => { resolveRefresh = resolve; });
      return { json: workspace() };
    }
    if (path.includes("proposals")) return { json: [] };
    return undefined;
  });
  render(<WorkspaceShell wsId="groupe-nordis" view="administration" onUnknown={vi.fn()} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Fusion administration" }));
  const input = screen.getByRole("textbox", { name: "Domaine suivant" });
  await user.type(input, "finance");
  resolveRefresh({ json: workspace({ domains: ["nouveau-domaine"] }) });
  await waitFor(() => expect(server.calls.filter((call) => call.path === "/api/workspaces/groupe-nordis")).toHaveLength(2));
  await screen.findByText("nouveau-domaine");
  expect(input).toHaveFocus();
});


it.each([{ status: "fast_forward" }, { status: "error", advanced: true }])("la copie reste visible et le catalogue est relu après une avance : $status", async (result) => {
  let finish!: (value: { json: { status: string; commit?: string; advanced?: boolean } }) => void;
  let version = 4;
  const server = fakeServer(({ path }) => {
    if (path.endsWith("/sync/auto")) return new Promise((resolve) => { finish = resolve; });
    if (path === "/api/workspaces/groupe-nordis") return { json: workspace() };
    if (path.includes("proposals")) return { json: [] };
    if (path.endsWith("/catalog")) return { json: [{ id: "revenu-net", label: "Revenu net", kind: "kpi", version, status: "validated", domain: "finance", owner: "julien.h", variant_count: 0, convergence: null }] };
    if (path.endsWith("/catalog/facets")) return { json: { domain: [], owner: [], status: [], kind: [] } };
    return undefined;
  });
  render(<WorkspaceShell wsId="groupe-nordis" view="catalogue" onUnknown={vi.fn()} />);
  expect(await screen.findByText("v4")).toBeInTheDocument();
  version = 5;
  await act(async () => finish({ json: { ...result, commit: "abc" } }));
  expect(await screen.findByText("v5")).toBeInTheDocument();
  expect(server.calls.filter((call) => call.path.endsWith("/catalog")).length).toBeGreaterThan(1);
});

it("retente une synchronisation occupée et relit le catalogue une seule fois", async () => {
  let calls = 0;
  let version = 4;
  const server = fakeServer(({ path }) => {
    if (path.includes("/sync/auto")) {
      calls += 1;
      if (calls === 1) return { json: { status: "busy" } };
      version = 5;
      return { json: { status: "fast_forward", commit: "nouveau" } };
    }
    if (path === "/api/workspaces/groupe-nordis") return { json: workspace() };
    if (path.includes("proposals")) return { json: [] };
    if (path.endsWith("/catalog")) return { json: [{ id: "revenu-net", label: "Revenu net", kind: "kpi", version, status: "validated", domain: "finance", owner: "julien.h", variant_count: 0, convergence: null }] };
    if (path.endsWith("/catalog/facets")) return { json: { domain: [], owner: [], status: [], kind: [] } };
    return undefined;
  });
  render(<WorkspaceShell wsId="groupe-nordis" view="catalogue" onUnknown={vi.fn()} />);
  expect(await screen.findByText("v4")).toBeInTheDocument();
  expect(await screen.findByText("v5")).toBeInTheDocument();
  expect(calls).toBe(2);
  expect(server.calls.filter((call) => call.path.endsWith("/catalog"))).toHaveLength(2);
});

it("un dépôt inaccessible laisse la vue locale et un signal discret", async () => {
  fakeServer(({ path }) => {
    if (path.endsWith("/sync/auto")) return { json: { status: "offline" } };
    if (path === "/api/workspaces/groupe-nordis") return { json: workspace() };
    if (path.includes("proposals")) return { json: [] };
    return undefined;
  });
  render(<WorkspaceShell wsId="groupe-nordis" view="propositions" onUnknown={vi.fn()} />);
  expect(await screen.findByRole("heading", { name: "Propositions" })).toBeInTheDocument();
  expect(await screen.findByText("Dépôt momentanément inaccessible")).toBeInTheDocument();
});

it("une avance conserve la saisie et le focus, et son rejeu ne relit pas deux fois", async () => {
  let finish!: (value: { json: { status: string; commit: string } }) => void;
  let calls = 0;
  const server = fakeServer(({ path }) => {
    if (path.includes("/sync/auto")) {
      calls++;
      if (calls === 1) return new Promise((resolve) => { finish = resolve; });
      return { json: { status: "fast_forward", commit: "nouveau" } };
    }
    if (path === "/api/workspaces/groupe-nordis") return { json: workspace() };
    if (path.includes("proposals")) return { json: [] };
    if (path.endsWith("/catalog")) return { json: [] };
    if (path.endsWith("/catalog/facets")) return { json: { domain: [], owner: [], status: [], kind: [] } };
    return undefined;
  });
  const props = { wsId: "groupe-nordis", onUnknown: vi.fn() };
  const rendered = render(<WorkspaceShell {...props} view="catalogue" />);
  const input = await screen.findByRole("searchbox", { name: "Rechercher dans le catalogue" });
  input.focus();
  await userEvent.type(input, "revenu");
  await act(async () => finish({ json: { status: "fast_forward", commit: "nouveau" } }));
  expect(input).toHaveValue("revenu");
  expect(input).toHaveFocus();
  await waitFor(() => expect(server.calls.filter((call) => call.path.endsWith("/catalog"))).toHaveLength(2));
  rendered.rerender(<WorkspaceShell {...props} view="propositions" />);
  await screen.findByRole("heading", { name: "Propositions" });
  await waitFor(() => expect(calls).toBe(2));
  expect(server.calls.filter((call) => call.path === "/api/workspaces/groupe-nordis")).toHaveLength(2);
});

it("un conflit affiche la consigne du référent une seule fois jusqu'au prochain succès", async () => {
  let status = "conflict";
  fakeServer(({ path }) => {
    if (path.includes("/sync/auto")) return { json: { status } };
    if (path === "/api/workspaces/groupe-nordis") return { json: workspace() };
    if (path.includes("proposals")) return { json: [] };
    return undefined;
  });
  const props = { wsId: "groupe-nordis", onUnknown: vi.fn() };
  const rendered = render(<WorkspaceShell {...props} view="propositions" />);
  expect(await screen.findByText(/Contactez le référent/)).toBeInTheDocument();
  rendered.rerender(<WorkspaceShell {...props} view="administration" />);
  await screen.findByRole("heading", { name: "Administration" });
  expect(screen.queryByText(/Contactez le référent/)).not.toBeInTheDocument();
  status = "up_to_date";
  rendered.rerender(<WorkspaceShell {...props} view="propositions" />);
  await waitFor(() => expect(screen.queryByText(/Contactez le référent/)).not.toBeInTheDocument());
});

it("attend la synchronisation forcée avant d'ouvrir un document dans l'éditeur", async () => {
  let finish!: (value: { json: { status: string } }) => void;
  const server = fakeServer(({ path }) => {
    if (path.includes("/sync/auto")) return new Promise((resolve) => { finish = resolve; });
    if (path === "/api/workspaces/groupe-nordis") return { json: workspace() };
    if (path.includes("proposals")) return { json: [] };
    if (path.includes("/editor/documents/revenu-net")) return new Promise(() => {});
    return undefined;
  });
  render(<WorkspaceShell wsId="groupe-nordis" view="editeur" params={{ from: "revenu-net" }} onUnknown={vi.fn()} />);
  await waitFor(() => expect(server.calls.some((call) => call.path.endsWith("/sync/auto?force=true"))).toBe(true));
  expect(server.calls.some((call) => call.path.includes("/editor/documents/revenu-net"))).toBe(false);
  expect(screen.getByRole("status")).toHaveTextContent("Mise à jour du dépôt…");
  await act(async () => finish({ json: { status: "up_to_date" } }));
  await waitFor(() => expect(server.calls.some((call) => call.path.includes("/editor/documents/revenu-net"))).toBe(true));
  expect(screen.getByRole("heading", { name: "Ouverture de l'éditeur…" })).toHaveFocus();
});

it("ouvre la copie locale si la synchronisation de l'éditeur dépasse le délai", async () => {
  const server = fakeServer(({ path }) => {
    if (path.includes("/sync/auto")) return new Promise(() => {});
    if (path === "/api/workspaces/groupe-nordis") return { json: workspace() };
    if (path.includes("proposals")) return { json: [] };
    return undefined;
  });
  render(<WorkspaceShell wsId="groupe-nordis" view="editeur" params={{ from: "revenu-net" }} onUnknown={vi.fn()} />);
  await waitFor(() => expect(server.calls.some((call) => call.path.includes("/editor/documents/revenu-net"))).toBe(true), { timeout: 3500 });
});


it("relit la nouvelle vue après une synchronisation commencée sur l’écran précédent", async () => {
  let finish!: (value: { json: { status: string; commit: string } }) => void;
  let calls = 0;
  let version = 4;
  const server = fakeServer(({ path }) => {
    if (path.includes("/sync/auto")) {
      if (++calls === 1) return new Promise((resolve) => { finish = resolve; });
      return { json: { status: "pending" } };
    }
    if (path === "/api/workspaces/groupe-nordis") return { json: workspace() };
    if (path.includes("proposals")) return { json: [] };
    if (path.endsWith("/catalog")) return { json: [{ id: "revenu-net", label: "Revenu net", kind: "kpi", version, status: "validated", domain: "finance", owner: "julien.h", variant_count: 0, convergence: null }] };
    if (path.endsWith("/catalog/facets")) return { json: { domain: [], owner: [], status: [], kind: [] } };
    return undefined;
  });
  const props = { wsId: "groupe-nordis", onUnknown: vi.fn() };
  const rendered = render(<WorkspaceShell {...props} view="propositions" />);
  await screen.findByRole("heading", { name: "Propositions" });
  await waitFor(() => expect(calls).toBe(1));
  rendered.rerender(<WorkspaceShell {...props} view="catalogue" />);
  await screen.findByText("v4");
  version = 5;
  await act(async () => finish({ json: { status: "fast_forward", commit: "nouveau" } }));
  expect(await screen.findByText("v5")).toBeInTheDocument();
  expect(server.calls.filter((call) => call.path.endsWith("/catalog")).length).toBeGreaterThan(1);
});

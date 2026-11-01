import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GitHubStatus } from "../api";
import { fakeServer, workspace, type Call } from "../test/fakeServer";
import { Connections } from "./Connections";
import { JoinWorkspace } from "./JoinWorkspace";

// Plan 0025 : jeton GitHub par le device flow, au coffre de l'espace. Aucun champ ne
// reçoit de jeton ; l'écran affiche un code, puis relit l'état.

vi.mock("../external", () => ({ openExternal: vi.fn(async () => undefined), canPickFile: () => false, pickFile: vi.fn() }));
import { openExternal } from "../external";

const API = "/api/workspaces/groupe-nordis";
const REMOTE = "https://github.com/nordis/annuaire.git";
const DEVICE = { flow: "f1", user_code: "WDJB-MJHT", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 0 };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(openExternal).mockClear();
});

function status(overrides: Partial<GitHubStatus> = {}): GitHubStatus {
  return { configured: true, applies: true, state: "absent", source: null, account: null, ...overrides };
}

function server(github: () => GitHubStatus, polls: string[] = ["connected"]) {
  return fakeServer((call: Call) => {
    if (call.path === `${API}/connections`) return { json: [] };
    if (call.path === `${API}/connections/platforms`) return { json: [] };
    if (call.path === `${API}/github` && call.method === "GET") return { json: github() };
    if (call.path === `${API}/github` && call.method === "DELETE") return { status: 204 };
    if (call.path === "/api/github/device") return { json: DEVICE };
    if (call.path === "/api/github/device/f1") {
      const next = polls.shift() ?? "pending";
      return { json: { status: next, interval: 0, ...(next === "connected" ? { account: "anna-k" } : {}) } };
    }
    return undefined;
  });
}

const screenOf = () => render(<Connections ws={workspace({ git_remote: REMOTE })} heading={createRef()} />);
const section = () => screen.findByRole("region", { name: "Dépôt de l'espace" });

describe("Mes connexions : dépôt GitHub de l'espace (plan 0025)", () => {
  it("affiche un code, ouvre GitHub, puis range le jeton sans aucun champ (critères 1 et 2)", async () => {
    let state = status();
    const fake = server(() => state);
    screenOf();
    const github = await section();
    expect(within(github).getByText("Jamais connecté")).toBeInTheDocument();
    expect(within(github).queryByRole("textbox")).toBeNull();
    state = status({ state: "connected", source: "vault", account: "anna-k" });
    await userEvent.click(within(github).getByRole("button", { name: "Se connecter à GitHub" }));
    expect(await within(github).findByText("WDJB-MJHT")).toBeInTheDocument();
    expect(fake.calls.find((c) => c.path === "/api/github/device")?.body).toEqual({ workspace: "groupe-nordis" });
    await userEvent.click(within(github).getByRole("button", { name: "Ouvrir GitHub" }));
    expect(openExternal).toHaveBeenCalledWith("https://github.com/login/device");
    expect(await within(github).findByText("Connecté à GitHub en tant que @anna-k.", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(await within(github).findByText("@anna-k")).toBeInTheDocument();
    expect(within(github).getByRole("button", { name: "Déconnecter GitHub" })).toBeInTheDocument();
  });

  it("un refus sur GitHub s'affiche et permet de recommencer (critère 5)", async () => {
    server(() => status(), ["denied"]);
    screenOf();
    const github = await section();
    await userEvent.click(within(github).getByRole("button", { name: "Se connecter à GitHub" }));
    expect(await within(github).findByRole("alert", {}, { timeout: 3000 })).toHaveTextContent("La connexion a été refusée sur GitHub.");
    expect(within(github).getByRole("button", { name: "Se connecter à GitHub" })).toBeEnabled();
  });

  it("« Déconnecter » retire le jeton du coffre (critère 6)", async () => {
    let state = status({ state: "connected", source: "vault", account: "anna-k" });
    const fake = server(() => state);
    screenOf();
    const github = await section();
    state = status();
    await userEvent.click(await within(github).findByRole("button", { name: "Déconnecter GitHub" }));
    expect(fake.calls.some((c) => c.method === "DELETE" && c.path === `${API}/github`)).toBe(true);
    expect(await within(github).findByText(/Jeton retiré du coffre/)).toBeInTheDocument();
    expect(await within(github).findByRole("button", { name: "Se connecter à GitHub" })).toBeInTheDocument();
  });

  it("sans client OAuth configuré, ni bouton ni champ ; hors GitHub, pas de section", async () => {
    server(() => status({ configured: false }));
    const { unmount } = screenOf();
    const github = await section();
    expect(within(github).getByText("Connexion GitHub non configurée pour cette installation")).toBeInTheDocument();
    expect(within(github).queryByRole("button")).toBeNull();
    unmount();
    server(() => status({ applies: false }));
    screenOf();
    await screen.findByText(/ne déclare encore aucun point d'accès/);
    expect(screen.queryByRole("region", { name: "Dépôt de l'espace" })).toBeNull();
  });
});

describe("Rejoindre un dépôt GitHub privé (plan 0025, critère 4)", () => {
  it("[S-0025-04] après un échec de clonage, la connexion GitHub relance l'adhésion avec son flux", async () => {
    const joined = vi.fn();
    const fake = fakeServer((call: Call) => {
      if (call.path === "/api/workspaces/join") {
        return (call.body as { github_flow?: string }).github_flow
          ? { status: 201, json: workspace({ git_remote: REMOTE }) }
          : { status: 502, json: { detail: { code: "clone_failed", message: "Authentication failed" } } };
      }
      if (call.path === "/api/github/device") return { json: DEVICE };
      if (call.path === "/api/github/device/f1") return { json: { status: "connected", interval: 0, account: "anna-k" } };
      return undefined;
    });
    render(<JoinWorkspace onClose={() => undefined} onJoined={joined} />);
    await userEvent.type(screen.getByLabelText(/Adresse du dépôt/), REMOTE);
    await userEvent.click(screen.getByRole("button", { name: "Cloner et ouvrir" }));
    expect(await screen.findByText(/Si le dépôt est privé, connectez-vous à GitHub/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Se connecter à GitHub" }));
    expect(await screen.findByText("WDJB-MJHT")).toBeInTheDocument();
    expect(fake.calls.find((c) => c.path === "/api/github/device")?.body).toEqual({});
    await waitFor(() => expect(joined).toHaveBeenCalled(), { timeout: 3000 });
    expect(fake.calls.filter((c) => c.path === "/api/workspaces/join").map((c) => c.body)).toEqual([
      { remote_url: REMOTE },
      { remote_url: REMOTE, github_flow: "f1" },
    ]);
  });

  it("un échec hors GitHub ne propose pas de connexion", async () => {
    fakeServer((call: Call) =>
      call.path === "/api/workspaces/join" ? { status: 502, json: { detail: { code: "clone_failed", message: "x" } } } : undefined,
    );
    render(<JoinWorkspace onClose={() => undefined} onJoined={() => undefined} />);
    await userEvent.type(screen.getByLabelText(/Adresse du dépôt/), "git@github.com:nordis/annuaire.git");
    await userEvent.click(screen.getByRole("button", { name: "Cloner et ouvrir" }));
    expect(await screen.findByText("Le dépôt n'a pas pu être cloné")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Se connecter à GitHub" })).toBeNull();
  });
});

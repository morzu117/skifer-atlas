import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeServer, type Call } from "../test/fakeServer";
import { GitHubConnect } from "./GitHubConnect";

// Device flow GitHub (plan 0025) : le composant seul, avec un faux serveur et des minuteries
// simulées pour suivre le rythme de sondage imposé par GitHub.

vi.mock("../external", () => ({ openExternal: vi.fn(async () => undefined) }));

const DEVICE = { flow: "f1", user_code: "WDJB-MJHT", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 1 };

function server(polls: { status: string; interval?: number; account?: string }[]) {
  return fakeServer((call: Call) => {
    if (call.path === "/api/github/device") return { json: DEVICE };
    if (call.path === "/api/github/device/f1") return { json: { interval: 1, ...(polls.shift() ?? { status: "pending" }) } };
    return undefined;
  });
}

const pollsOf = (calls: Call[]) => calls.filter((c) => c.path === "/api/github/device/f1").length;

async function startFlow() {
  await act(async () => screen.getByRole("button", { name: "Se connecter à GitHub" }).click());
  await screen.findByText("WDJB-MJHT");
}

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("GitHubConnect", () => {
  it("en attente, suit l'intervalle renvoyé par GitHub puis annonce le compte connecté", async () => {
    const onConnected = vi.fn();
    const { calls } = server([{ status: "pending", interval: 5 }, { status: "connected", account: "anna-k" }]);
    render(<GitHubConnect onConnected={onConnected} />);
    await startFlow();
    expect(screen.getByText("WDJB-MJHT")).toHaveAttribute("aria-label", "Code : W D J B - M J H T");
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(pollsOf(calls)).toBe(1);
    // GitHub a demandé 5 s : pas de nouveau sondage avant.
    await act(() => vi.advanceTimersByTimeAsync(4000));
    expect(pollsOf(calls)).toBe(1);
    await act(() => vi.advanceTimersByTimeAsync(1000));
    await waitFor(() => expect(onConnected).toHaveBeenCalledWith("f1", "anna-k"));
    expect(pollsOf(calls)).toBe(2);
    expect(screen.getByRole("button", { name: "Se connecter à GitHub" })).toBeEnabled();
  });

  it("le démarrage refusé par le serveur s'affiche et permet de recommencer", async () => {
    fakeServer((call) =>
      call.path === "/api/github/device" ? { status: 400, json: { detail: { code: "github_off", message: "Aucun client OAuth GitHub." } } } : undefined,
    );
    render(<GitHubConnect onConnected={vi.fn()} label="Connecter le dépôt" primary />);
    const button = screen.getByRole("button", { name: "Connecter le dépôt" });
    expect(button).toHaveClass("btn-primary");
    await act(async () => button.click());
    expect(await screen.findByRole("alert")).toHaveTextContent("Aucun client OAuth GitHub.");
    expect(screen.getByRole("button", { name: "Connecter le dépôt" })).toBeEnabled();
  });

  it("copie le code dans le presse-papiers et le dit", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    server([]);
    render(<GitHubConnect onConnected={vi.fn()} />);
    await startFlow();
    await act(async () => screen.getByRole("button", { name: "Copier le code" }).click());
    expect(writeText).toHaveBeenCalledWith("WDJB-MJHT");
    expect(screen.getByRole("button", { name: "Code copié" })).toBeInTheDocument();
  });

  it("une copie refusée ne prétend pas avoir copié", async () => {
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: vi.fn(async () => { throw new Error("refusé"); }) } });
    server([]);
    render(<GitHubConnect onConnected={vi.fn()} />);
    await startFlow();
    await act(async () => screen.getByRole("button", { name: "Copier le code" }).click());
    expect(screen.getByRole("button", { name: "Copier le code" })).toBeInTheDocument();
    expect(screen.queryByText("Code copié")).toBeNull();
  });

  it("Annuler abandonne le code et arrête les sondages", async () => {
    const onConnected = vi.fn();
    const { calls } = server([{ status: "connected", account: "anna-k" }]);
    render(<GitHubConnect onConnected={onConnected} />);
    await startFlow();
    await act(async () => screen.getByRole("button", { name: "Annuler" }).click());
    expect(screen.queryByText("WDJB-MJHT")).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(pollsOf(calls)).toBe(0);
    expect(onConnected).not.toHaveBeenCalled();
  });
});

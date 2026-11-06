import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onUnreachable, request, resetServerInfo, SERVER_INFO_RETRY, ServerInfoError, serverInfo, UnreachableError } from "./api";
import { explain } from "./messages";

// Adresse et token du serveur : le repli sans token n'existe que hors Tauri.

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const REAL = { baseUrl: "http://127.0.0.1:50321", token: "jeton-de-session" };

const underTauri = () => Object.assign(window, { __TAURI_INTERNALS__: {} });

beforeEach(() => {
  invoke.mockReset();
  resetServerInfo(null);
  SERVER_INFO_RETRY.delayMs = 1;
});

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  vi.unstubAllGlobals();
  resetServerInfo(null);
});

describe("serverInfo", () => {
  it("[S-0010-12] hors Tauri : le serveur de développement, sans token", async () => {
    const found = await serverInfo();
    expect(found.token).toBe("");
    expect(found.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("[S-0010-12] sous Tauri : prend l'adresse et le token de l'application, et les retient", async () => {
    underTauri();
    invoke.mockResolvedValue(REAL);
    expect(await serverInfo()).toEqual(REAL);
    expect(await serverInfo()).toEqual(REAL);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("[S-0010-12] sous Tauri : réessaie après un échec de invoke", async () => {
    underTauri();
    invoke.mockRejectedValueOnce(new Error("pas prêt")).mockRejectedValueOnce(new Error("pas prêt")).mockResolvedValue(REAL);
    expect(await serverInfo()).toEqual(REAL);
    expect(invoke).toHaveBeenCalledTimes(3);
  });

  it("[S-0010-12] sous Tauri : n'invente jamais un token vide, ne retient pas l'échec et le dit", async () => {
    underTauri();
    invoke.mockRejectedValue(new Error("commande absente"));
    const failure = await serverInfo().catch((error) => error);
    expect(failure).toBeInstanceOf(ServerInfoError);
    expect(failure).toBeInstanceOf(UnreachableError);
    expect(invoke).toHaveBeenCalledTimes(SERVER_INFO_RETRY.attempts);
    expect(explain(failure).text).toContain("Relancez Skifer Atlas");

    // L'échec n'a rien laissé en mémoire : l'essai suivant interroge de nouveau l'application.
    invoke.mockResolvedValue(REAL);
    expect(await serverInfo()).toEqual(REAL);
  });

  it("[S-0010-12] sous Tauri : un token vide rendu par l'application n'est pas accepté", async () => {
    underTauri();
    invoke.mockResolvedValue({ baseUrl: "http://127.0.0.1:50321", token: "" });
    await expect(serverInfo()).rejects.toBeInstanceOf(ServerInfoError);
  });

  it("[S-0010-12] une requête sans informations ne part pas sans token et prévient la coque", async () => {
    underTauri();
    invoke.mockRejectedValue(new Error("commande absente"));
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const warned = vi.fn();
    const stop = onUnreachable(warned);
    await expect(request("/api/workspaces")).rejects.toBeInstanceOf(ServerInfoError);
    stop();
    expect(fetch).not.toHaveBeenCalled();
    expect(warned).toHaveBeenCalledTimes(1);
  });
});

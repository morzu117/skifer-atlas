import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, onUnreachable, request, resetServerInfo, SERVER_INFO_RETRY, ServerInfoError, serverInfo, UnreachableError } from "./api";
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

describe("erreurs du serveur", () => {
  function replyWith(status: number, body: string | null) {
    resetServerInfo(REAL);
    const fetch = vi.fn(async () => new Response(body, { status, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetch);
    return fetch;
  }

  const failure = (promise: Promise<unknown>) => promise.then(() => { throw new Error("aurait dû échouer"); }, (error: unknown) => error as ApiError);

  it("lit le code, le message et les problèmes d'un détail structuré", async () => {
    replyWith(409, JSON.stringify({ detail: { code: "draft_exists", message: "Un brouillon existe.", issues: [{ path: "/id" }] } }));
    const error = await failure(request("/api/x"));
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: "draft_exists", message: "Un brouillon existe.", issues: [{ path: "/id" }] });
  });

  it("sans message, le code tient lieu de message", async () => {
    replyWith(400, JSON.stringify({ detail: { code: "invalid_entity" } }));
    expect(await failure(request("/api/x"))).toMatchObject({ code: "invalid_entity", message: "invalid_entity", issues: [] });
  });

  it("une validation FastAPI (liste) devient une requête refusée, avec ses détails", async () => {
    const detail = [{ loc: ["body", "id"], msg: "field required", type: "missing" }];
    replyWith(422, JSON.stringify({ detail }));
    expect(await failure(request("/api/x"))).toMatchObject({ status: 422, code: "invalid_request", message: "Requête refusée par le serveur.", issues: detail });
  });

  it("un détail texte devient le message, sous un code http_<statut>", async () => {
    replyWith(403, JSON.stringify({ detail: "Jeton refusé." }));
    expect(await failure(request("/api/x"))).toMatchObject({ code: "http_403", message: "Jeton refusé." });
  });

  it("un corps vide ou non JSON donne un message générique", async () => {
    replyWith(502, "<html>Bad gateway</html>");
    expect(await failure(request("/api/x"))).toMatchObject({ status: 502, code: "http_502", message: "Erreur 502." });
  });

  it("une réponse 204 rend null sans lire de corps", async () => {
    replyWith(204, null);
    expect(await request("/api/x")).toBeNull();
  });

  it("envoie le token de session en Bearer", async () => {
    const fetch = replyWith(200, "{}");
    await request("/api/x");
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:50321/api/x", expect.objectContaining({
      headers: { "Content-Type": "application/json", Authorization: "Bearer jeton-de-session" },
    }));
  });
});

describe("routes de l'API", () => {
  function capture() {
    resetServerInfo(REAL);
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    return () => fetch.mock.calls.map(([url, init]) => [init?.method ?? "GET", url.replace(REAL.baseUrl, "")]);
  }

  it("encode l'entité et la plateforme de l'extraction, en POST", async () => {
    const calls = capture();
    await api.extract("groupe nordis", "revenu-net", "nordis/fr", "data bricks");
    expect(calls()).toEqual([["POST", "/api/workspaces/groupe%20nordis/documents/revenu-net/implementations/nordis%2Ffr/data%20bricks/extract"]]);
  });

  it("lit le brouillon de fiche, l'historique d'un KPI et oublie un identifiant de brouillon", async () => {
    const calls = capture();
    await api.draft("groupe-nordis", "revenu-net");
    await api.comparisons("groupe-nordis", "marge & co", 3);
    await api.forgetDraftCredential("groupe-nordis", "snowflake/eu");
    expect(calls()).toEqual([
      ["GET", "/api/workspaces/groupe-nordis/documents/revenu-net/draft"],
      ["GET", "/api/workspaces/groupe-nordis/comparisons?kpi=marge%20%26%20co&limit=3"],
      ["DELETE", "/api/workspaces/groupe-nordis/access-point-draft/credentials/snowflake%2Feu"],
    ]);
  });
});

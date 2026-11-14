import { cleanup } from "@testing-library/react";
import { vi } from "vitest";
import { resetServerInfo, type Workspace } from "../api";

// Faux serveur local pour les tests de composants : `fetch` remplacé, réponses par route.

export type Call = { method: string; path: string; body: unknown; headers: Record<string, string> };
type Reply = { status?: number; json?: unknown } | "down" | Promise<{ status?: number; json?: unknown }>;
type Handler = (call: Call) => Reply | undefined;

/** Réponses du faux serveur pas encore rendues (toutes instances confondues). */
const inflight = new Set<Promise<unknown>>();

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

/** Démonte l'écran puis laisse finir les requêtes qu'il a lancées en partant (brouillon
 * enregistré au démontage…) tant que jsdom existe encore : sinon leur `.finally` tombe
 * après la fin de l'environnement (« window is not defined »). À appeler dans un
 * afterEach, avant `vi.unstubAllGlobals()`. Une réponse volontairement suspendue par un
 * test n'est attendue que 500 ms. */
export async function settle() {
  cleanup();
  vi.useRealTimers();
  for (let waited = 0; inflight.size > 0 && waited < 500; waited += 5) await tick(5);
  // Après la réponse : lecture du corps, puis `.then` / `.finally` de l'appelant.
  for (let i = 0; i < 3; i++) await tick();
}

export function fakeServer(handler: Handler) {
  const calls: Call[] = [];
  let down = false;
  resetServerInfo({ baseUrl: "http://srv", token: "jeton" });
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit = {}) => {
      const pending = respond(url, init);
      inflight.add(pending);
      void pending.then(() => inflight.delete(pending), () => inflight.delete(pending));
      return pending;
    }),
  );
  async function respond(url: string, init: RequestInit) {
    const path = url.replace("http://srv", "");
    const call: Call = {
      method: init.method ?? "GET",
      path,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
      headers: (init.headers ?? {}) as Record<string, string>,
    };
    calls.push(call);
    if (down) throw new TypeError("Failed to fetch");
    let reply = handler(call);
    if (reply === undefined && path === "/health") reply = { json: { status: "ok", version: "0.0.1" } };
    if (reply === undefined) reply = { status: 404, json: { detail: { code: "not_found", message: path } } };
    if (reply === "down") throw new TypeError("Failed to fetch");
    const { status = 200, json = {} } = await reply;
    // 204 : une réponse sans corps, comme le vrai serveur.
    return new Response(status === 204 ? null : JSON.stringify(json), { status, headers: { "Content-Type": "application/json" } });
  }
  return {
    calls,
    setDown(value: boolean) {
      down = value;
    },
  };
}

export function workspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "groupe-nordis",
    name: "Groupe Nordis",
    sector: "Retail",
    git_remote: "/depots/nordis.git",
    account: "julien.h",
    role: "referent",
    role_label: "Référent d'annuaire",
    space_referent: true,
    domains: ["finance", "ventes", "supply", "marketing"],
    entities: ["nordis-fr", "nordis-de", "nordis-es"],
    counts: { kpi: 42, concept: 18, open_proposals: 5 },
    ...overrides,
  };
}

export const ALTAVIA = workspace({
  id: "altavia-energie",
  name: "Altavia Énergie",
  sector: "Énergie",
  role: "contributeur",
  role_label: "Contributeur",
  space_referent: false,
  domains: ["finance", "ventes"],
  entities: ["a1", "a2", "a3", "a4", "a5"],
  counts: { kpi: 17, concept: 1, open_proposals: 0 },
});

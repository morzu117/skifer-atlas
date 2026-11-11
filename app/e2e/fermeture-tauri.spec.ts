import { expect, type BrowserContext, type Page } from "@playwright/test";
import { API, seriousViolations } from "./demo";
import { isolatedDemo, test } from "./isolation";

// ADR 0040, issue #154 : sous macOS, Cmd+Q et « Quitter » du Dock passent par la fermeture
// de la fenêtre principale, qui émet `tauri://close-requested`. Le pont Tauri est simulé dans
// la page (`__TAURI_INTERNALS__`, comme serveur-tauri.spec.ts), au niveau où
// `@tauri-apps/api` l'appelle :
// - `getCurrentWindow().onCloseRequested(h)` → `invoke("plugin:event|listen", { event,
//   target: { kind: "Window", label }, handler })`, où `handler` est l'identifiant rendu par
//   `transformCallback` ; la vraie fenêtre rappelle ce callback avec `{ event, id, payload }` ;
// - `destroy()` → `invoke("plugin:window|destroy", { label })`.
// Le serveur est le vrai. La partie native (Cocoa, `terminate:`) est couverte par
// scripts/smoke-app.sh (S-0040-02).
const TOKEN = "jeton-de-session-e2e";
const CLOSE = "tauri://close-requested";

type Bridge = { journal: string[]; listening: () => number; close: () => void };

/** Installé pour toutes les pages du contexte : la page rouverte est aussi « sous Tauri ». */
async function simulateTauri(context: BrowserContext) {
  await context.addInitScript(([base, token, close]) => {
    type Callback = (payload: unknown) => unknown;
    const callbacks = new Map<number, Callback>();
    const listeners: { event: string; id: number; handler: number }[] = [];
    // Ordre observé : écriture du brouillon (envoi, réponse du serveur), puis destruction.
    const journal: string[] = [];
    let next = 1;
    const w = window as unknown as Record<string, unknown>;
    w.isTauri = true; // `isTauri()` de @tauri-apps/api/core, utilisé par l'éditeur
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => undefined };
    w.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
      transformCallback: (callback: Callback, once = false) => {
        const id = next++;
        callbacks.set(id, (payload) => {
          if (once) callbacks.delete(id);
          return callback(payload);
        });
        return id;
      },
      unregisterCallback: (id: number) => { callbacks.delete(id); },
      invoke: async (command: string, args: Record<string, unknown> = {}) => {
        switch (command) {
          case "get_server_info":
            return { baseUrl: base, token };
          case "plugin:event|listen": {
            const id = next++;
            listeners.push({ event: args.event as string, id, handler: args.handler as number });
            return id;
          }
          case "plugin:event|unlisten": {
            const at = listeners.findIndex((l) => l.id === args.eventId);
            if (at >= 0) listeners.splice(at, 1);
            return null;
          }
          case "plugin:window|destroy":
            journal.push(`destroy:${String(args.label)}`);
            return null;
          default:
            journal.push(`inattendu:${command}`);
            throw new Error(`commande inattendue : ${command}`);
        }
      },
    };
    const send = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const draft = init?.method === "PUT" && /\/editor\/documents\/[^/]+\/draft$/.test(url);
      if (draft) journal.push("brouillon:envoi");
      const response = await send(input, init);
      if (draft) journal.push(`brouillon:${response.status}`);
      return response;
    };
    const bridge: Bridge = {
      journal,
      listening: () => listeners.filter((l) => l.event === close).length,
      // Ce que fait la fenêtre native après Cmd+Q ou « Quitter » du Dock (ADR 0040).
      close: () => {
        for (const l of listeners.filter((x) => x.event === close)) callbacks.get(l.handler)?.({ event: close, id: l.id, payload: null });
      },
    };
    w.tauriWindow = bridge;
  }, [API, TOKEN, CLOSE] as const);
}

const bridge = (page: Page) => ({
  journal: () => page.evaluate(() => [...(window as unknown as { tauriWindow: Bridge }).tauriWindow.journal]),
  listening: () => page.evaluate(() => (window as unknown as { tauriWindow: Bridge }).tauriWindow.listening()),
  close: () => page.evaluate(() => (window as unknown as { tauriWindow: Bridge }).tauriWindow.close()),
});
const props = (page: Page) => page.getByRole("complementary", { name: "Propriétés" });
const bottom = (page: Page) => page.getByRole("region", { name: "Validation du document" });

test("[S-0040-01] Sous Tauri, modifier le libellé puis quitter avant l'enregistrement différé : le brouillon est écrit avant la destruction de la fenêtre et se retrouve à la réouverture", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  const opened = await (await request.get(`${ws.api}/editor/documents/revenu-net`)).json() as { base_version: number; draft: unknown };
  expect(opened.draft).toBeNull();
  const version = opened.base_version + 1;
  const mark = "Revenu net (avant Cmd+Q)";
  await simulateTauri(page.context());
  const tauri = bridge(page);

  await page.clock.install();
  await page.goto(`${ws.root}/editeur?from=revenu-net`);
  await expect(page.getByRole("heading", { level: 1, name: `Revenu net : v${version} · brouillon` })).toBeVisible();
  await expect(bottom(page).getByText("Compilable Databricks, Snowflake")).toBeVisible();
  await expect.poll(tauri.listening).toBe(1); // l'éditeur écoute la fermeture de la fenêtre

  // Horloge figée : l'enregistrement différé (800 ms) ne peut pas partir avant la fermeture.
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1_000));
  await props(page).getByLabel(/^Libellé/).fill(mark);
  await expect(page.getByRole("heading", { level: 1, name: `${mark} : v${version} · brouillon` })).toBeVisible();
  expect(await tauri.journal()).toEqual([]); // rien d'écrit : la modification attend son délai

  await tauri.close();
  // Le brouillon est envoyé et accepté par le serveur, puis seulement la fenêtre est détruite.
  await expect.poll(tauri.journal).toEqual(["brouillon:envoi", "brouillon:200", "destroy:main"]);
  const saved = await (await request.get(`${ws.api}/editor/documents/revenu-net`)).json() as { draft: { document: { label: string } } | null };
  expect(saved.draft?.document.label).toBe(mark);
  const context = page.context();
  await page.close();

  // Réouverture de l'application : l'éditeur reprend le brouillon modifié. L'horloge est
  // celle du contexte : elle reprend son cours pour la nouvelle fenêtre.
  await context.clock.resume();
  const reopened = await context.newPage();
  try {
    await reopened.goto(`${ws.root}/editeur?from=revenu-net`);
    await expect(reopened.getByRole("heading", { level: 1, name: `${mark} : v${version} · brouillon` })).toBeVisible();
    await expect(reopened.getByText("Brouillon local repris")).toBeVisible();
    await expect(props(reopened).getByLabel(/^Libellé/)).toHaveValue(mark);
    expect(await seriousViolations(reopened)).toEqual([]);
  } finally {
    await reopened.close();
  }
});

test("[S-0040-01] Sous Tauri, quitter l'éditeur sans modification détruit la fenêtre sans écrire de brouillon", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await simulateTauri(page.context());
  const tauri = bridge(page);

  await page.goto(`${ws.root}/editeur?from=revenu-net`);
  await expect(bottom(page).getByText("Compilable Databricks, Snowflake")).toBeVisible();
  await expect.poll(tauri.listening).toBe(1);

  await tauri.close();
  await expect.poll(tauri.journal).toEqual(["destroy:main"]);
  const state = await (await request.get(`${ws.api}/editor/documents/revenu-net`)).json() as { draft: unknown };
  expect(state.draft).toBeNull();
});

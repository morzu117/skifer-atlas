import { expect, test } from "@playwright/test";
import { API, ensureNordis, seriousViolations } from "./demo";

// Plan 0010 : sous Tauri, l'adresse et le token du serveur viennent de la commande
// `get_server_info`. Le pont Tauri est simulé dans la page (`__TAURI_INTERNALS__`) ; le
// serveur, lui, est le vrai (ATLAS_DEV_NO_TOKEN : il accepte tout token, l'app doit
// pourtant en envoyer un).
const TOKEN = "jeton-de-session-e2e";

test("[S-0010-12] Sous Tauri, l'échec de get_server_info ne laisse pas de repli sans token : le bandeau s'affiche, aucune requête ne part, « Réessayer » interroge de nouveau l'application", async ({ page, request }) => {
  await ensureNordis(request);
  await page.addInitScript(([base, token]) => {
    const state = { ready: false, calls: 0 };
    (window as unknown as { tauriBridge: typeof state }).tauriBridge = state;
    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      invoke: async (command: string) => {
        if (command !== "get_server_info") throw new Error(`commande inattendue : ${command}`);
        state.calls += 1;
        if (!state.ready) throw new Error("get_server_info indisponible");
        return { baseUrl: base, token };
      },
    };
  }, [API, TOKEN]);
  const sent: { url: string; authorization: string | undefined }[] = [];
  page.on("request", (r) => {
    if (r.url().startsWith(API) && r.method() !== "OPTIONS") sent.push({ url: r.url(), authorization: r.headers()["authorization"] });
  });
  const calls = () => page.evaluate(() => (window as unknown as { tauriBridge: { calls: number } }).tauriBridge.calls);

  // Le démarrage réessaie une vingtaine de fois avant d'abandonner : l'horloge de la page avance à la main.
  await page.clock.install();
  await page.goto("/#/");
  const banner = page.getByRole("alert").filter({ hasText: "Serveur local injoignable" });
  const starting = page.getByText("Démarrage du serveur local…");
  await expect(starting).toBeVisible();
  await expect(banner).toHaveCount(0);
  expect(sent).toEqual([]); // aucune requête sans token
  // Le démarrage a épuisé ses essais. Chaque essai attend un import et des promesses avant de
  // programmer le minuteur suivant : l'horloge avance donc par pas jusqu'à la fin du démarrage.
  await expect(async () => {
    await page.clock.runFor(1_000);
    await expect(starting).toHaveCount(0, { timeout: 100 });
  }).toPass({ timeout: 60_000 });
  await expect(banner).toBeVisible();
  expect(sent).toEqual([]);
  expect(await calls()).toBeGreaterThanOrEqual(3); // l'appel est réessayé avant d'abandonner
  expect(await seriousViolations(page)).toEqual([]);

  // L'échec n'est pas retenu : une fois l'application prête, « Réessayer » reprend tout.
  const before = await calls();
  await page.evaluate(() => { (window as unknown as { tauriBridge: { ready: boolean } }).tauriBridge.ready = true; });
  await banner.getByRole("button", { name: "Réessayer" }).click();
  await expect(banner).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Espaces" }).getByRole("link").filter({ hasText: "Groupe Nordis" })).toBeVisible();
  expect(await calls()).toBeGreaterThan(before);
  expect(await seriousViolations(page)).toEqual([]);
  expect(sent.length).toBeGreaterThan(0);
  for (const call of sent) expect(call.authorization, call.url).toBe(`Bearer ${TOKEN}`);
});

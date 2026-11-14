import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canPickFile, openExternal, pickFile } from "./external";

// Liens externes (flux OAuth, plan 0008) et sélecteur de fichier natif (plan 0018) : le
// plugin Tauri dans la fenêtre de l'application, le navigateur sinon.

const plugins = vi.hoisted(() => ({ shellOpen: vi.fn(), dialogOpen: vi.fn() }));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: plugins.shellOpen }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: plugins.dialogOpen }));

const enterTauri = () => Object.assign(window, { __TAURI_INTERNALS__: {} });

beforeEach(() => {
  plugins.shellOpen.mockReset().mockResolvedValue(undefined);
  plugins.dialogOpen.mockReset();
});
afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  vi.restoreAllMocks();
});

describe("openExternal", () => {
  it("sous Tauri, ouvre l'adresse avec le plugin shell, sans nouvel onglet", async () => {
    enterTauri();
    const tab = vi.spyOn(window, "open").mockReturnValue(null);
    await openExternal("https://github.com/login/oauth/authorize?state=x");
    expect(plugins.shellOpen).toHaveBeenCalledWith("https://github.com/login/oauth/authorize?state=x");
    expect(tab).not.toHaveBeenCalled();
  });

  it("dans un navigateur, ouvre un nouvel onglet isolé de la page", async () => {
    const tab = vi.spyOn(window, "open").mockReturnValue(null);
    await openExternal("https://example.com/");
    expect(tab).toHaveBeenCalledWith("https://example.com/", "_blank", "noopener");
    expect(plugins.shellOpen).not.toHaveBeenCalled();
  });

  it("un refus du plugin shell remonte à l'appelant", async () => {
    enterTauri();
    plugins.shellOpen.mockRejectedValue(new Error("scope refusé"));
    await expect(openExternal("https://example.com/")).rejects.toThrow("scope refusé");
  });
});

describe("pickFile", () => {
  it("le sélecteur n'existe que sous Tauri", () => {
    expect(canPickFile()).toBe(false);
    enterTauri();
    expect(canPickFile()).toBe(true);
  });

  it("rend le chemin choisi, avec le titre demandé, un seul fichier", async () => {
    plugins.dialogOpen.mockResolvedValue("/Users/anna/.ssh/snowflake.p8");
    await expect(pickFile("Clé privée Snowflake")).resolves.toBe("/Users/anna/.ssh/snowflake.p8");
    expect(plugins.dialogOpen).toHaveBeenCalledWith({ title: "Clé privée Snowflake", multiple: false, directory: false });
  });

  it.each([
    ["l'annulation", null],
    ["une sélection multiple inattendue", ["/a", "/b"]],
  ])("rend null après %s", async (_, chosen) => {
    plugins.dialogOpen.mockResolvedValue(chosen);
    await expect(pickFile("Clé")).resolves.toBeNull();
  });
});

// Adresse ouverte dans le navigateur du système (flux OAuth, plan 0008) : le plugin shell
// sous Tauri, un nouvel onglet dans un simple navigateur (développement, tests).
export async function openExternal(url: string): Promise<void> {
  if ("__TAURI_INTERNALS__" in window) {
    const { open } = await import("@tauri-apps/plugin-shell");
    await open(url);
    return;
  }
  window.open(url, "_blank", "noopener");
}

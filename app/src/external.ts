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

/** Sélecteur de fichier natif (clé privée Snowflake, plan 0018) : seulement sous Tauri.
 * Rend le chemin choisi, ou null si l'utilisateur annule. */
export const canPickFile = () => "__TAURI_INTERNALS__" in window;

export async function pickFile(title: string): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const chosen = await open({ title, multiple: false, directory: false });
  return typeof chosen === "string" ? chosen : null;
}

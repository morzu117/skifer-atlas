/** Vrai dans la fenêtre Tauri ; faux dans un navigateur simple (développement, tests). */
export const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

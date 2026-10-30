/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Adresse du serveur local hors Tauri (dev, tests de bout en bout). */
  readonly VITE_ATLAS_API?: string;
}

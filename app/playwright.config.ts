import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// Bout en bout : l'app Vite contre un vrai serveur Python, sur un dossier de données
// temporaire. Le dossier est créé une fois par le lanceur ; les workers en héritent.
process.env.ATLAS_E2E_DATA ??= mkdtempSync(join(tmpdir(), "atlas-e2e-"));
const API_PORT = 8799;

export default defineConfig({
  testDir: "e2e",
  workers: 1,
  fullyParallel: false,
  reporter: "list",
  use: { baseURL: "http://localhost:1420", ...devices["Desktop Chrome"], viewport: { width: 1280, height: 820 } },
  webServer: [
    {
      command: "uv run --project ../core skifer-atlas-server",
      url: `http://127.0.0.1:${API_PORT}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ATLAS_PORT: String(API_PORT),
        ATLAS_DEV_NO_TOKEN: "1",
        ATLAS_DATA_DIR: process.env.ATLAS_E2E_DATA,
        ATLAS_ACCOUNT: "anna.k", // contributrice de Groupe Nordis, référente des espaces qu'elle crée
        ATLAS_VAULT: "memory",
        ATLAS_LOG_LEVEL: "warning",
      },
    },
    {
      command: "npx vite --port 1420 --strictPort",
      url: "http://localhost:1420",
      reuseExistingServer: false,
      env: { VITE_ATLAS_API: `http://127.0.0.1:${API_PORT}` },
    },
  ],
});

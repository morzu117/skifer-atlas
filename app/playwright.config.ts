import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

// Bout en bout : l'app Vite contre un vrai serveur Python, sur un dossier de données
// temporaire. Le dossier est créé une fois par le lanceur ; les workers en héritent.
process.env.ATLAS_E2E_DATA ??= mkdtempSync(join(tmpdir(), "atlas-e2e-"));
const API_PORT = 8799;
// Comparaisons chiffrées en local dans DuckDB, sans plateforme (plan 0009).
const COMPARE_DATA = fileURLToPath(new URL("../core/tests/fixtures/compare/revenu-net", import.meta.url));

// Trois comptes de plus, pour les propositions (plan 0014) et l'administration (0017) : un
// serveur par compte, comme un poste par personne, chacun sur son propre dossier de données.
const REVIEWERS = [
  { account: "claire.m", port: 8798 }, // référente Finance
  { account: "marc.d", port: 8797 }, // validateur Finance
  { account: "julien.h", port: 8795 }, // référent de l'espace, pour l'administration (plan 0017)
];

export default defineConfig({
  testDir: "e2e",
  workers: 1,
  fullyParallel: false,
  reporter: "list",
  use: { baseURL: "http://localhost:1420", viewport: { width: 1280, height: 820 } },
  // Chromium pour tous les scénarios ; WebKit, le moteur de la vue Tauri sous macOS, pour
  // les rendus et parcours des plans 0010–0016 et 0024 (*.webkit.spec.ts, plan 0026).
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 820 } }, testIgnore: /\.webkit\.spec\.ts$/ },
    { name: "webkit", use: { ...devices["Desktop Safari"], viewport: { width: 1280, height: 820 } }, testMatch: /\.webkit\.spec\.ts$/ },
  ],
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
        ATLAS_COMPARE_DATA: COMPARE_DATA,
        SF_TEST_BROWSER_OPENER: "noop", // le faux Snowflake simule le navigateur du SSO
      },
    },
    ...REVIEWERS.map(({ account, port }) => ({
      command: "uv run --project ../core skifer-atlas-server",
      url: `http://127.0.0.1:${port}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ATLAS_PORT: String(port),
        ATLAS_DEV_NO_TOKEN: "1",
        ATLAS_DATA_DIR: join(process.env.ATLAS_E2E_DATA!, account),
        ATLAS_ACCOUNT: account,
        ATLAS_VAULT: "memory",
        ATLAS_LOG_LEVEL: "warning",
      },
    })),
    {
      command: "uv run --project ../core skifer-atlas-server",
      url: "http://127.0.0.1:8793/health",
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ATLAS_PORT: "8793", ATLAS_DEV_NO_TOKEN: "1",
        ATLAS_DATA_DIR: join(process.env.ATLAS_E2E_DATA!, "auth"),
        ATLAS_ACCOUNT: "julien.h", ATLAS_VAULT: "memory", ATLAS_LOG_LEVEL: "warning",
        ATLAS_GITHUB_URL: "http://127.0.0.1:8792",
        ATLAS_GITHUB_API_URL: "http://127.0.0.1:8792",
        ATLAS_GITHUB_CLIENT_ID: "Iv1.atlas-test",
        // Aucun ATLAS_COMPARE_DATA : la comparaison doit demander l'OAuth.
      },
    },
    {
      command: "uv run --project ../core python ../core/tests/connections/fake_github.py 8792",
      url: "http://127.0.0.1:8792/health",
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "uv run --project ../core skifer-atlas-server",
      url: "http://127.0.0.1:8791/health",
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ATLAS_PORT: "8791", ATLAS_DEV_NO_TOKEN: "1",
        ATLAS_DATA_DIR: join(process.env.ATLAS_E2E_DATA!, "accueil"),
        ATLAS_ACCOUNT: "anna.k", ATLAS_VAULT: "memory", ATLAS_LOG_LEVEL: "warning",
      },
    },
    // Faux Databricks (OAuth, SQL) pour Mes connexions (plan 0016). Le retour OAuth du
    // serveur écoute sur 127.0.0.1:8020 : le port doit être libre.
    {
      command: "uv run --project ../core python ../core/tests/connections/fake_databricks.py 8796",
      url: "http://127.0.0.1:8796/oidc/.well-known/oauth-authorization-server",
      reuseExistingServer: false,
      timeout: 120_000,
    },
    // Faux compte Snowflake (SSO, paire de clés, SQL) pour Mes connexions (plan 0018) ; il
    // écrit la clé de démonstration de svc_es dans le dossier de données des tests.
    {
      command: `uv run --project ../core python ../core/tests/connections/fake_snowflake.py 8794 "${join(process.env.ATLAS_E2E_DATA, "cles-snowflake")}"`,
      url: "http://127.0.0.1:8794/health",
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "npx vite --port 1420 --strictPort",
      url: "http://localhost:1420",
      reuseExistingServer: false,
      env: { VITE_ATLAS_API: `http://127.0.0.1:${API_PORT}` },
    },
  ],
});

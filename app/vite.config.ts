import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Port fixe : tauri.conf.json (devUrl) et la liste CORS du serveur Python en dépendent.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ["VITE_", "TAURI_"],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});

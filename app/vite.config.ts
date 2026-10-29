import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Port fixe : tauri.conf.json (devUrl) et la liste CORS du serveur Python en dépendent.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ["VITE_", "TAURI_"],
});

// Accès à l'API locale. Dans l'app, Tauri fournit le port et le token de
// session ; dans un simple navigateur (dev sans Tauri), on retombe sur le
// port par défaut du serveur, sans token (serveur lancé avec ATLAS_DEV_NO_TOKEN=1).

export type ServerInfo = { baseUrl: string; token: string };

export type Workspace = {
  id: string;
  name: string;
  sector: string;
  git_remote: string;
  role: "referent" | "validateur" | "contributeur" | "lecteur";
  role_label: string;
  domains: string[];
  entities: string[];
};

let info: ServerInfo | null = null;

export async function serverInfo(): Promise<ServerInfo> {
  if (info) return info;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    info = await invoke<ServerInfo>("get_server_info");
  } catch {
    info = { baseUrl: "http://127.0.0.1:8765", token: "" };
  }
  return info;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { baseUrl, token } = await serverInfo();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(baseUrl + path, { ...init, headers: { ...headers, ...(init.headers as Record<string, string>) } });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const api = {
  health: () => request<{ status: string; version: string }>("/health"),
  workspaces: () => request<Workspace[]>("/api/workspaces"),
  createWorkspace: (ws: Pick<Workspace, "id" | "name" | "sector" | "entities">) =>
    request<Workspace>("/api/workspaces", { method: "POST", body: JSON.stringify(ws) }),
};

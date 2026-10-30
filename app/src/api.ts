// Accès à l'API locale. Dans l'app, Tauri fournit le port et le token de
// session ; dans un simple navigateur (dev sans Tauri), on retombe sur le
// port par défaut du serveur, sans token (serveur lancé avec ATLAS_DEV_NO_TOKEN=1).
// Toute requête passe par ici : c'est ici que le token est ajouté.

export type ServerInfo = { baseUrl: string; token: string };

export type Role = "referent" | "validateur" | "contributeur" | "lecteur";

export type Counts = { kpi: number | null; concept: number | null; open_proposals: number | null };

export type Workspace = {
  id: string;
  name: string;
  sector: string;
  git_remote: string;
  account: string;
  role: Role;
  role_label: string;
  domains: string[];
  entities: string[];
  counts?: Counts;
};

export type NewWorkspace = { id: string; name: string; sector: string; entities: string[] };

/** Erreur métier du serveur : `{"detail": {"code", "message", "issues"?}}`. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly issues: unknown[] = [],
  ) {
    super(message);
  }
}

/** Le serveur local ne répond pas (arrêté, en cours de démarrage). */
export class UnreachableError extends Error {}

const DEFAULT_BASE_URL = import.meta.env.VITE_ATLAS_API ?? "http://127.0.0.1:8765";

let info: ServerInfo | null = null;
const unreachableListeners = new Set<() => void>();

/** Prévenir la coque dès qu'une requête n'aboutit pas. */
export function onUnreachable(listener: () => void): () => void {
  unreachableListeners.add(listener);
  return () => unreachableListeners.delete(listener);
}

export async function serverInfo(): Promise<ServerInfo> {
  if (info) return info;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    info = await invoke<ServerInfo>("get_server_info");
  } catch {
    info = { baseUrl: DEFAULT_BASE_URL, token: "" };
  }
  return info;
}

/** Réservé aux tests : oublier le serveur choisi. */
export function resetServerInfo(value: ServerInfo | null = null) {
  info = value;
}

async function errorOf(res: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // corps vide ou non JSON
  }
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (detail && typeof detail === "object" && !Array.isArray(detail) && "code" in detail) {
    const d = detail as { code: string; message?: string; issues?: unknown[] };
    return new ApiError(res.status, d.code, d.message ?? d.code, d.issues ?? []);
  }
  if (Array.isArray(detail)) {
    // validation FastAPI : [{loc, msg, type}]
    return new ApiError(res.status, "invalid_request", "Requête refusée par le serveur.", detail);
  }
  const message = typeof detail === "string" ? detail : `Erreur ${res.status}.`;
  return new ApiError(res.status, `http_${res.status}`, message);
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { baseUrl, token } = await serverInfo();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(baseUrl + path, {
      ...init,
      headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
    });
  } catch {
    unreachableListeners.forEach((listener) => listener());
    throw new UnreachableError("Le serveur local ne répond pas.");
  }
  if (!res.ok) throw await errorOf(res);
  return res.json() as Promise<T>;
}

const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });
const ws = (id: string) => `/api/workspaces/${encodeURIComponent(id)}`;

export const api = {
  health: () => request<{ status: string; version: string }>("/health"),
  workspaces: () => request<Workspace[]>("/api/workspaces"),
  createWorkspace: (body: NewWorkspace) => request<Workspace>("/api/workspaces", post(body)),
  joinWorkspace: (remoteUrl: string) =>
    request<Workspace>("/api/workspaces/join", post({ remote_url: remoteUrl })),
  setRemote: (id: string, remoteUrl: string) =>
    request<Workspace>(`${ws(id)}/remote`, post({ remote_url: remoteUrl })),
  proposalsForMe: (id: string) =>
    request<{ id: number }[]>(`${ws(id)}/proposals?status=open&for_me=true`),
};

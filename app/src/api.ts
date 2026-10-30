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

/** `converged`, `candidates:n`, `divergences:n`, `never_compared` ; null pour un concept. */
export type Convergence = string | null;

export type CatalogRow = {
  id: string;
  kind: "concept" | "kpi";
  label: string;
  domain: string | null;
  owner: string | null;
  version: number | null;
  status: string;
  description: string | null;
  synonyms: string[];
  variant_count: number;
  convergence: Convergence;
};

export type CatalogFilters = { q: string; domain: string; owner: string; status: string; kind: string };

export type Facet = { value: string; label: string };
export type Facets = { domain: Facet[]; owner: Facet[]; status: string[]; kind: string[] };

export type DocumentSummary = {
  id: string;
  kind: string;
  label: string;
  domain: string | null;
  domain_label: string | null;
  owner: string | null;
  owner_name: string | null;
  version: number | null;
  status: string;
  description: string | null;
  synonyms: string[];
  variation_points: { node_id: string; label: string | null }[];
  variants: { id: string; entity: string; mode: string }[];
  referenced_by: { id: string; label: string; kind: string }[];
  last_comparison: {
    id: number;
    finished_at: string | null;
    kpi_version: number;
    validation_pct: number | null;
    stale: boolean;
  } | null;
};

export type Dependency = {
  id: string;
  kind: string; // kpi_ref | concept
  version: number | null;
  document_kind: string | null;
  label: string | null;
  status: string | null;
  domain: string | null;
  domain_label: string | null;
  found?: boolean;
};

export type VariantRow = {
  id: string;
  entity: string;
  mode: "override" | "from_scratch";
  version: number | null;
  override_count: number;
  undeclared_count: number;
  justification: string | null;
};

export type Implementation = { entity: string; platform: string; path: string; sql: string; extractable: boolean };

export type Scope = {
  id: string;
  period?: { from?: string; to?: string; calendar_period?: string };
  granularity?: string[];
};

/** Fiche d'un document (plan 0012) : l'aperçu du catalogue, plus ce que lisent les onglets. */
export type DocumentSheet = Omit<DocumentSummary, "variants"> & {
  validated_at: string | null;
  validators_required: number | null;
  version_count: number;
  has_graph: boolean;
  semantics: { key: string; value: string; variation: boolean }[];
  entity: { key?: string[]; attributes?: { name: string; type: string }[] } | null;
  variants: VariantRow[];
  dependencies: { references: Dependency[]; referenced_by: Dependency[]; impact: number };
  implementations: Implementation[];
  scopes: Scope[];
  tolerance: { percent?: number } | null;
  workspace_tolerance: { percent: number } | null;
};

export type GraphNode = {
  id: string;
  type: string;
  type_label: string;
  family: "source" | "ref" | "rows" | "combine" | "result";
  title: string;
  detail: string;
  variation: boolean;
  output: boolean;
  layer: number;
  rank: number;
};

export type GraphLayout = {
  output: string;
  nodes: GraphNode[];
  edges: { id: string; source: string; target: string; side: "left" | "right" | null }[];
  overrides: string[];
};

export type Version = { version: number; commit: string; date: string; author: string; message: string };

export type Difference = {
  kind: "modified" | "added" | "removed" | "reordered";
  node_ref: { base: string | null; other: string | null } | null;
  node_type: string;
  changes: { field: string; before: unknown; after: unknown }[];
  classification: string;
  severity: "info" | "warn" | "critical";
  message: string;
};

/** Rapport de diff du plan 0003. */
export type DiffReport = {
  identical: boolean;
  relation: string;
  base: { id: string; version: number; fingerprint: string };
  other: { id: string; version: number; fingerprint: string };
  differences: Difference[];
  summary: { by_classification: Record<string, number>; by_severity: Record<string, number> };
};

export type Residue = { code: string; message: string; blocking?: boolean; line?: number };

export type ExtractResult = {
  file: string;
  residues: Residue[];
  statements: {
    id: string;
    line: number;
    status: string;
    roundtrip: { status: string; differs?: string[] };
    residues: Residue[];
    draft: string;
    diff: DiffReport | null;
  }[];
};

export type Draft = { id: string; kind: string; label: string; base_version: number; version: number; content: string };

export type ComparisonRun = {
  id: number;
  kpi_version: number;
  status: string;
  started_at: string;
  finished_at: string | null;
  tolerance_pct: number;
  scope: { id?: string } | null;
  results: { variant_id: string; entity: string; validation_pct: number | null; max_gap_pct: number | null }[];
};

/** Erreur métier du serveur : `{"detail": {"code", "message", "issues"?}}`. */
// --- Éditeur (plan 0013) ---------------------------------------------------------------

export type Issue = { path: string; node_id: string | null; code: string; message: string; severity: "error" | "warning" | "info" };

export type Compiled =
  | { status: "ok"; sql: string; node_sql: string | null }
  | { status: "not_compilable" | "error"; node_id: string | null; reason: string }
  | { status: "blocked" };

export type CheckResult = {
  yaml: string;
  fragments: Record<string, string>;
  issues: Issue[];
  status: { schema: boolean; acyclic: boolean; cycle: string[] | null; compilable: Record<string, Compiled> };
  columns: Record<string, [string, string | null][]>;
  submittable: boolean;
};

export type Vocabulary = {
  operators: { name: string; arity: "none" | "single" | "list"; label: string }[];
  aggregates: string[];
  platforms: string[];
  column_types: string[];
};

export type EditorDraft = {
  document: Record<string, unknown>;
  positions: Record<string, { x: number; y: number }>;
  highest: number;
  base_version: number | null;
  saved_at: string;
};

export type EditorDocument = {
  id: string;
  mode: "canonical" | "override" | "from_scratch";
  kind: "concept" | "kpi" | "variant";
  base_version: number | null;
  document: Record<string, unknown>;
  canonical: Record<string, unknown> | null;
  highest: number;
  positions: Record<string, { x: number; y: number }> | null;
  draft: EditorDraft | null;
  calendars: { key: string; version: string }[];
  domains: { id: string; label: string }[];
  vocabulary: Vocabulary;
};

export type NewDocument = { kind: "concept" | "kpi"; id: string; label: string; domain: string; owner: string };

export type ProposalPreview = {
  nature: string;
  domain: string | null;
  required: number;
  mention: string | null;
  diff: DiffReport | null;
};

export type Proposal = {
  id: number;
  title: string;
  branch: string;
  state: string;
  version?: number;
  approvals?: { obtained: number; required: number };
};

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
  if (res.status === 204) return null as T;
  return res.json() as Promise<T>;
}

const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });
const ws = (id: string) => `/api/workspaces/${encodeURIComponent(id)}`;
const doc = (id: string, documentId: string) => `${ws(id)}/documents/${encodeURIComponent(documentId)}`;

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
  catalog: (id: string, filters: CatalogFilters) => {
    const search = new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== "")).toString();
    return request<CatalogRow[]>(`${ws(id)}/catalog${search ? `?${search}` : ""}`);
  },
  facets: (id: string) => request<Facets>(`${ws(id)}/catalog/facets`),
  indexState: (id: string) => request<{ fresh: boolean }>(`${ws(id)}/index`),
  summary: (id: string, documentId: string) => request<DocumentSummary>(`${doc(id, documentId)}/summary`),
  sheet: (id: string, documentId: string) => request<DocumentSheet>(`${doc(id, documentId)}/sheet`),
  layout: (id: string, documentId: string, version?: number) =>
    request<GraphLayout>(`${doc(id, documentId)}/layout${version ? `?version=${version}` : ""}`),
  versions: (id: string, documentId: string) => request<Version[]>(`${doc(id, documentId)}/versions`),
  versionDiff: (id: string, documentId: string, base: number, other: number) =>
    request<DiffReport>(`${doc(id, documentId)}/diff?base=${base}&other=${other}`),
  extract: (id: string, documentId: string, entity: string, platform: string) =>
    request<ExtractResult>(
      `${doc(id, documentId)}/implementations/${encodeURIComponent(entity)}/${encodeURIComponent(platform)}/extract`,
      { method: "POST" },
    ),
  draft: (id: string, documentId: string) => request<Draft>(`${doc(id, documentId)}/draft`),
  editorOpen: (id: string, documentId: string) =>
    request<EditorDocument>(`${ws(id)}/editor/documents/${encodeURIComponent(documentId)}`),
  editorNew: (id: string, body: NewDocument) => request<EditorDocument>(`${ws(id)}/editor/documents`, post(body)),
  editorCheck: (id: string, document: unknown, nodeId: string | null) =>
    request<CheckResult>(`${ws(id)}/editor/check`, post({ document, node_id: nodeId })),
  editorParse: (id: string, text: string) =>
    request<{ document: Record<string, unknown> | null; issues: Issue[] }>(`${ws(id)}/editor/parse`, post({ text })),
  saveDraft: (id: string, documentId: string, draft: Omit<EditorDraft, "saved_at">) =>
    request<{ saved_at: string }>(`${ws(id)}/editor/documents/${encodeURIComponent(documentId)}/draft`, {
      method: "PUT",
      body: JSON.stringify(draft),
    }),
  deleteDraft: (id: string, documentId: string) =>
    request<null>(`${ws(id)}/editor/documents/${encodeURIComponent(documentId)}/draft`, { method: "DELETE" }),
  preview: (id: string, document: unknown) => request<ProposalPreview>(`${ws(id)}/editor/preview`, post({ document })),
  createProposal: (id: string, body: { document_yaml: string; justification: string; base_version: number | null }) =>
    request<Proposal>(`${ws(id)}/proposals`, post(body)),
  comparisons: (id: string, kpiId: string, limit: number) =>
    request<ComparisonRun[]>(`${ws(id)}/comparisons?kpi=${encodeURIComponent(kpiId)}&limit=${limit}`),
};

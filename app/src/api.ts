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
  /** Référent de l'espace (sans restriction de domaine) : seul à voir l'administration. */
  space_referent?: boolean;
  synced_at?: string;
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

// --- Comparaison (plans 0009 et 0015) ----------------------------------------------------

export type ComparisonStatus = "running" | "done" | "partial" | "failed" | "cancelled" | "interrupted";

export type ComparisonScope = {
  id: string;
  period?: { from?: string; to?: string; calendar_period?: string };
  perimeter?: string[];
  granularity: string[];
  granularities: string[][];
};

export type ComparisonSetup = {
  kpi_id: string;
  label: string;
  version: number;
  variants: { entity: string; variant_id: string; mode: string; version: number; platform: string | null; outdated: boolean; unavailable: string | null }[];
  scopes: ComparisonScope[];
  tolerance: { kpi: number | null; workspace: number };
  local: boolean;
};

export type ComparisonAlert = { code: string; entity: string; nodes: string[]; message: string };

export type MissingAccess = { access_point: string; code: string; message: string };

export type ComparisonRequest = {
  kpi_id: string;
  variants: string[];
  scope_id?: string;
  scope?: { period?: { from?: string; to?: string; calendar_period?: string }; perimeter?: string[]; granularity: string[] };
  tolerance?: number;
};

export type ComparisonPreview = {
  alerts: ComparisonAlert[];
  plans: { entity: string; platform: string; access_point: string | null }[];
  tolerance: number;
  granularity: string[];
  missing_access: MissingAccess[];
};

export type ComparisonCell = {
  dims: Record<string, unknown>;
  canonical_value: number | null;
  variant_value: number | null;
  gap_pct: number | null;
  within_tolerance: boolean;
  missing: "canonical" | "variant" | null;
};

export type ComparisonResult = {
  variant_id: string;
  entity: string;
  variant_version: number;
  platform: string;
  access_point: string | null;
  cell_count: number;
  validation_pct: number | null;
  max_gap_pct: number | null;
  divergent_node: string | null;
  divergent: { node_id: string; node_type: string; classification: string; message: string; label?: string | null } | null;
  bypass_nodes: string[];
  cells: ComparisonCell[];
};

export type ComparisonProgress = { platform: string; entities: string[]; state: string; percent: number };

export type Comparison = {
  id: number;
  started_at: string;
  finished_at: string | null;
  user_account: string | null;
  kpi_id: string;
  kpi_version: number;
  scope: { id?: string; period?: ComparisonScope["period"]; granularity?: string[] };
  tolerance_pct: number;
  status: ComparisonStatus;
  error: string | null;
  progress: ComparisonProgress[] | null;
  alerts?: ComparisonAlert[];
  results: ComparisonResult[];
};

export type HistoryEntry = Omit<Comparison, "results" | "progress"> & {
  results: { variant_id: string; entity: string; validation_pct: number | null; max_gap_pct: number | null; divergent_node: string | null }[];
};

export type MatrixCell = {
  variant_id: string;
  entity: string;
  compared: boolean;
  comparison_id?: number;
  kpi_version?: number;
  validation_pct?: number | null;
  max_gap_pct?: number | null;
  divergent_node?: string | null;
  finished_at?: string;
  stale?: boolean;
};

export type MatrixRow = { kpi_id: string; label: string; domain: string | null; domain_label: string | null; version: number; variants: MatrixCell[] };

export type CanonicalDiff = { base: GraphLayout & { label: string }; other: GraphLayout & { label: string }; report: DiffReport };

/** Mon accès à un point d'accès (plan 0008) : un état, jamais de jeton. */
export type MyAccess = "connected" | "expired" | "never";

export type Connection = {
  access_point: string;
  platform: string;
  host: string;
  schema: string | null;
  entity: string | null;
  owner: string;
  owner_name: string | null;
  freshness: string | null;
  allowed: boolean;
  supported: boolean;
  /** Ce que j'ai au coffre : OAuth, token personnel, session SSO, paire de clés (0018). */
  auth: "oauth" | "pat" | "sso" | "keypair" | null;
  /** Mode d'authentification du point d'accès : OAuth (Databricks), SSO ou paire de clés. */
  auth_mode: "oauth" | "sso" | "keypair" | null;
  /** Snowflake : mon identifiant et le chemin de ma clé privée, au registre local. */
  login: string | null;
  private_key_file: string | null;
  my_access: MyAccess;
  expires_in_days: number | null;
};

/** `status` d'un flux OAuth : pending, connected, failed ou expired (5 minutes). */
export type ConnectionStatus = Connection & {
  flow: { status: "pending" | "connected" | "failed" | "expired"; error: string | null } | null;
  error: { code: string; message: string } | null;
};

export type Platform = { id: string; label: string; supported: boolean };

/** Point d'accès tel que déclaré dans access_points.yaml, sans aucun secret. */
export type AccessPointDraft = {
  id: string;
  platform: string;
  host: string;
  warehouse_id?: string;
  http_path?: string;
  /** Snowflake (plan 0018) : entrepôt, rôle, mode d'authentification, compte. */
  warehouse?: string;
  role?: string;
  auth?: "sso" | "keypair";
  account?: string;
  schema?: string;
  entity?: string;
  owner: string;
  freshness?: string;
};

/** Paire de clés Snowflake : la passphrase part au coffre et n'est jamais relue. */
export type KeyPair = { user: string; private_key_file: string; passphrase?: string };

export type ConnectionTest = { ok: boolean; latency_ms: number | null; error: { code: string; message: string } | null };

// --- Administration (plan 0017) ---------------------------------------------------------

export type Levels = { canonical: number; variants: number };

export type GovernanceDomain = { id: string; label: string; referents: string[]; validators: string[]; validators_required: Levels | null };

export type GovernanceMember = { account: string; name: string; entity: string | null; roles: { role: Role; domains: string[] }[] };

/** `governance.yaml`, tel que l'écran le modifie. */
export type Governance = {
  schema_version: 1;
  validators_required: Levels;
  domains: GovernanceDomain[];
  members: GovernanceMember[];
  allowed_platforms: string[];
  tolerance: { percent: number } | null;
};

export type AdminState = {
  governance: Governance;
  base_digest: string;
  warnings: string[];
  space_referents: string[];
  single_referent: boolean;
  kpi_counts: Record<string, number>;
  platforms: { id: string; label: string; auth: string; supported: boolean }[];
  repository: { url: string; main_branch: string; synced_at: string | null; index_fresh: boolean };
};

export type AdminSaved = { id: number; title: string; merged: boolean; mention: string | null; changes: string[] };

export type SyncResult = {
  status: "up_to_date" | "ahead" | "fast_forward";
  commit: string;
  warnings: { code: string; message: string }[];
  reindexed: boolean;
  synced_at: string | null;
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

/** Nature d'une proposition (plan 0006) : elle fixe le nombre de validations requises. */
export type Nature = "new_version" | "declared_point" | "undeclared" | "from_scratch" | "governance" | "access_points";

export type ProposalStatus = "open" | "merged" | "closed" | "all";

/** Élément de la file (plan 0014). Le décompte n'existe que pour une proposition ouverte. */
export type ProposalItem = {
  id: number;
  title: string;
  branch: string;
  author: string;
  state: "open" | "merged" | "closed";
  created_at: string;
  document_id: string;
  document_kind: string;
  kpi_id: string | null;
  entity: string | null;
  nature: Nature;
  domain: string | null;
  base_version: number | null;
  version: number | null;
  approvals?: { obtained: number; required: number };
  approvers?: string[];
  changes_requested_by?: string[];
  ready_to_merge?: boolean;
  mention?: string | null;
  explanation?: string;
};

export type ProposalQueue = {
  account: string;
  role: Role;
  review_domains: string[];
  domains: { id: string; label: string }[];
  entities: string[];
  members: Record<string, string>;
  items: ProposalItem[];
};

export type ProposalComment = { account: string; body: string; created_at: string };

export type ProposalReview = { account: string; state: string; submitted_at: string; body: string; outdated: boolean };

export type ProposalDetail = ProposalItem & {
  justification: string;
  reviews: ProposalReview[];
  comments: ProposalComment[];
  viewer: {
    account: string;
    can_review: boolean;
    review_reason: string | null;
    can_merge: boolean;
    merge_reason: string | null;
  };
};

export type ProposalGraphs = {
  base: (GraphLayout & { label: string }) | null;
  proposed: (GraphLayout & { label: string }) | null;
  report: DiffReport | null;
  undeclared: { node: string; label: string | null }[];
  recurring: { node: string; label: string | null; entities: string[] }[];
};

export type MergeResult = { id: number; commit: string; tag: string | null; version: number | null };

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
  proposalQueue: (id: string, status: ProposalStatus) =>
    request<ProposalQueue>(`${ws(id)}/proposals/queue?status=${status}`),
  proposal: (id: string, number: number) => request<ProposalDetail>(`${ws(id)}/proposals/${number}`),
  proposalGraphs: (id: string, number: number) => request<ProposalGraphs>(`${ws(id)}/proposals/${number}/graphs`),
  review: (id: string, number: number, event: "approve" | "request_changes", body = "") =>
    request<ProposalItem>(`${ws(id)}/proposals/${number}/reviews`, post({ event, body })),
  comment: (id: string, number: number, body: string) =>
    request<ProposalComment>(`${ws(id)}/proposals/${number}/comments`, post({ body })),
  merge: (id: string, number: number) => request<MergeResult>(`${ws(id)}/proposals/${number}/merge`, post({})),
  createProposal: (id: string, body: { document_yaml: string; justification: string; base_version: number | null }) =>
    request<Proposal>(`${ws(id)}/proposals`, post(body)),
  comparisons: (id: string, kpiId: string, limit: number) =>
    request<ComparisonRun[]>(`${ws(id)}/comparisons?kpi=${encodeURIComponent(kpiId)}&limit=${limit}`),
  history: (id: string, limit: number) => request<HistoryEntry[]>(`${ws(id)}/comparisons?limit=${limit}`),
  comparisonSetup: (id: string, kpiId: string) =>
    request<ComparisonSetup>(`${ws(id)}/comparisons/setup?kpi=${encodeURIComponent(kpiId)}`),
  previewComparison: (id: string, body: ComparisonRequest) =>
    request<ComparisonPreview>(`${ws(id)}/comparisons/preview`, post(body)),
  startComparison: (id: string, body: ComparisonRequest) =>
    request<{ id: number; status: string; alerts: ComparisonAlert[] }>(`${ws(id)}/comparisons`, post(body)),
  comparison: (id: string, number: number) => request<Comparison>(`${ws(id)}/comparisons/${number}`),
  cancelComparison: (id: string, number: number) => request<{ id: number; status: string }>(`${ws(id)}/comparisons/${number}/cancel`, post({})),
  matrix: (id: string) => request<MatrixRow[]>(`${ws(id)}/comparisons/matrix`),
  canonicalDiff: (id: string, docId: string) => request<CanonicalDiff>(`${ws(id)}/documents/${encodeURIComponent(docId)}/canonical-diff`),
  connectionStatus: (id: string, accessPoint: string) =>
    request<ConnectionStatus>(`${ws(id)}/connections/${encodeURIComponent(accessPoint)}/status`),
  /** OAuth : l'URL à ouvrir. SSO Snowflake : null, Atlas ouvre lui-même le navigateur. */
  authorize: (id: string, accessPoint: string, user?: string) =>
    request<{ authorize_url: string | null }>(`${ws(id)}/connections/${encodeURIComponent(accessPoint)}/authorize`, post(user ? { user } : {})),
  connections: (id: string) => request<Connection[]>(`${ws(id)}/connections`),
  platforms: (id: string) => request<Platform[]>(`${ws(id)}/connections/platforms`),
  testConnection: (id: string, accessPoint: string) =>
    request<ConnectionTest>(`${ws(id)}/connections/${encodeURIComponent(accessPoint)}/test`, post({})),
  revokeConnection: (id: string, accessPoint: string) =>
    request<{ revoked: boolean; remote_revoked: boolean }>(`${ws(id)}/connections/${encodeURIComponent(accessPoint)}/token`, { method: "DELETE" }),
  keyPair: (id: string, accessPoint: string, keyPair: KeyPair) =>
    request<Connection>(`${ws(id)}/connections/${encodeURIComponent(accessPoint)}/key-pair`, { method: "PUT", body: JSON.stringify(keyPair) }),
  personalToken: (id: string, accessPoint: string, token: string) =>
    request<Connection>(`${ws(id)}/connections/${encodeURIComponent(accessPoint)}/token`, { method: "PUT", body: JSON.stringify({ token }) }),
  declareAccessPoint: (id: string, accessPoint: AccessPointDraft, justification: string) =>
    request<{ id: number; title: string }>(`${ws(id)}/connections`, post({ access_point: accessPoint, justification })),
  authorizeDraft: (id: string, accessPoint: AccessPointDraft, user?: string) =>
    request<{ authorize_url: string | null }>(`${ws(id)}/access-point-draft/authorize`, post({ access_point: accessPoint, ...(user ? { user } : {}) })),
  keyPairDraft: (id: string, accessPoint: AccessPointDraft, keyPair: KeyPair) =>
    request<Connection>(`${ws(id)}/access-point-draft/key-pair`, { method: "PUT", body: JSON.stringify({ access_point: accessPoint, ...keyPair }) }),
  draftStatus: (id: string, accessPoint: AccessPointDraft) =>
    request<ConnectionStatus>(`${ws(id)}/access-point-draft/status`, post({ access_point: accessPoint })),
  testDraft: (id: string, accessPoint: AccessPointDraft) =>
    request<ConnectionTest>(`${ws(id)}/access-point-draft/test`, post({ access_point: accessPoint })),
  admin: (id: string) => request<AdminState>(`${ws(id)}/admin`),
  saveGovernance: (id: string, governance: Governance, baseDigest: string) =>
    request<AdminSaved>(`${ws(id)}/admin/governance`, post({ governance, base_digest: baseDigest })),
  sync: (id: string) => request<SyncResult>(`${ws(id)}/sync`, post({})),
};

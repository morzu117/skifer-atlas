import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Connection, Platform, Workspace } from "../api";
import { expectAccessibleLandmarks } from "../test/accessibility";
import { ALTAVIA, fakeServer, workspace, type Call } from "../test/fakeServer";
import { accessLabel, Connections, suggestedId, toAccessPoint } from "./Connections";

const picker = vi.hoisted(() => ({ enabled: false }));
vi.mock("../external", () => ({ openExternal: vi.fn(async () => undefined), canPickFile: () => picker.enabled, pickFile: vi.fn() }));
import { openExternal, pickFile } from "../external";

const API = "/api/workspaces/groupe-nordis";

function connection(overrides: Partial<Connection>): Connection {
  return {
    access_point: "dbx-fr",
    platform: "databricks",
    host: "https://adb-1.azuredatabricks.net",
    schema: "gold.finance",
    entity: "nordis-fr",
    owner: "claire.m",
    owner_name: "Claire M.",
    freshness: "Quotidienne · 06:10",
    allowed: true,
    supported: true,
    auth: null,
    auth_mode: "oauth",
    login: null,
    private_key_file: null,
    my_access: "never",
    expires_in_days: null,
    ...overrides,
  };
}

const PLATFORMS: Platform[] = [
  { id: "databricks", label: "Databricks", supported: true },
  { id: "snowflake", label: "Snowflake", supported: true },
  { id: "bigquery", label: "BigQuery", supported: false },
];

const LIST: Connection[] = [
  connection({ access_point: "dbx-fr", auth: "oauth", my_access: "connected", expires_in_days: 11 }),
  connection({ access_point: "dbx-es", entity: "nordis-es", owner: "sofia.r", owner_name: "Sofia R.", auth: "oauth", my_access: "expired" }),
  connection({
    access_point: "snow-de",
    platform: "snowflake",
    host: "https://nordis-de.snowflakecomputing.com",
    schema: "FIN_GOLD.PUBLIC",
    entity: "nordis-de",
    owner: "anna.k",
    owner_name: "Anna K.",
    auth_mode: "sso",
  }),
  connection({
    access_point: "bq-it",
    platform: "bigquery",
    host: "https://bigquery.googleapis.com",
    schema: "finance.gold",
    entity: "nordis-it",
    owner: "luca.b",
    owner_name: "Luca B.",
    supported: false,
  }),
];

type Handler = (call: Call) => { status?: number; json?: unknown } | Promise<{ status?: number; json?: unknown }> | undefined;

function server(list: Connection[] | (() => Connection[]) = LIST, extra: Handler = () => undefined) {
  return fakeServer((call) => {
    const found = extra(call);
    if (found) return found;
    if (call.path === `${API}/connections` && call.method === "GET") return { json: typeof list === "function" ? list() : list };
    if (call.path === `${API}/connections/platforms`) return { json: PLATFORMS };
    if (call.path === "/api/workspaces/altavia-energie/connections") return { json: [connection({ access_point: "dbx-a1", entity: "a1" })] };
    if (call.path === "/api/workspaces/altavia-energie/connections/platforms") return { json: PLATFORMS.slice(0, 1) };
    return undefined;
  });
}

function screenFor(ws: Workspace = workspace()) {
  return <Connections ws={ws} heading={createRef()} />;
}

const row = async (name: RegExp) => (await screen.findByRole("cell", { name })).closest("tr") as HTMLElement;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(openExternal).mockClear();
  vi.mocked(pickFile).mockReset();
  picker.enabled = false;
});

describe("libellés", () => {
  it("mon accès : expiration, session, token expiré, jamais connecté", () => {
    expect(accessLabel({ my_access: "connected", auth: "oauth", expires_in_days: 11 })).toEqual({ text: "Connecté", detail: "expire dans 11 j", tone: "ok" });
    expect(accessLabel({ my_access: "connected", auth: "oauth", expires_in_days: null }).detail).toBe("session OAuth");
    expect(accessLabel({ my_access: "connected", auth: "pat", expires_in_days: null }).detail).toBe("token personnel");
    expect(accessLabel({ my_access: "expired", auth: "pat", expires_in_days: null })).toEqual({ text: "Token expiré", detail: null, tone: "warn" });
    expect(accessLabel({ my_access: "expired", auth: "oauth", expires_in_days: null }).text).toBe("Session expirée");
    expect(accessLabel({ my_access: "never", auth: null, expires_in_days: null }).text).toBe("Jamais connecté");
    // Snowflake (plan 0018) : la session SSO se renouvelle, pas d'échéance affichée.
    expect(accessLabel({ my_access: "connected", auth: "sso", expires_in_days: 0 }).detail).toBe("session SSO");
    expect(accessLabel({ my_access: "connected", auth: "keypair", expires_in_days: null }).detail).toBe("paire de clés");
    expect(accessLabel({ my_access: "expired", auth: "sso", expires_in_days: null }).text).toBe("Session expirée");
    expect(accessLabel({ my_access: "expired", auth: "keypair", expires_in_days: null }).text).toBe("Clé refusée");
  });

  it("identifiant proposé et brouillon envoyé au serveur", () => {
    expect(suggestedId("databricks", "nordis-fr")).toBe("dbx-fr");
    expect(suggestedId("snowflake", "")).toBe("snow-groupe");
    const draft = { platform: "databricks", id: " dbx-de ", host: "adb-2.azuredatabricks.net", warehouse: "abc123", schema: "", entity: "nordis-de", freshness: "", role: "", auth: "sso" as const, account: "" };
    expect(toAccessPoint(draft, "anna.k")).toEqual({
      id: "dbx-de",
      platform: "databricks",
      host: "https://adb-2.azuredatabricks.net",
      warehouse_id: "abc123",
      entity: "nordis-de",
      owner: "anna.k",
    });
    expect(toAccessPoint({ ...draft, host: "http://127.0.0.1:8796", warehouse: "/sql/1.0/warehouses/abc" }, "anna.k")).toMatchObject({
      host: "http://127.0.0.1:8796",
      http_path: "/sql/1.0/warehouses/abc",
    });
    expect(toAccessPoint({ ...draft, platform: "snowflake" }, "anna.k")).not.toHaveProperty("warehouse_id");
    expect(toAccessPoint({ ...draft, platform: "snowflake", warehouse: "WH_FINANCE", role: " ANALYSTE ", auth: "keypair", account: "nordis-de" }, "anna.k")).toEqual({
      id: "dbx-de",
      platform: "snowflake",
      host: "https://adb-2.azuredatabricks.net",
      warehouse: "WH_FINANCE",
      role: "ANALYSTE",
      auth: "keypair",
      account: "nordis-de",
      entity: "nordis-de",
      owner: "anna.k",
    });
    expect(toAccessPoint({ ...draft, platform: "databricks", role: "X", account: "Y" }, "anna.k")).not.toHaveProperty("role");
  });
});

describe("mes connexions", () => {
  it("évite les repères dupliqués et rend les tableaux accessibles", async () => {
    server();
    render(screenFor());
    await screen.findByRole("group", { name: "Tableau : Points d'accès de l'espace" });
    await expectAccessibleLandmarks();
  });

  it("tableau : plateforme, schéma, propriétaire, fraîcheur, mon accès et actions (critères 1 et 6)", async () => {
    server();
    render(screenFor());
    const table = await screen.findByRole("table", { name: "Points d'accès de l'espace" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Plateforme",
      "Schéma",
      "Propriétaire",
      "Fraîcheur",
      "Mon accès",
      "Actions",
    ]);

    const fr = await row(/Claire M\./);
    expect(fr).toHaveTextContent("nordis-fr · OAuth");
    expect(fr).toHaveTextContent("gold.finance");
    expect(fr).toHaveTextContent("Quotidienne · 06:10");
    expect(within(fr).getByRole("cell", { name: /^Connecté ?· ?expire dans 11 j$/ })).toBeInTheDocument();
    expect(within(fr).getByRole("button", { name: "Tester Databricks · dbx-fr" })).toBeInTheDocument();
    expect(within(fr).getByRole("button", { name: "Révoquer Databricks · dbx-fr" })).toBeInTheDocument();

    const es = await row(/Sofia R\./);
    expect(es).toHaveTextContent("Session expirée");
    expect(within(es).getByRole("button", { name: "Reconnecter Databricks · dbx-es" })).toHaveClass("btn-primary");

    const de = await row(/Anna K\./);
    expect(de).toHaveTextContent("nordis-de · SSO");
    expect(de).toHaveTextContent("Jamais connecté");
    expect(within(de).getByRole("button", { name: "Se connecter à Snowflake · snow-de" })).toBeInTheDocument();

    const it_ = await row(/Luca B\./);
    expect(it_).toHaveTextContent("nordis-it · bientôt");
    expect(it_).toHaveTextContent("Bientôt dans Atlas");
    expect(within(it_).queryByRole("button")).not.toBeInTheDocument();
    // Aucun champ de token sans échec préalable (guide 10.6).
    expect(screen.queryByLabelText(/token/i)).not.toBeInTheDocument();
  });

  it("[S-0016-06] panneau : seules les plateformes autorisées, celles à venir désactivées (critère 6)", async () => {
    server();
    render(screenFor());
    const platform = await screen.findByRole("combobox", { name: "Plateforme (autorisées par le référent)" });
    await waitFor(() => expect(within(platform).getAllByRole("option")).toHaveLength(3));
    expect(within(platform).getByRole("option", { name: "Databricks" })).toBeEnabled();
    expect(within(platform).getByRole("option", { name: "Snowflake" })).toBeEnabled();
    expect(within(platform).getByRole("option", { name: "BigQuery (bientôt)" })).toBeDisabled();
    // nordis-fr est déjà déclaré en Databricks : le panneau propose l'entité suivante.
    expect(screen.getByRole("combobox", { name: "Entité" })).toHaveValue("nordis-de");
    expect(screen.getByRole("textbox", { name: "Identifiant" })).toHaveValue("dbx-de");
  });

  it("se connecter : OAuth dans le navigateur, puis Connecté sans recharger (critère 2)", async () => {
    let reads = 0;
    let connected = false;
    const list = () => [connection({ access_point: "dbx-fr", auth: connected ? "oauth" : null, my_access: connected ? "connected" : "never" })];
    const api = server(list, ({ path }) => {
      if (path === `${API}/connections/dbx-fr/authorize`) return { json: { authorize_url: "https://adb-1.azuredatabricks.net/oidc/v1/authorize?state=s" } };
      if (path === `${API}/connections/dbx-fr/status`) {
        reads += 1;
        connected = reads >= 2;
        return { json: { ...list()[0], flow: { status: connected ? "connected" : "pending", error: null }, error: null } };
      }
      return undefined;
    });
    render(screenFor());
    await userEvent.click(await screen.findByRole("button", { name: "Se connecter à Databricks · dbx-fr" }));
    expect(openExternal).toHaveBeenCalledWith("https://adb-1.azuredatabricks.net/oidc/v1/authorize?state=s");
    expect(await screen.findByText("Terminez la connexion dans le navigateur…")).toBeInTheDocument();

    expect(await screen.findByRole("cell", { name: /^Connecté ?· ?session OAuth$/ }, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tester Databricks · dbx-fr" })).toBeInTheDocument();
    expect(api.calls.filter((c) => c.path === `${API}/connections`).length).toBeGreaterThanOrEqual(2);
  });

  it("tester puis révoquer : latence, puis Jamais connecté (critère 3)", async () => {
    let revoked = false;
    const list = () => [connection({ access_point: "dbx-fr", auth: revoked ? null : "oauth", my_access: revoked ? "never" : "connected" })];
    const api = server(list, ({ method, path }) => {
      if (path === `${API}/connections/dbx-fr/test`) return { json: { ok: true, latency_ms: 42, error: null } };
      if (path === `${API}/connections/dbx-fr/token` && method === "DELETE") {
        revoked = true;
        return { json: { revoked: true, remote_revoked: true } };
      }
      return undefined;
    });
    render(screenFor());
    await userEvent.click(await screen.findByRole("button", { name: "Tester Databricks · dbx-fr" }));
    expect(await screen.findByText("Connexion OK · 42 ms")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Révoquer Databricks · dbx-fr" }));
    expect(await screen.findByText("Accès révoqué, ici et chez Databricks.")).toBeInTheDocument();
    expect(await screen.findByRole("cell", { name: "Jamais connecté" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Se connecter à Databricks · dbx-fr" })).toBeInTheDocument();
    expect(api.calls.some((c) => c.method === "DELETE" && c.path === `${API}/connections/dbx-fr/token`)).toBe(true);
  });

  it("changer d'espace change la liste (critère 4)", async () => {
    server();
    const { rerender } = render(screenFor());
    expect(await screen.findByRole("cell", { name: /Claire M\./ })).toBeInTheDocument();
    rerender(screenFor(ALTAVIA));
    expect(await screen.findByText(/Espace Altavia Énergie/)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Se connecter à Databricks · dbx-a1" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /dbx-fr/ })).not.toBeInTheDocument();
  });

  it("[S-0008-05] échec de l'OAuth : repli par token personnel, champ masqué vidé après l'envoi", async () => {
    let saved = false;
    const list = () => [connection({ access_point: "dbx-fr", auth: saved ? "pat" : null, my_access: saved ? "connected" : "never" })];
    const api = server(list, ({ method, path }) => {
      if (path === `${API}/connections/dbx-fr/authorize`) return { json: { authorize_url: "https://adb-1.azuredatabricks.net/oidc/v1/authorize" } };
      if (path === `${API}/connections/dbx-fr/status`) {
        return { json: { ...list()[0], flow: { status: "failed", error: "access_denied" }, error: null } };
      }
      if (path === `${API}/connections/dbx-fr/token` && method === "PUT") {
        saved = true;
        return { json: list()[0] };
      }
      return undefined;
    });
    render(screenFor());
    await userEvent.click(await screen.findByRole("button", { name: "Se connecter à Databricks · dbx-fr" }));
    expect(await screen.findByRole("alert", undefined, { timeout: 4000 })).toHaveTextContent("Connexion échouée : access_denied");

    await userEvent.click(screen.getByRole("button", { name: "Utiliser un token personnel" }));
    const field = screen.getByLabelText("Token personnel Databricks");
    expect(field).toHaveAttribute("type", "password");
    expect(field).toHaveAttribute("autocomplete", "off");
    await userEvent.type(field, "dapi-secret");
    await userEvent.click(screen.getByRole("button", { name: "Ranger dans le coffre" }));

    await waitFor(() => expect(api.calls.some((c) => c.method === "PUT")).toBe(true));
    expect(api.calls.find((c) => c.method === "PUT")?.body).toEqual({ token: "dapi-secret" });
    expect(await screen.findByRole("cell", { name: /^Connecté ?· ?token personnel$/ })).toBeInTheDocument();
    expect(screen.queryByLabelText("Token personnel Databricks")).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain("dapi-secret");
  });

  it("nouveau point d'accès : OAuth et test sur le brouillon, puis proposition", async () => {
    let connected = false;
    const api = server(LIST, ({ method, path }) => {
      if (path === `${API}/access-point-draft/authorize`) return { json: { authorize_url: "https://adb-2.azuredatabricks.net/oidc/v1/authorize" } };
      if (path === `${API}/access-point-draft/status`) {
        connected = true;
        return { json: { ...connection({ access_point: "dbx-de" }), my_access: "connected", flow: { status: "connected", error: null }, error: null } };
      }
      if (path === `${API}/access-point-draft/test`) return { json: { ok: true, latency_ms: 7, error: null } };
      if (path === `${API}/connections` && method === "POST") return { json: { id: 9, title: "Point d'accès dbx-de" } };
      return undefined;
    });
    render(screenFor());
    await screen.findByRole("textbox", { name: "Identifiant" });
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Identifiant" })).toHaveValue("dbx-de"));
    await userEvent.type(screen.getByRole("textbox", { name: "Hôte" }), "adb-2.azuredatabricks.net");
    await userEvent.type(screen.getByRole("textbox", { name: "SQL warehouse" }), "abc123");
    await userEvent.type(screen.getByRole("textbox", { name: "Schéma" }), "gold.finance");

    await userEvent.click(screen.getByRole("button", { name: "S'authentifier avec OAuth" }));
    expect(openExternal).toHaveBeenCalledWith("https://adb-2.azuredatabricks.net/oidc/v1/authorize");
    expect(await screen.findByText("Connecté : le token est rangé dans votre coffre, sous dbx-de.", undefined, { timeout: 4000 })).toBeInTheDocument();
    expect(connected).toBe(true);

    await userEvent.click(screen.getByRole("button", { name: "Tester la connexion" }));
    expect(await screen.findByText("Connexion OK · 7 ms")).toBeInTheDocument();

    const propose = screen.getByRole("button", { name: "Proposer le point d'accès" });
    expect(propose).toBeDisabled();
    await userEvent.type(screen.getByRole("textbox", { name: "Justification" }), "Point d'accès de nordis-de.");
    await userEvent.click(propose);
    const link = await screen.findByRole("link", { name: "Voir la proposition" });
    expect(link).toHaveAttribute("href", "#/w/groupe-nordis/propositions?n=9&status=open&domain=tous");

    const expected = {
      id: "dbx-de",
      platform: "databricks",
      host: "https://adb-2.azuredatabricks.net",
      warehouse_id: "abc123",
      schema: "gold.finance",
      entity: "nordis-de",
      owner: "julien.h",
    };
    const draftCalls = api.calls.filter((c) => c.path.includes("/access-point-draft/")
      && c.method !== "GET");
    expect(draftCalls.map((c) => c.body)).toEqual(draftCalls.map(() => ({ access_point: expected })));
    expect(api.calls.find((c) => c.method === "POST" && c.path === `${API}/connections`)?.body).toEqual({
      access_point: expected,
      justification: "Point d'accès de nordis-de.",
    });
  });

  it("[S-0016-07] deux clics rapides sur « Se connecter » ne lancent qu'un flux OAuth, boutons désactivés pendant le lancement", async () => {
    let release!: () => void;
    const held = new Promise<{ json: unknown }>((resolve) => {
      release = () => resolve({ json: { authorize_url: "https://adb-1.azuredatabricks.net/oidc/v1/authorize?state=s" } });
    });
    const list = () => [connection({ access_point: "dbx-fr", auth: null, my_access: "never" })];
    const api = server(list, ({ path }) => {
      if (path === `${API}/connections/dbx-fr/authorize`) return held;
      if (path === `${API}/connections/dbx-fr/status`) return { json: { ...list()[0], flow: { status: "pending", error: null }, error: null } };
      return undefined;
    });
    render(screenFor());
    const button = await screen.findByRole("button", { name: "Se connecter à Databricks · dbx-fr" });
    // Deux clics dans le même tick : la garde est posée avant tout rendu.
    await act(async () => {
      button.click();
      button.click();
    });
    expect(button).toBeDisabled();
    release();
    expect(await screen.findByText("Terminez la connexion dans le navigateur…")).toBeInTheDocument();
    expect(api.calls.filter((c) => c.method === "POST" && c.path.endsWith("/authorize"))).toHaveLength(1);
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("[S-0016-07] page d'autorisation abandonnée : « Annuler » arrête le flux côté serveur, puis « Se connecter » relance", async () => {
    const list = () => [connection({ access_point: "dbx-fr", auth: null, my_access: "never" })];
    const api = server(list, ({ path }) => {
      if (path === `${API}/connections/dbx-fr/authorize/cancel`) return { json: { cancelled: true } };
      if (path === `${API}/connections/dbx-fr/authorize`) return { json: { authorize_url: "https://adb-1.azuredatabricks.net/oidc/v1/authorize?state=s" } };
      if (path === `${API}/connections/dbx-fr/status`) return { json: { ...list()[0], flow: { status: "pending", error: null }, error: null } };
      return undefined;
    });
    render(screenFor());
    await userEvent.click(await screen.findByRole("button", { name: "Se connecter à Databricks · dbx-fr" }));
    expect(await screen.findByText("Terminez la connexion dans le navigateur…")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Annuler la connexion Databricks · dbx-fr" }));
    await userEvent.click(await screen.findByRole("button", { name: "Se connecter à Databricks · dbx-fr" }));
    expect(await screen.findByText("Terminez la connexion dans le navigateur…")).toBeInTheDocument();
    const posts = api.calls.filter((c) => c.method === "POST").map((c) => c.path.replace(`${API}/connections/dbx-fr/`, ""));
    expect(posts).toEqual(["authorize", "authorize/cancel", "authorize"]);
    expect(openExternal).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("[S-0016-07] après l'annulation, la ligne montre l'état du coffre : connecté si le navigateur a abouti avant, quelle que soit la réponse", async () => {
    let connected = false;
    const list = () => [connection({ access_point: "dbx-fr", auth: connected ? "oauth" : null, my_access: connected ? "connected" : "never" })];
    server(list, ({ path }) => {
      if (path === `${API}/connections/dbx-fr/authorize/cancel`) {
        connected = true; // le navigateur a terminé pendant l'annulation
        return { json: { cancelled: true } }; // la réponse n'est pas ce que l'écran affiche
      }
      if (path === `${API}/connections/dbx-fr/authorize`) return { json: { authorize_url: "https://adb-1.azuredatabricks.net/oidc/v1/authorize?state=s" } };
      if (path === `${API}/connections/dbx-fr/status`) return { json: { ...list()[0], flow: { status: "pending", error: null }, error: null } };
      return undefined;
    });
    render(screenFor());
    await userEvent.click(await screen.findByRole("button", { name: "Se connecter à Databricks · dbx-fr" }));
    await userEvent.click(await screen.findByRole("button", { name: "Annuler la connexion Databricks · dbx-fr" }));
    expect(await screen.findByRole("cell", { name: /^Connecté ?· ?session OAuth$/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Se connecter à Databricks · dbx-fr" })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("[S-0016-07] brouillon : l'accès enregistré juste avant l'annulation s'affiche connecté", async () => {
    let stored = false;
    server(LIST, ({ path }) => {
      if (path === `${API}/access-point-draft/authorize`) return { json: { authorize_url: "https://adb-2.azuredatabricks.net/oidc/v1/authorize" } };
      if (path === `${API}/access-point-draft/authorize/cancel`) {
        stored = true;
        return { json: { cancelled: false } };
      }
      if (path === `${API}/access-point-draft/status`) {
        return { json: { ...connection({ access_point: "dbx-de", my_access: stored ? "connected" : "never" }), flow: { status: "pending", error: null }, error: null } };
      }
      return undefined;
    });
    render(screenFor());
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Identifiant" })).toHaveValue("dbx-de"));
    await userEvent.click(screen.getByRole("button", { name: "S'authentifier avec OAuth" }));
    await userEvent.click(await screen.findByRole("button", { name: "Annuler la connexion" }));
    expect(await screen.findByText(/Connecté : le token est rangé dans votre coffre/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reconnecter avec OAuth" })).toBeInTheDocument();
  });

  it("[S-0016-07] si l'annulation échoue, l'écran le dit au lieu de laisser croire que c'est annulé", async () => {
    const list = () => [connection({ access_point: "dbx-fr", auth: null, my_access: "never" })];
    server(list, ({ path }) => {
      if (path === `${API}/connections/dbx-fr/authorize/cancel`) return { status: 503, json: { detail: { code: "vault_unavailable", message: "x" } } };
      if (path === `${API}/connections/dbx-fr/authorize`) return { json: { authorize_url: "https://adb-1.azuredatabricks.net/oidc/v1/authorize?state=s" } };
      if (path === `${API}/connections/dbx-fr/status`) return { json: { ...list()[0], flow: { status: "pending", error: null }, error: null } };
      return undefined;
    });
    render(screenFor());
    await userEvent.click(await screen.findByRole("button", { name: "Se connecter à Databricks · dbx-fr" }));
    await userEvent.click(await screen.findByRole("button", { name: "Annuler la connexion Databricks · dbx-fr" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Trousseau du système indisponible");
  });

  it("[S-0016-07] le brouillon est verrouillé pendant la connexion : l'identifiant et l'hôte ne changent plus sous le flux", async () => {
    server(LIST, ({ path }) => {
      if (path === `${API}/access-point-draft/authorize`) return { json: { authorize_url: "https://adb-2.azuredatabricks.net/oidc/v1/authorize" } };
      if (path === `${API}/access-point-draft/status`) return { json: { ...connection({ access_point: "dbx-de" }), flow: { status: "pending", error: null }, error: null } };
      return undefined;
    });
    render(screenFor());
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Identifiant" })).toHaveValue("dbx-de"));
    expect(screen.getByRole("textbox", { name: "Hôte" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "S'authentifier avec OAuth" }));
    expect(await screen.findByText(/Les champs sont verrouillés le temps de la connexion/)).toBeInTheDocument();
    for (const name of ["Identifiant", "Hôte", "Schéma"]) expect(screen.getByRole("textbox", { name })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: /Plateforme/ })).toBeDisabled();
  });

  it("[S-0016-07] le brouillon est verrouillé dès le lancement, pas seulement une fois en attente", async () => {
    let release!: () => void;
    const held = new Promise<{ json: unknown }>((resolve) => {
      release = () => resolve({ json: { authorize_url: "https://adb-2.azuredatabricks.net/oidc/v1/authorize" } });
    });
    server(LIST, ({ path }) => {
      if (path === `${API}/access-point-draft/authorize`) return held;
      if (path === `${API}/access-point-draft/status`) return { json: { ...connection({ access_point: "dbx-de" }), flow: { status: "pending", error: null }, error: null } };
      return undefined;
    });
    render(screenFor());
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Identifiant" })).toHaveValue("dbx-de"));
    await userEvent.click(screen.getByRole("button", { name: "S'authentifier avec OAuth" }));
    // L'autorisation n'est pas encore répondue : le serveur autorise déjà le point d'origine.
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Identifiant" })).toBeDisabled());
    expect(screen.getByRole("textbox", { name: "Hôte" })).toBeDisabled();
    release();
    expect(await screen.findByText(/Les champs sont verrouillés le temps de la connexion/)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Identifiant" })).toBeDisabled();
  });

  it("[S-0016-07] « Annuler la connexion » du panneau « Nouveau point d'accès » arrête aussi le flux du brouillon", async () => {
    const api = server(LIST, ({ path }) => {
      if (path === `${API}/access-point-draft/authorize`) return { json: { authorize_url: "https://adb-2.azuredatabricks.net/oidc/v1/authorize" } };
      if (path === `${API}/access-point-draft/authorize/cancel`) return { json: { cancelled: true } };
      if (path === `${API}/access-point-draft/status`) return { json: { ...connection({ access_point: "dbx-de" }), flow: { status: "pending", error: null }, error: null } };
      return undefined;
    });
    render(screenFor());
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Identifiant" })).toHaveValue("dbx-de"));
    await userEvent.click(screen.getByRole("button", { name: "S'authentifier avec OAuth" }));
    await userEvent.click(await screen.findByRole("button", { name: "Annuler la connexion" }));
    await screen.findByRole("button", { name: "S'authentifier avec OAuth" });
    expect(screen.getByRole("textbox", { name: "Identifiant" })).toBeEnabled();
    const cancel = api.calls.find((c) => c.path === `${API}/access-point-draft/authorize/cancel`);
    expect(cancel?.method).toBe("POST");
    expect((cancel?.body as { access_point: { id: string } }).access_point.id).toBe("dbx-de");
  });

  it("[S-0016-07] le panneau « Nouveau point d'accès » ne lance pas non plus deux fois l'OAuth", async () => {
    let release!: () => void;
    const held = new Promise<{ json: unknown }>((resolve) => {
      release = () => resolve({ json: { authorize_url: "https://adb-2.azuredatabricks.net/oidc/v1/authorize" } });
    });
    const api = server(LIST, ({ path }) => {
      if (path === `${API}/access-point-draft/authorize`) return held;
      if (path === `${API}/access-point-draft/status`) return { json: { ...connection({ access_point: "dbx-de" }), flow: { status: "pending", error: null }, error: null } };
      return undefined;
    });
    render(screenFor());
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Identifiant" })).toHaveValue("dbx-de"));
    const button = screen.getByRole("button", { name: "S'authentifier avec OAuth" });
    await act(async () => {
      button.click();
      button.click();
    });
    expect(button).toBeDisabled();
    release();
    expect(await screen.findByText("Terminez la connexion dans le navigateur : l'état se met à jour ici.")).toBeInTheDocument();
    expect(api.calls.filter((c) => c.method === "POST" && c.path.endsWith("/authorize"))).toHaveLength(1);
  });

  it("[S-0016-07] port de retour OAuth occupé : titre et consigne, pas le texte brut", async () => {
    const list = () => [connection({ access_point: "dbx-fr", auth: null, my_access: "never" })];
    server(list, ({ path }) => {
      if (path === `${API}/connections/dbx-fr/authorize`) {
        return { status: 409, json: { detail: { code: "oauth_port_busy", message: "Le port 8020 est occupé : texte brut du serveur." } } };
      }
      return undefined;
    });
    render(screenFor());
    await userEvent.click(await screen.findByRole("button", { name: "Se connecter à Databricks · dbx-fr" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Une connexion OAuth est déjà en cours");
    expect(alert).toHaveTextContent("Terminez-la ou fermez-la, puis réessayez.");
    expect(alert).not.toHaveTextContent("texte brut");
    // L'échec ne bloque pas un nouvel essai.
    expect(screen.getByRole("button", { name: "Se connecter à Databricks · dbx-fr" })).toBeEnabled();
  });

  it("[S-0016-08] un test refusé pour accès expiré est expliqué, et la ligne propose « Reconnecter »", async () => {
    let expired = false;
    const list = () => [connection({ access_point: "dbx-fr", auth: "pat", my_access: expired ? "expired" : "connected" })];
    const api = server(list, ({ path }) => {
      if (path === `${API}/connections/dbx-fr/test`) {
        expired = true;
        return { json: { ok: false, latency_ms: null, error: { code: "access_expired", message: "La plateforme refuse vos identifiants : texte brut du serveur." } } };
      }
      return undefined;
    });
    render(screenFor());
    await userEvent.click(await screen.findByRole("button", { name: "Tester Databricks · dbx-fr" }));
    const status = await screen.findByText(/^Accès expiré\./);
    expect(status).toHaveTextContent("Reconnectez-vous depuis Mes connexions, puis réessayez.");
    expect(status).not.toHaveTextContent("texte brut");
    expect(await screen.findByRole("button", { name: "Reconnecter Databricks · dbx-fr" })).toBeInTheDocument();
    expect(await screen.findByRole("cell", { name: "Token expiré" })).toBeInTheDocument();
    expect(api.calls.filter((c) => c.path === `${API}/connections` && c.method === "GET").length).toBeGreaterThanOrEqual(2);
    expect(status).toBeInTheDocument(); // la relecture de la liste ne perd pas le message
  });

  it("[S-0016-08] tester le brouillon avant de s'être connecté : « Pas encore connecté » et la marche à suivre", async () => {
    server(LIST, ({ path }) => {
      if (path === `${API}/access-point-draft/test`) {
        return { json: { ok: false, latency_ms: null, error: { code: "not_connected", message: "Pas encore connecté à « dbx-de »." } } };
      }
      return undefined;
    });
    render(screenFor());
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Identifiant" })).toHaveValue("dbx-de"));
    await userEvent.click(screen.getByRole("button", { name: "Tester la connexion" }));
    expect(await screen.findByText(/^Pas encore connecté\. .*Connectez-vous depuis Mes connexions/)).toBeInTheDocument();
  });

  it("un code du serveur non traduit garde son message dans le résultat d'un test", async () => {
    server(LIST, ({ path }) => {
      if (path === `${API}/connections/dbx-fr/test`) {
        return { json: { ok: false, latency_ms: null, error: { code: "platform_forbidden", message: "Accès refusé par Databricks : droits insuffisants." } } };
      }
      return undefined;
    });
    render(screenFor());
    await userEvent.click(await screen.findByRole("button", { name: "Tester Databricks · dbx-fr" }));
    expect(await screen.findByText("Accès refusé par Databricks : droits insuffisants.")).toBeInTheDocument();
  });

  it("Snowflake en SSO : identifiant, Atlas ouvre le navigateur, puis Connecté · session SSO (plan 0018)", async () => {
    let connected = false;
    const point = { access_point: "snow-de", platform: "snowflake", auth_mode: "sso" as const, entity: "nordis-de" };
    const list = () => [connection({ ...point, auth: connected ? "sso" : null, login: connected ? "anna@nordis.example" : null, my_access: connected ? "connected" : "never" })];
    const api = server(list, ({ path }) => {
      if (path === `${API}/connections/snow-de/authorize`) return { json: { authorize_url: null } };
      if (path === `${API}/connections/snow-de/status`) {
        connected = true;
        return { json: { ...list()[0], flow: { status: "connected", error: null }, error: null } };
      }
      return undefined;
    });
    render(screenFor());
    await userEvent.click(await screen.findByRole("button", { name: "Se connecter à Snowflake · snow-de" }));
    const open = screen.getByRole("button", { name: "Ouvrir le SSO" });
    expect(open).toBeDisabled();
    expect(screen.queryByLabelText(/Passphrase/)).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Identifiant Snowflake"), "anna@nordis.example");
    await userEvent.click(open);
    expect(api.calls.find((c) => c.path === `${API}/connections/snow-de/authorize`)?.body).toEqual({ user: "anna@nordis.example" });
    expect(openExternal).not.toHaveBeenCalled(); // le serveur ouvre le navigateur lui-même
    expect(await screen.findByRole("cell", { name: /^Connecté ?· ?session SSO$/ }, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tester Snowflake · snow-de" })).toBeInTheDocument();
  });

  it("Snowflake par paire de clés : chemin et passphrase, champ masqué vidé après l'envoi (plan 0018)", async () => {
    let saved = false;
    const point = { access_point: "snow-es", platform: "snowflake", auth_mode: "keypair" as const, entity: "nordis-es" };
    const list = () => [connection({ ...point, auth: saved ? "keypair" : null, my_access: saved ? "connected" : "never" })];
    const api = server(list, ({ method, path }) => {
      if (path === `${API}/connections/snow-es/key-pair` && method === "PUT") {
        const body = api.calls.at(-1)?.body as { passphrase?: string };
        if (body.passphrase !== "pass-secrete") return { status: 422, json: { detail: { code: "wrong_passphrase", message: "Passphrase incorrecte pour cette clé." } } };
        saved = true;
        return { json: list()[0] };
      }
      return undefined;
    });
    render(screenFor());
    await userEvent.click(await screen.findByRole("button", { name: "Se connecter à Snowflake · snow-es" }));
    await userEvent.type(screen.getByLabelText("Identifiant Snowflake"), "svc_es");
    await userEvent.type(screen.getByLabelText("Fichier de clé privée"), "/Users/anna/.ssh/svc_es.p8");
    const passphrase = screen.getByLabelText("Passphrase (si la clé est chiffrée)");
    expect(passphrase).toHaveAttribute("type", "password");
    expect(passphrase).toHaveAttribute("autocomplete", "off");
    expect(screen.queryByRole("button", { name: "Choisir…" })).not.toBeInTheDocument(); // hors Tauri

    await userEvent.type(passphrase, "mauvaise");
    await userEvent.click(screen.getByRole("button", { name: "Ranger dans le coffre" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Passphrase incorrecte pour cette clé.");
    expect(passphrase).toHaveValue("");

    await userEvent.type(passphrase, "pass-secrete");
    await userEvent.click(screen.getByRole("button", { name: "Ranger dans le coffre" }));
    expect(await screen.findByRole("cell", { name: /^Connecté ?· ?paire de clés$/ })).toBeInTheDocument();
    expect(await screen.findByText("Clé enregistrée : la passphrase est dans le coffre de ce poste.")).toBeInTheDocument();
    expect(api.calls.filter((c) => c.method === "PUT").at(-1)?.body).toEqual({
      user: "svc_es",
      private_key_file: "/Users/anna/.ssh/svc_es.p8",
      passphrase: "pass-secrete",
    });
    expect(screen.queryByLabelText("Passphrase (si la clé est chiffrée)")).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain("pass-secrete");
  });

  it("nouveau point d'accès Snowflake : entrepôt, rôle, paire de clés sur le brouillon (plan 0018)", async () => {
    const api = server(LIST, ({ method, path }) => {
      if (path === `${API}/access-point-draft/key-pair` && method === "PUT") return { json: connection({ access_point: "snow-es", platform: "snowflake" }) };
      if (path === `${API}/access-point-draft/test`) return { json: { ok: true, latency_ms: 12, error: null } };
      return undefined;
    });
    render(screenFor());
    const platform = await screen.findByRole("combobox", { name: "Plateforme (autorisées par le référent)" });
    await waitFor(() => expect(within(platform).getAllByRole("option")).toHaveLength(3));
    await userEvent.selectOptions(platform, "snowflake");
    expect(screen.queryByRole("textbox", { name: "SQL warehouse" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "S'authentifier avec OAuth" })).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Entité" }), "nordis-es");
    expect(screen.getByRole("textbox", { name: "Identifiant" })).toHaveValue("snow-es");
    await userEvent.type(screen.getByRole("textbox", { name: "Hôte" }), "nordis-es.snowflakecomputing.com");
    await userEvent.type(screen.getByRole("textbox", { name: "Entrepôt" }), "WH_VENTAS");
    await userEvent.type(screen.getByRole("textbox", { name: "Rôle" }), "ANALYSTE");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Authentification" }), "keypair");
    await userEvent.type(screen.getByLabelText("Identifiant Snowflake"), "svc_es");
    await userEvent.type(screen.getByLabelText("Fichier de clé privée"), "/cles/svc_es.p8");
    await userEvent.type(screen.getByLabelText("Passphrase (si la clé est chiffrée)"), "pass-secrete");
    await userEvent.click(screen.getByRole("button", { name: "Ranger dans le coffre" }));
    expect(await screen.findByText("Clé enregistrée : la passphrase est dans votre coffre, sous snow-es.")).toBeInTheDocument();
    expect(screen.getByLabelText("Passphrase (si la clé est chiffrée)")).toHaveValue("");

    await userEvent.click(screen.getByRole("button", { name: "Tester la connexion" }));
    expect(await screen.findByText("Connexion OK · 12 ms")).toBeInTheDocument();
    const expected = {
      id: "snow-es",
      platform: "snowflake",
      host: "https://nordis-es.snowflakecomputing.com",
      warehouse: "WH_VENTAS",
      role: "ANALYSTE",
      auth: "keypair",
      entity: "nordis-es",
      owner: "julien.h",
    };
    expect(api.calls.find((c) => c.path === `${API}/access-point-draft/key-pair`)?.body).toEqual({
      access_point: expected,
      user: "svc_es",
      private_key_file: "/cles/svc_es.p8",
      passphrase: "pass-secrete",
    });
    expect(api.calls.find((c) => c.path === `${API}/access-point-draft/test`)?.body).toEqual({ access_point: expected });
  });

  it.each([true, false])("explique les plateformes absentes (référent : %s)", async (referent) => {
    server([], (call) => call.path === `${API}/connections/platforms` ? { json: [] } : undefined);
    render(screenFor(workspace({ role: referent ? "referent" : "contributeur", space_referent: referent })));
    expect(await screen.findByRole("heading", { name: "Aucune plateforme connectable autorisée" })).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Nouveau point d'accès" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Ajouter un point d'accès" })).toBeNull();
    const link = screen.queryByRole("link", { name: "Configurer les plateformes" });
    if (referent) expect(link).toHaveAttribute("href", "#/w/groupe-nordis/administration");
    else expect(link).toBeNull();
  });

  it("un lecteur ne déclare pas de point d'accès", async () => {
    server();
    render(screenFor(workspace({ role: "lecteur", role_label: "Lecteur" })));
    await screen.findByRole("table");
    expect(screen.queryByRole("button", { name: "Ajouter un point d'accès" })).not.toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Nouveau point d'accès" })).not.toBeInTheDocument();
  });
});

describe("mes connexions : échecs et actions secondaires", () => {
  const refused = (message: string, status = 409) => ({ status, json: { detail: { code: "refus_test", message } } });

  it("une liste illisible est expliquée et « Réessayer » la relit", async () => {
    let attempts = 0;
    server(LIST, ({ method, path }) => {
      if (path === `${API}/connections` && method === "GET" && ++attempts === 1) return refused("Le dépôt de l'espace est illisible.", 500);
      return undefined;
    });
    render(screenFor());
    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent("Le dépôt de l'espace est illisible.");
    await userEvent.click(within(banner).getByRole("button", { name: "Réessayer" }));
    expect(await screen.findByRole("table", { name: "Points d'accès de l'espace" })).toBeInTheDocument();
    expect(attempts).toBe(2);
  });

  it("« Ajouter un point d'accès » amène le focus dans le panneau", async () => {
    server();
    render(screenFor());
    const platform = await screen.findByRole("combobox", { name: "Plateforme (autorisées par le référent)" });
    await userEvent.click(await screen.findByRole("button", { name: "Ajouter un point d'accès" }));
    expect(platform).toHaveFocus();
  });

  it("un test ou une révocation refusés s'affichent sur la ligne sans la changer", async () => {
    const api = server([LIST[0]], ({ method, path }) => {
      if (path === `${API}/connections/dbx-fr/test`) return refused("Entrepôt arrêté.");
      if (path === `${API}/connections/dbx-fr/token` && method === "DELETE") return refused("Coffre verrouillé.");
      return undefined;
    });
    render(screenFor());
    const line = await row(/Claire M\./);
    await userEvent.click(within(line).getByRole("button", { name: "Tester Databricks · dbx-fr" }));
    expect(await within(line).findByText("Entrepôt arrêté.")).toHaveClass("tone-bad");
    await userEvent.click(within(line).getByRole("button", { name: "Révoquer Databricks · dbx-fr" }));
    expect(await within(line).findByText("Coffre verrouillé.")).toHaveClass("tone-bad");
    expect(within(line).getByRole("button", { name: "Tester Databricks · dbx-fr" })).toBeEnabled();
    expect(api.calls.filter((c) => c.path === `${API}/connections` && c.method === "GET")).toHaveLength(1);
  });

  it("une révocation sans retrait chez la plateforme le dit", async () => {
    server([LIST[0]], ({ method, path }) =>
      path === `${API}/connections/dbx-fr/token` && method === "DELETE" ? { json: { revoked: true, remote_revoked: false } } : undefined);
    render(screenFor());
    await userEvent.click(await screen.findByRole("button", { name: "Révoquer Databricks · dbx-fr" }));
    expect(await screen.findByText("Accès retiré du coffre.")).toHaveClass("tone-ok");
  });

  it("une plateforme retirée par le référent n'offre aucune action", async () => {
    server([connection({ access_point: "dbx-fr", allowed: false })]);
    render(screenFor());
    const line = await row(/Claire M\./);
    expect(line).toHaveTextContent("Plateforme retirée par le référent");
    expect(within(line).queryByRole("button")).toBeNull();
  });

  it("token personnel : Annuler referme le champ ; un refus du coffre est expliqué et le champ vidé", async () => {
    const api = server([LIST[2], connection({ access_point: "dbx-fr" })], ({ method, path }) => {
      if (path === `${API}/connections/dbx-fr/authorize`) return refused("Client OAuth inconnu.", 400);
      if (path === `${API}/connections/dbx-fr/token` && method === "PUT") return refused("Coffre verrouillé.", 500);
      return undefined;
    });
    render(screenFor());
    await userEvent.click(await screen.findByRole("button", { name: "Se connecter à Databricks · dbx-fr" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Client OAuth inconnu.");
    await userEvent.click(screen.getByRole("button", { name: "Utiliser un token personnel" }));
    await userEvent.click(screen.getByRole("button", { name: "Annuler" }));
    expect(screen.queryByLabelText("Token personnel Databricks")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Utiliser un token personnel" }));
    const field = screen.getByLabelText("Token personnel Databricks");
    expect(screen.getByRole("button", { name: "Ranger dans le coffre" })).toBeDisabled();
    await userEvent.type(field, "dapi-secret");
    await userEvent.click(screen.getByRole("button", { name: "Ranger dans le coffre" }));
    expect(await screen.findByText("Coffre verrouillé.")).toHaveClass("field-error");
    expect(field).toHaveValue("");
    expect(api.calls.find((c) => c.method === "PUT")?.body).toEqual({ token: "dapi-secret" });
  });

  it("nouveau point d'accès : un identifiant saisi à la main n'est plus recalculé avec l'entité", async () => {
    server();
    render(screenFor());
    const id = await screen.findByRole("textbox", { name: "Identifiant" });
    await waitFor(() => expect(id).toHaveValue("dbx-de"));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Entité" }), "nordis-es");
    expect(id).toHaveValue("dbx-es");
    await userEvent.clear(id);
    await userEvent.type(id, "dbx-perso");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Entité" }), "");
    expect(id).toHaveValue("dbx-perso");
  });

  it("nouveau point d'accès : test et déclaration refusés sont expliqués", async () => {
    const api = server(LIST, ({ method, path }) => {
      if (path === `${API}/access-point-draft/test`) return refused("Hôte injoignable.", 502);
      if (path === `${API}/connections` && method === "POST") return refused("Un point d'accès porte déjà cet identifiant.");
      return undefined;
    });
    render(screenFor());
    await userEvent.click(await screen.findByRole("button", { name: "Tester la connexion" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Hôte injoignable.");
    await userEvent.type(screen.getByRole("textbox", { name: "Justification" }), "Point de nordis-de.");
    await userEvent.click(screen.getByRole("button", { name: "Proposer le point d'accès" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Un point d'accès porte déjà cet identifiant.");
    expect(screen.queryByRole("link", { name: "Voir la proposition" })).toBeNull();
    // La justification reste, pour réessayer sans la retaper.
    expect(screen.getByRole("textbox", { name: "Justification" })).toHaveValue("Point de nordis-de.");
    expect(api.calls.filter((c) => c.method === "POST" && c.path === `${API}/connections`)).toHaveLength(1);
  });

  it("les identifiants de brouillon restés au coffre s'oublient un par un", async () => {
    let stored = [{ id: "dbx-essai", host: "https://adb-9.azuredatabricks.net" }, { id: "snow-essai", host: "https://x.snowflakecomputing.com" }];
    const api = server(LIST, ({ method, path }) => {
      if (path === `${API}/access-point-draft/credentials` && method === "GET") return { json: stored };
      if (path === `${API}/access-point-draft/credentials/dbx-essai` && method === "DELETE") {
        stored = stored.filter((s) => s.id !== "dbx-essai");
        return { json: { removed: true } };
      }
      if (path === `${API}/access-point-draft/credentials/snow-essai` && method === "DELETE") return refused("Trousseau verrouillé.", 500);
      return undefined;
    });
    render(screenFor());
    const section = await screen.findByRole("region", { name: "Identifiants de brouillon non déclarés" });
    expect(within(section).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "dbx-essai · https://adb-9.azuredatabricks.net Oublier",
      "snow-essai · https://x.snowflakecomputing.com Oublier",
    ]);
    await userEvent.click(within(within(section).getAllByRole("listitem")[0]).getByRole("button", { name: "Oublier" }));
    await waitFor(() => expect(within(section).getAllByRole("listitem")).toHaveLength(1));
    expect(api.calls.some((c) => c.method === "DELETE" && c.path === `${API}/access-point-draft/credentials/dbx-essai`)).toBe(true);
    await userEvent.click(within(section).getByRole("button", { name: "Oublier" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Trousseau verrouillé.");
    expect(within(section).getByText("snow-essai")).toBeInTheDocument();
  });

  it("au-delà de 5 minutes sans réponse de la plateforme, l'attente s'arrête et le dit", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      server([connection({ access_point: "dbx-fr" })], ({ path }) => {
        if (path === `${API}/connections/dbx-fr/authorize`) return { json: { authorize_url: "https://adb-1/authorize" } };
        if (path === `${API}/connections/dbx-fr/status`) return { json: { ...connection({ access_point: "dbx-fr" }), flow: { status: "pending", error: null }, error: null } };
        return undefined;
      });
      render(screenFor());
      await userEvent.click(await screen.findByRole("button", { name: "Se connecter à Databricks · dbx-fr" }));
      expect(await screen.findByText("Terminez la connexion dans le navigateur…")).toBeInTheDocument();
      await act(() => vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 2000));
      expect(await screen.findByRole("alert")).toHaveTextContent("Délai dépassé : La connexion n'a pas abouti en 5 minutes : réessayer.");
      expect(screen.getByRole("button", { name: "Se connecter à Databricks · dbx-fr" })).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("un échec signalé sans détail par la plateforme reçoit un texte par défaut", async () => {
    server([connection({ access_point: "dbx-fr" })], ({ path }) => {
      if (path === `${API}/connections/dbx-fr/authorize`) return { json: { authorize_url: "https://adb-1/authorize" } };
      if (path === `${API}/connections/dbx-fr/status`) return { json: { ...connection({ access_point: "dbx-fr" }), flow: { status: "expired", error: null }, error: null } };
      return undefined;
    });
    render(screenFor());
    await userEvent.click(await screen.findByRole("button", { name: "Se connecter à Databricks · dbx-fr" }));
    expect(await screen.findByRole("alert", undefined, { timeout: 4000 })).toHaveTextContent("Connexion échouée : La plateforme a refusé la connexion.");
  });
});

describe("sélecteur de fichier natif (plan 0018)", () => {
  const point = { access_point: "snow-es", platform: "snowflake", auth_mode: "keypair" as const, entity: "nordis-es" };

  it("sous Tauri, « Choisir… » remplit le chemin de la clé ; une annulation le laisse intact", async () => {
    picker.enabled = true;
    vi.mocked(pickFile).mockResolvedValueOnce("/Users/anna/.ssh/svc_es.p8").mockResolvedValueOnce(null);
    server([connection(point)]);
    render(screenFor());
    await userEvent.click(await screen.findByRole("button", { name: "Se connecter à Snowflake · snow-es" }));
    const key = screen.getByLabelText("Fichier de clé privée");
    await userEvent.click(screen.getByRole("button", { name: "Choisir…" }));
    expect(pickFile).toHaveBeenCalledWith("Fichier de clé privée Snowflake");
    await waitFor(() => expect(key).toHaveValue("/Users/anna/.ssh/svc_es.p8"));
    await userEvent.click(screen.getByRole("button", { name: "Choisir…" }));
    await waitFor(() => expect(pickFile).toHaveBeenCalledTimes(2));
    expect(key).toHaveValue("/Users/anna/.ssh/svc_es.p8");
  });

  it("un sélecteur en échec est expliqué", async () => {
    picker.enabled = true;
    vi.mocked(pickFile).mockRejectedValueOnce(new Error("dialogue indisponible"));
    server([connection(point)]);
    render(screenFor());
    await userEvent.click(await screen.findByRole("button", { name: "Se connecter à Snowflake · snow-es" }));
    await userEvent.click(screen.getByRole("button", { name: "Choisir…" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("dialogue indisponible");
  });
});

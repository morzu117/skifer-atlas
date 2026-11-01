import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Connection, Platform, Workspace } from "../api";
import { ALTAVIA, fakeServer, workspace, type Call } from "../test/fakeServer";
import { accessLabel, Connections, suggestedId, toAccessPoint } from "./Connections";

vi.mock("../external", () => ({ openExternal: vi.fn(async () => undefined), canPickFile: () => false, pickFile: vi.fn() }));
import { openExternal } from "../external";

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

type Handler = (call: Call) => { status?: number; json?: unknown } | undefined;

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
    const draftCalls = api.calls.filter((c) => c.path.includes("/access-point-draft/"));
    expect(draftCalls.map((c) => c.body)).toEqual(draftCalls.map(() => ({ access_point: expected })));
    expect(api.calls.find((c) => c.method === "POST" && c.path === `${API}/connections`)?.body).toEqual({
      access_point: expected,
      justification: "Point d'accès de nordis-de.",
    });
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

  it("un lecteur ne déclare pas de point d'accès", async () => {
    server();
    render(screenFor(workspace({ role: "lecteur", role_label: "Lecteur" })));
    await screen.findByRole("table");
    expect(screen.queryByRole("button", { name: "Ajouter un point d'accès" })).not.toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Nouveau point d'accès" })).not.toBeInTheDocument();
  });
});

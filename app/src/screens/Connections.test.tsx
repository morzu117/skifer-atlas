import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Connection, Platform, Workspace } from "../api";
import { ALTAVIA, fakeServer, workspace, type Call } from "../test/fakeServer";
import { accessLabel, Connections, suggestedId, toAccessPoint } from "./Connections";

vi.mock("../external", () => ({ openExternal: vi.fn(async () => undefined) }));
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
    my_access: "never",
    expires_in_days: null,
    ...overrides,
  };
}

const PLATFORMS: Platform[] = [
  { id: "databricks", label: "Databricks", supported: true },
  { id: "snowflake", label: "Snowflake", supported: false },
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
  });

  it("identifiant proposé et brouillon envoyé au serveur", () => {
    expect(suggestedId("databricks", "nordis-fr")).toBe("dbx-fr");
    expect(suggestedId("snowflake", "")).toBe("snow-groupe");
    const draft = { platform: "databricks", id: " dbx-de ", host: "adb-2.azuredatabricks.net", warehouse: "abc123", schema: "", entity: "nordis-de", freshness: "" };
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
    expect(de).toHaveTextContent("Jamais connecté");
    expect(de).toHaveTextContent("Bientôt dans Atlas");
    expect(within(de).queryByRole("button")).not.toBeInTheDocument();
    // Aucun champ de token sans échec préalable (guide 10.6).
    expect(screen.queryByLabelText(/token/i)).not.toBeInTheDocument();
  });

  it("panneau : seules les plateformes autorisées, celles à venir désactivées (critère 6)", async () => {
    server();
    render(screenFor());
    const platform = await screen.findByRole("combobox", { name: "Plateforme (autorisées par le référent)" });
    await waitFor(() => expect(within(platform).getAllByRole("option")).toHaveLength(2));
    expect(within(platform).getByRole("option", { name: "Databricks" })).toBeEnabled();
    expect(within(platform).getByRole("option", { name: "Snowflake (bientôt)" })).toBeDisabled();
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

  it("échec de l'OAuth : repli par token personnel, champ masqué vidé après l'envoi", async () => {
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

  it("un lecteur ne déclare pas de point d'accès", async () => {
    server();
    render(screenFor(workspace({ role: "lecteur", role_label: "Lecteur" })));
    await screen.findByRole("table");
    expect(screen.queryByRole("button", { name: "Ajouter un point d'accès" })).not.toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Nouveau point d'accès" })).not.toBeInTheDocument();
  });
});

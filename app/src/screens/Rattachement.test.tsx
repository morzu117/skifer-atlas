import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminState, GitHubStatus, Workspace } from "../api";
import { fakeServer, workspace, type Call } from "../test/fakeServer";
import { Administration } from "./Administration";

// Plan 0033 : rattacher un espace neuf à un dépôt vide, avec la connexion GitHub avant.

vi.mock("../external", () => ({ openExternal: vi.fn(async () => undefined), canPickFile: () => false, pickFile: vi.fn() }));

const API = "/api/workspaces/maison-perrault";
const GITHUB_URL = "https://github.com/nordis/maison-perrault.git";
const DEVICE = { flow: "f1", user_code: "WDJB-MJHT", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 0 };

const local = workspace({ id: "maison-perrault", name: "Maison Perrault", git_remote: "", account: "anna.k", entities: ["perrault-fr"], domains: [] });

function admin(url: string, account = "anna.k"): AdminState {
  return {
    governance: {
      schema_version: 1,
      validators_required: { canonical: 1, variants: 1 },
      domains: [],
      members: [{ account, name: "Anna K.", entity: null, roles: [{ role: "referent", domains: [] }] }],
      allowed_platforms: [],
      tolerance: null,
    },
    base_digest: url ? "d2" : "d1",
    warnings: [],
    space_referents: [account],
    single_referent: true,
    kpi_counts: {},
    document_counts: {},
    platforms: [{ id: "databricks", label: "Databricks", auth: "OAuth · token personnel", supported: true }],
    repository: { url, main_branch: "main", synced_at: null, index_fresh: true },
  };
}

const github = (overrides: Partial<GitHubStatus> = {}): GitHubStatus => ({ configured: true, applies: false, state: "absent", source: null, account: null, ...overrides });
const failure = (status: number, code: string) => ({ status, json: { detail: { code, message: "message du serveur" } } });

/** Le serveur d'un espace neuf : le rattachement le publie et change le compte. */
function server(remote: (call: Call) => { status?: number; json?: unknown }, githubState: () => GitHubStatus = () => github(), polls: string[] = ["connected"]) {
  let url = "";
  let account = "anna.k";
  return fakeServer((call) => {
    if (call.path === `${API}/admin`) return { json: admin(url, account) };
    if (call.path === `${API}/github`) return { json: githubState() };
    if (call.path === "/api/github/device") return { json: DEVICE };
    if (call.path === "/api/github/device/f1") {
      const next = polls.shift() ?? "pending";
      return { json: { status: next, interval: 0, ...(next === "connected" ? { account: "claire-m" } : {}) } };
    }
    if (call.path === `${API}/remote`) {
      const answer = remote(call);
      if (!answer.status) ({ git_remote: url, account } = answer.json as Workspace);
      return answer;
    }
    return undefined;
  });
}

function Screen({ changes }: { changes?: (ws: Workspace) => void }) {
  const [ws, setWs] = useState(local);
  return <Administration ws={ws} heading={createRef()} onWorkspaceChange={(next) => (changes?.(next), setWs(next))} />;
}

const repository = () => screen.findByRole("region", { name: "Dépôt Git de l'espace" });
const attachment = async () => within(await screen.findByRole("group", { name: "Rattacher un dépôt distant" }));
const save = () => screen.getByRole("button", { name: /^Enregistrer et/ });

afterEach(() => vi.unstubAllGlobals());

describe("Administration d'un espace sans dépôt distant", () => {
  it("[S-0033-01] propose de rattacher un dépôt, garde l'enregistrement fermé, puis l'ouvre une fois rattaché", async () => {
    const changed: Workspace[] = [];
    const fake = server(() => ({ json: { ...local, git_remote: "/depots/perrault.git", account: "anna.k" } }));
    render(<Screen changes={(ws) => changed.push(ws)} />);
    expect(await screen.findByText("Cet espace n'a pas encore de dépôt distant")).toBeInTheDocument();
    expect(within(await repository()).getByText("Pas encore de dépôt distant")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: "Databricks" }));
    expect(save()).toBeDisabled();
    expect(screen.getByText("Rattachez d'abord un dépôt distant pour enregistrer.")).toBeInTheDocument();

    const form = await attachment();
    await userEvent.click(form.getByRole("button", { name: "Rattacher le dépôt" }));
    expect(form.getByText("L'adresse du dépôt est requise.")).toBeInTheDocument();
    await userEvent.type(form.getByLabelText(/^Adresse du dépôt vide/), "/depots/perrault.git{Enter}");

    expect(await within(await repository()).findByText(/Dépôt rattaché : l'espace est publié sur \/depots\/perrault\.git, sous le compte anna\.k\./)).toBeInTheDocument();
    expect(fake.calls.find((c) => c.path === `${API}/remote`)?.body).toEqual({ remote_url: "/depots/perrault.git" });
    expect(changed.map((ws) => ws.git_remote)).toEqual(["/depots/perrault.git"]);
    expect(within(await repository()).queryByRole("group", { name: "Rattacher un dépôt distant" })).toBeNull();
    expect(within(await repository()).getByRole("button", { name: "Synchroniser" })).toBeInTheDocument();
    expect(screen.queryByText("Cet espace n'a pas encore de dépôt distant")).toBeNull();
    // La modification faite avant le rattachement a suivi : elle s'enregistre maintenant.
    expect(await screen.findByRole("checkbox", { name: "Databricks" })).toBeChecked();
    await waitFor(() => expect(save()).toBeEnabled());
  });

  it("[S-0033-08] garde les modifications non enregistrées à travers le rattachement, compte réécrit compris", async () => {
    const fake = server(() => ({ json: { ...local, git_remote: GITHUB_URL, account: "claire-m" } }), () => github({ state: "connected", account: "claire-m", source: "vault" }));
    render(<Screen />);
    await userEvent.click(await screen.findByRole("checkbox", { name: "Databricks" }));
    await userEvent.clear(screen.getByLabelText("Canonique (min 1)"));
    await userEvent.type(screen.getByLabelText("Canonique (min 1)"), "2");
    expect(save()).toBeDisabled();

    const form = await attachment();
    await userEvent.type(form.getByLabelText(/^Adresse du dépôt vide/), `${GITHUB_URL}{Enter}`);
    expect(await within(await repository()).findByText(/Dépôt rattaché : l'espace est publié sur .*, sous le compte claire-m\./)).toBeInTheDocument();

    expect(await screen.findByRole("checkbox", { name: "Databricks" })).toBeChecked();
    expect(screen.getByLabelText("Canonique (min 1)")).toHaveValue(2);
    await waitFor(() => expect(save()).toBeEnabled());
    expect(screen.getByRole("button", { name: "Modifier Anna K." })).toBeInTheDocument();
    await userEvent.click(save());
    await waitFor(() => expect(fake.calls.some((c) => c.path === `${API}/admin/governance`)).toBe(true));
    const sent = fake.calls.find((c) => c.path === `${API}/admin/governance`)!.body as { governance: AdminState["governance"]; base_digest: string };
    expect(sent.base_digest).toBe("d2"); // la base relue après le rattachement
    expect(sent.governance.members.map((m) => m.account)).toEqual(["claire-m"]); // jamais l'ancien compte
    expect(sent.governance.allowed_platforms).toEqual(["databricks"]);
    expect(sent.governance.validators_required.canonical).toBe(2);
  });

  it("[S-0033-08] suspend le rattachement tant qu'un domaine ou un membre est en cours de modification", async () => {
    const fake = server(() => ({ json: { ...local, git_remote: "/depots/perrault.git", account: "anna.k" } }));
    render(<Screen />);
    const form = await attachment();
    await userEvent.type(form.getByLabelText(/^Adresse du dépôt vide/), "/depots/perrault.git");
    const attach = form.getByRole("button", { name: "Rattacher le dépôt" });
    expect(attach).toBeEnabled();
    expect(form.queryByText(/Validez ou annulez la modification en cours/)).toBeNull();

    await userEvent.click(await screen.findByRole("button", { name: "Modifier Anna K." }));
    expect(attach).toBeDisabled();
    expect(form.getByText("Validez ou annulez la modification en cours avant de rattacher le dépôt.")).toBeInTheDocument();
    await userEvent.type(form.getByLabelText(/^Adresse du dépôt vide/), "{Enter}"); // Entrée ne contourne pas la suspension
    expect(fake.calls.some((c) => c.path === `${API}/remote`)).toBe(false);

    await userEvent.click(within(screen.getByRole("group", { name: "Membre Anna K." })).getByRole("button", { name: "Annuler" }));
    expect(attach).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "Domaine" }));
    expect(attach).toBeDisabled();
    await userEvent.click(within(screen.getByRole("group", { name: "Nouveau domaine" })).getByRole("button", { name: "Annuler" }));
    expect(form.queryByText(/Validez ou annulez la modification en cours/)).toBeNull();
    await userEvent.click(attach);
    expect(await within(await repository()).findByText(/Dépôt rattaché/)).toBeInTheDocument();
  });

  it("[S-0033-08] gèle le reste du formulaire pendant la requête et le rechargement, puis garde le brouillon", async () => {
    let release: (answer: { json: Workspace }) => void = () => undefined;
    let reload: () => void = () => undefined;
    let url = "";
    fakeServer((call) => {
      if (call.path === `${API}/admin` && url) {
        return new Promise((resolve) => (reload = () => resolve({ json: admin(url) })));
      }
      if (call.path === `${API}/admin`) return { json: admin(url) };
      if (call.path === `${API}/remote`) {
        return new Promise((resolve) => {
          release = (answer) => ((url = answer.json.git_remote), resolve(answer));
        });
      }
      return undefined;
    });
    render(<Screen />);
    await userEvent.click(await screen.findByRole("checkbox", { name: "Databricks" }));
    const form = await attachment();
    await userEvent.type(form.getByLabelText(/^Adresse du dépôt vide/), "/depots/perrault.git{Enter}");

    expect(await form.findByText("Vérification du dépôt, puis envoi de l'espace…")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Databricks" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Domaine" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Modifier Anna K." })).toBeDisabled();
    expect(screen.getByLabelText("Canonique (min 1)")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Annuler" })).toBeDisabled();

    release({ json: { ...local, git_remote: "/depots/perrault.git" } });
    // La requête est finie, mais la gouvernance n'est pas relue : le formulaire reste gelé.
    await waitFor(() => expect(screen.getByText(/Dépôt rattaché/)).toBeInTheDocument());
    expect(screen.getByRole("checkbox", { name: "Databricks" })).toBeDisabled();
    expect(screen.getByLabelText("Canonique (min 1)")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Modifier Anna K." })).toBeDisabled();
    reload();
    // Le formulaire est remonté sur la gouvernance relue : une fois dégelé, il garde le brouillon.
    await waitFor(() => {
      expect(screen.getByText(/Dépôt rattaché/)).toBeInTheDocument();
      expect(screen.getByRole("checkbox", { name: "Databricks" })).toBeEnabled();
    });
    expect(screen.getByRole("checkbox", { name: "Databricks" })).toBeChecked();
    expect(screen.getByLabelText("Canonique (min 1)")).toBeEnabled();
  });

  it("[S-0033-08] si la relecture échoue après le rattachement, le formulaire reste gelé jusqu'à « Réessayer »", async () => {
    let url = "";
    let broken = true;
    fakeServer((call) => {
      if (call.path === `${API}/admin`) {
        if (url && broken) return { status: 500, json: { detail: { code: "internal_error", message: "boum" } } };
        return { json: admin(url) };
      }
      if (call.path === `${API}/remote`) {
        url = "/depots/perrault.git";
        return { json: { ...local, git_remote: url } };
      }
      return undefined;
    });
    render(<Screen />);
    await userEvent.click(await screen.findByRole("checkbox", { name: "Databricks" }));
    const form = await attachment();
    await userEvent.type(form.getByLabelText(/^Adresse du dépôt vide/), "/depots/perrault.git{Enter}");

    const retry = await screen.findByRole("button", { name: "Réessayer" });
    expect(screen.getByText(/Le dépôt est rattaché, mais les paramètres n'ont pas pu être relus/)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Databricks" })).toBeDisabled();
    expect(screen.getByLabelText("Canonique (min 1)")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Modifier Anna K." })).toBeDisabled();

    broken = false;
    await userEvent.click(retry);
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Databricks" })).toBeEnabled());
    expect(screen.getByRole("checkbox", { name: "Databricks" })).toBeChecked();
    expect(screen.queryByRole("button", { name: "Réessayer" })).toBeNull();
    expect(screen.getByText(/Dépôt rattaché/)).toBeInTheDocument();
    await waitFor(() => expect(save()).toBeEnabled());
  });

  it("[S-0033-08] abandonne le brouillon si le login GitHub y figure déjà, et le dit", async () => {
    server(() => ({ json: { ...local, git_remote: GITHUB_URL, account: "claire-m" } }), () => github({ state: "connected", account: "claire-m", source: "vault" }));
    render(<Screen />);
    await userEvent.click(await screen.findByRole("button", { name: "Inviter" }));
    const member = within(screen.getByRole("group", { name: "Nouveau membre" }));
    await userEvent.type(member.getByRole("textbox", { name: /Nom/ }), "Claire M.");
    await userEvent.type(member.getByRole("textbox", { name: /Compte/ }), "claire-m");
    await userEvent.selectOptions(member.getByRole("combobox", { name: "Entité" }), "perrault-fr");
    await userEvent.click(member.getByRole("button", { name: "Ajouter le membre" }));
    const members = () => within(screen.getByRole("table", { name: "Utilisateurs et rôles" }));
    expect(members().getByRole("row", { name: /Claire M\./ })).toBeInTheDocument();

    const form = await attachment();
    await userEvent.type(form.getByLabelText(/^Adresse du dépôt vide/), `${GITHUB_URL}{Enter}`);
    expect(await screen.findByText(/Vos modifications non enregistrées n'ont pas été reprises : le compte claire-m figurait déjà dans le brouillon\. Refaites-les à partir de la gouvernance du dépôt\./)).toBeInTheDocument();

    // La gouvernance du serveur : le créateur y est référent sous le login GitHub, le brouillon est abandonné.
    await waitFor(() => expect(members().queryByRole("row", { name: /Claire M\./ })).toBeNull());
    expect(members().getByRole("row", { name: /Anna K\./ })).toHaveTextContent(/Référent/);
    expect(members().getAllByRole("row")).toHaveLength(2); // l'en-tête et le créateur
    expect(save()).toBeDisabled(); // rien à enregistrer : l'ancien compte ne revient pas
  });

  it.each([
    ["remote_not_empty", 409, "Ce dépôt n'est pas vide", /Atlas ne rattache qu'un dépôt vierge/],
    ["remote_not_found", 422, "Dépôt introuvable", /le compte GitHub connecté doit y avoir accès/],
    ["remote_not_writable", 422, "Pas de droit d'écriture sur ce dépôt", /lecture seule ou dépôt archivé/],
    ["remote_partial", 409, "Rattachement interrompu", /reconnectez-vous à GitHub avec claire-m/],
    ["origin_conflict", 409, "Adresse origin différente", /configuration origin différente/],
    ["remote_exists", 409, "Espace déjà rattaché", /rien n'a été modifié/],
    ["invalid_remote", 422, "Adresse de dépôt invalide", /HTTPS, SSH/],
    ["credentials_in_url", 422, "Adresse avec identifiants", /Retirez l'identifiant/],
    ["unsupported_host", 422, "Hébergeur non pris en charge", /dépôt GitHub/],
    ["push_failed", 502, "L'envoi vers le dépôt a échoué", /l'espace reste local/],
    ["host_unreachable", 502, "Dépôt injoignable", /la connexion/],
  ])("[S-0033-02] %s : l'erreur dit pourquoi et le formulaire reste utilisable", async (code, status, title, text) => {
    server(() => code === "remote_partial"
      ? { status, json: { detail: { code, message: "Publié sous claire-m : reconnectez-vous à GitHub avec claire-m." } } }
      : failure(status, code));
    render(<Screen />);
    const form = await attachment();
    await userEvent.type(form.getByLabelText(/^Adresse du dépôt vide/), "/depots/x.git");
    await userEvent.click(form.getByRole("button", { name: "Rattacher le dépôt" }));
    const alert = await form.findByRole("alert");
    expect(alert).toHaveTextContent(title);
    expect(alert).toHaveTextContent(text);
    expect(alert).not.toHaveTextContent("message du serveur");
    expect(form.getByRole("button", { name: "Rattacher le dépôt" })).toBeEnabled();
    expect(within(await repository()).getByText("Pas encore de dépôt distant")).toBeInTheDocument();
  });
});

describe("rattacher à GitHub (plan 0033)", () => {
  it("[S-0033-03] demande d'abord la connexion GitHub, puis rattache avec le compte de GitHub", async () => {
    let state = github();
    const changed: Workspace[] = [];
    const fake = server(() => ({ json: { ...local, git_remote: GITHUB_URL, account: "claire-m" } }), () => state);
    render(<Screen changes={(ws) => changed.push(ws)} />);
    const form = await attachment();
    await userEvent.type(form.getByLabelText(/^Adresse du dépôt vide/), GITHUB_URL);
    expect(await form.findByText(/Atlas se sert de votre compte GitHub/)).toBeInTheDocument();
    expect(form.getByRole("button", { name: "Rattacher le dépôt" })).toBeDisabled();
    expect(form.queryByLabelText(/token|jeton/i)).toBeNull();

    state = github({ state: "connected", source: "vault", account: "claire-m" });
    await userEvent.click(form.getByRole("button", { name: "Se connecter à GitHub" }));
    expect(await form.findByText("WDJB-MJHT")).toBeInTheDocument();
    expect(fake.calls.find((c) => c.path === "/api/github/device")?.body).toEqual({ workspace: "maison-perrault" });
    expect(await form.findByText("Connecté à GitHub en tant que @claire-m.", {}, { timeout: 3000 })).toBeInTheDocument();
    await waitFor(() => expect(form.getByRole("button", { name: "Rattacher le dépôt" })).toBeEnabled());

    await userEvent.click(form.getByRole("button", { name: "Rattacher le dépôt" }));
    expect(await within(await repository()).findByText(/sous le compte claire-m\./)).toBeInTheDocument();
    expect(changed[0]).toMatchObject({ git_remote: GITHUB_URL, account: "claire-m", role: "referent" });
  });

  it("[S-0033-03] un jeton refusé pendant le rattachement fait proposer la reconnexion", async () => {
    let state = github({ state: "connected", source: "vault", account: "claire-m" });
    server(() => failure(502, "host_auth_failed"), () => state);
    render(<Screen />);
    const form = await attachment();
    await userEvent.type(form.getByLabelText(/^Adresse du dépôt vide/), GITHUB_URL);
    await form.findByText("Connecté à GitHub en tant que @claire-m.");
    state = github({ state: "expired", source: "vault", account: "claire-m" });
    await userEvent.click(form.getByRole("button", { name: "Rattacher le dépôt" }));
    expect(await form.findByRole("alert")).toHaveTextContent("Connectez-vous à GitHub ci-dessous, puis réessayez.");
    expect(await form.findByRole("button", { name: "Reconnecter GitHub" })).toBeInTheDocument();
    expect(form.getByRole("button", { name: "Rattacher le dépôt" })).toBeDisabled();
  });

  it("sans client OAuth, pas de bouton : le serveur dira ce qui manque", async () => {
    server(() => failure(502, "host_auth_failed"), () => github({ configured: false }));
    render(<Screen />);
    const form = await attachment();
    await userEvent.type(form.getByLabelText(/^Adresse du dépôt vide/), GITHUB_URL);
    expect(await form.findByText("Connexion GitHub non configurée pour cette installation.")).toBeInTheDocument();
    expect(form.queryByRole("button", { name: /GitHub/ })).toBeNull();
    expect(form.getByRole("button", { name: "Rattacher le dépôt" })).toBeEnabled();
  });

  it("une adresse hors GitHub ne demande aucune connexion", async () => {
    const fake = server(() => failure(422, "remote_not_found"));
    render(<Screen />);
    const form = await attachment();
    await userEvent.type(form.getByLabelText(/^Adresse du dépôt vide/), "/depots/x.git");
    await form.findByRole("button", { name: "Rattacher le dépôt" });
    expect(fake.calls.some((c) => c.path === `${API}/github`)).toBe(false);
  });
});

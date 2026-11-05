import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminState } from "../api";
import { fakeServer, workspace, type Call } from "../test/fakeServer";
import { CreateWorkspace } from "./CreateWorkspace";
import { Administration } from "./Administration";
import { WorkspaceShell } from "./WorkspaceShell";

// Plan 0034 : réinitialiser le rattachement d'un espace resté local, après un rattachement
// interrompu. Seule la copie locale change ; le dépôt distant n'est jamais modifié.

vi.mock("../external", () => ({ openExternal: vi.fn(async () => undefined), canPickFile: () => false, pickFile: vi.fn() }));

const API = "/api/workspaces/maison-perrault";
const local = workspace({ id: "maison-perrault", name: "Maison Perrault", git_remote: "", account: "anna.k", entities: ["perrault-fr"], domains: [] });

function admin(account: string, digest: string): AdminState {
  return {
    governance: {
      schema_version: 1,
      validators_required: { canonical: 1, variants: 1 },
      domains: [],
      members: [{ account, name: "Anna K.", entity: null, roles: [{ role: "referent", domains: [] }] }],
      allowed_platforms: [],
      tolerance: null,
    },
    base_digest: digest,
    warnings: [],
    space_referents: [account],
    single_referent: true,
    kpi_counts: {},
    document_counts: {},
    platforms: [{ id: "databricks", label: "Databricks", auth: "OAuth · token personnel", supported: true }],
    repository: { url: "", main_branch: "main", synced_at: null, index_fresh: true },
  };
}

const refusal = (code: string, message = "message du serveur") => ({ status: 409, json: { detail: { code, message } } });
const done = (identity: boolean) => ({
  json: { ...local, reset: { status: "reset", identity_reverted: identity, reverted_account: identity ? "claire-m" : null } },
});

/** Un espace local : le rattachement échoue avec `attach`, la réinitialisation répond `reset`. */
function server(attach: () => { status?: number; json?: unknown }, reset: (call: Call) => { status?: number; json?: unknown }, adminAccount: () => string = () => "anna.k") {
  return fakeServer((call) => {
    // L'empreinte suit la gouvernance : inchangée, le formulaire n'est pas remonté.
    if (call.path === `${API}/admin`) return { json: admin(adminAccount(), `d-${adminAccount()}`) };
    if (call.path === `${API}/remote`) return attach();
    if (call.path === `${API}/remote/reset`) return reset(call);
    return undefined;
  });
}

function Screen() {
  const [ws, setWs] = useState(local);
  return <Administration ws={ws} heading={createRef()} onWorkspaceChange={setWs} />;
}

const attachment = async () => within(await screen.findByRole("group", { name: "Rattacher un dépôt distant" }));
const repository = () => screen.findByRole("region", { name: "Dépôt Git de l'espace" });
const RESET = "Réinitialiser le rattachement";

async function fail(form: ReturnType<typeof within>, url = "/depots/x.git") {
  await userEvent.type(form.getByLabelText(/^Adresse du dépôt vide/), url);
  await userEvent.click(form.getByRole("button", { name: "Rattacher le dépôt" }));
  return form.findByRole("alert");
}

afterEach(() => vi.unstubAllGlobals());

describe("réinitialiser le rattachement (plan 0034)", () => {
  it.each([
    ["origin_conflict", "Adresse origin différente"],
    ["remote_partial", "Rattachement interrompu"],
    ["attach_incomplete", "Dépôt publié, rattachement à terminer"],
  ])("[S-0034-01] %s propose « Réinitialiser le rattachement », bouton secondaire", async (code, title) => {
    server(() => refusal(code), () => done(false));
    render(<Screen />);
    const form = await attachment();
    const alert = await fail(form);
    expect(alert).toHaveTextContent(title);
    const button = within(alert).getByRole("button", { name: RESET });
    expect(button).toHaveClass("btn-secondary");
    expect(button).toBeEnabled();
  });

  it.each(["remote_not_empty", "remote_not_found", "remote_not_writable", "invalid_remote", "push_failed", "host_unreachable", "workspace_dirty", "wrong_branch"])(
    "[S-0034-01] %s ne propose pas la réinitialisation : il n'y a rien à défaire",
    async (code) => {
      server(() => refusal(code), () => done(false));
      render(<Screen />);
      const form = await attachment();
      await fail(form);
      expect(form.queryByRole("button", { name: RESET })).toBeNull();
    },
  );

  it("[S-0034-02] demande une confirmation explicite, sans rien envoyer avant ; Annuler et Échap la ferment et rendent le focus", async () => {
    const fake = server(() => refusal("origin_conflict"), () => done(false));
    render(<Screen />);
    const form = await attachment();
    await fail(form);
    const trigger = form.getByRole("button", { name: RESET });
    await userEvent.click(trigger);

    const dialog = await screen.findByRole("alertdialog", { name: "Réinitialiser le rattachement ?" });
    expect(dialog).toHaveAccessibleDescription(/Seule la copie locale de l'espace est réinitialisée/);
    expect(dialog).toHaveTextContent("Le dépôt distant n'est pas modifié");
    expect(dialog).toHaveTextContent("il faudra peut-être le vider avant de le réutiliser");
    expect(dialog).toHaveTextContent("sans perdre aucun de vos commits");
    const cancel = within(dialog).getByRole("button", { name: "Annuler" });
    expect(cancel).toHaveFocus(); // le choix sans effet reçoit le focus
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(within(dialog).getByRole("button", { name: "Confirmer la réinitialisation" })).toHaveClass("btn-danger");
    // Le reste du groupe est inerte tant que la confirmation est ouverte.
    expect(form.getByLabelText(/^Adresse du dépôt vide/)).toBeDisabled();
    expect(form.getByRole("button", { name: "Rattacher le dépôt" })).toBeDisabled();
    // Tab reste dans la confirmation : Annuler, puis Confirmer.
    await userEvent.tab();
    expect(within(dialog).getByRole("button", { name: "Confirmer la réinitialisation" })).toHaveFocus();

    await userEvent.click(cancel);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(trigger).toHaveFocus(); // rendu au bouton qui l'avait ouverte
    expect(form.getByLabelText(/^Adresse du dépôt vide/)).toHaveValue("/depots/x.git");

    await userEvent.click(trigger);
    await screen.findByRole("alertdialog");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(trigger).toHaveFocus();
    expect(fake.calls.some((c) => c.path === `${API}/remote/reset`)).toBe(false);
  });

  it("[S-0034-03] une fois confirmée : état « Pas encore de dépôt distant », champ vide et focalisé, message court, nouveau rattachement possible", async () => {
    let attempts = 0;
    const fake = server(
      () => (++attempts === 1 ? refusal("origin_conflict") : { json: { ...local, git_remote: "/depots/autre.git", account: "anna.k" } }),
      () => done(false),
    );
    render(<Screen />);
    const form = await attachment();
    await fail(form);
    await userEvent.click(form.getByRole("button", { name: RESET }));
    await userEvent.click(await screen.findByRole("button", { name: "Confirmer la réinitialisation" }));

    const notice = await form.findByText("Rattachement réinitialisé. Seule la copie locale a changé : le dépôt distant n'a pas été modifié.");
    expect(notice).toHaveAttribute("role", "status");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(form.queryByRole("alert")).toBeNull();
    expect(form.queryByRole("button", { name: RESET })).toBeNull();
    expect(within(await repository()).getByText("Pas encore de dépôt distant")).toBeInTheDocument();
    const field = form.getByLabelText(/^Adresse du dépôt vide/);
    expect(field).toHaveValue("");
    await waitFor(() => expect(field).toHaveFocus());
    expect(fake.calls.filter((c) => c.path === `${API}/remote/reset`)).toEqual([expect.objectContaining({ method: "POST" })]);

    await userEvent.type(field, "/depots/autre.git{Enter}");
    expect(await within(await repository()).findByText(/Dépôt rattaché : l'espace est publié sur \/depots\/autre\.git/)).toBeInTheDocument();
    expect(fake.calls.filter((c) => c.path === `${API}/remote`).at(-1)?.body).toEqual({ remote_url: "/depots/autre.git" });
  });

  it("[S-0034-03] « rien à faire » est un succès, dit comme tel", async () => {
    server(() => refusal("origin_conflict"), () => ({ json: { ...local, reset: { status: "nothing_to_do", identity_reverted: false, reverted_account: null } } }));
    render(<Screen />);
    const form = await attachment();
    await fail(form);
    await userEvent.click(form.getByRole("button", { name: RESET }));
    await userEvent.click(await screen.findByRole("button", { name: "Confirmer la réinitialisation" }));
    expect(await form.findByText("Rien à réinitialiser : la copie locale n'avait aucun reste de rattachement.")).toBeInTheDocument();
    expect(form.queryByRole("alert")).toBeNull();
  });

  it("[S-0034-04] le commit d'identité défait : la gouvernance est relue et le brouillon suit, sous le compte local", async () => {
    // Le brouillon a été ouvert après la fusion du commit d'identité : il porte le login GitHub.
    let account = "claire-m";
    const fake = server(
      () => refusal("remote_partial", "L'espace a été publié sous le compte « claire-m »."),
      () => ((account = "anna.k"), done(true)),
      () => account,
    );
    render(<Screen />);
    await userEvent.click(await screen.findByRole("checkbox", { name: "Databricks" }));
    const form = await attachment();
    await fail(form);
    await userEvent.click(form.getByRole("button", { name: RESET }));
    await userEvent.click(await screen.findByRole("button", { name: "Confirmer la réinitialisation" }));

    expect(await screen.findByRole("button", { name: "Modifier Anna K." })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: /^Enregistrer et/ })).toBeDisabled()); // espace local
    expect(await screen.findByRole("checkbox", { name: "Databricks" })).toBeChecked(); // le brouillon a suivi
    expect(fake.calls.filter((c) => c.path === `${API}/admin`)).toHaveLength(2); // relue
    // Le message survit au remontage du formulaire.
    expect(await screen.findByText(/Rattachement réinitialisé\. Seule la copie locale a changé/)).toBeInTheDocument();
    expect(within(await repository()).getByText("Pas encore de dépôt distant")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Adresse du dépôt vide/)).toHaveValue("");
  });

  it("[S-0034-04] « rien à faire » relit aussi la gouvernance : un essai précédent interrompu avait déjà remis le compte local", async () => {
    // L'écran a lu la gouvernance sous le login publié ; le serveur l'a depuis remise au compte local.
    let account = "claire-m";
    const fake = server(
      () => refusal("remote_partial"),
      () => ((account = "anna.k"), done(false)), // identity_reverted: false
      () => account,
    );
    render(<Screen />);
    const form = await attachment();
    await fail(form);
    expect(screen.getByText("claire-m", { selector: ".admin-sub" })).toBeInTheDocument();
    await userEvent.click(form.getByRole("button", { name: RESET }));
    await userEvent.click(await screen.findByRole("button", { name: "Confirmer la réinitialisation" }));

    expect(await screen.findByText("anna.k", { selector: ".admin-sub" })).toBeInTheDocument();
    expect(screen.queryByText("claire-m", { selector: ".admin-sub" })).toBeNull();
    expect(fake.calls.filter((c) => c.path === `${API}/admin`)).toHaveLength(2);
    expect(screen.queryByText(/n'ont pas été reprises/)).toBeNull(); // rien n'était en cours
  });

  it.each([
    ["origin retiré seul", () => done(false)],
    ["rien à faire", () => ({ json: { ...local, reset: { status: "nothing_to_do", identity_reverted: false, reverted_account: null } } })],
  ])("[S-0034-04] %s : sans renommage d'identité, le brouillon est gardé tel quel, sans bannière", async (_, answer) => {
    const fake = server(() => refusal("origin_conflict"), answer);
    render(<Screen />);
    await userEvent.click(await screen.findByRole("checkbox", { name: "Databricks" }));
    await userEvent.clear(screen.getByLabelText("Canonique (min 1)"));
    await userEvent.type(screen.getByLabelText("Canonique (min 1)"), "2");
    const form = await attachment();
    await fail(form);
    await userEvent.click(form.getByRole("button", { name: RESET }));
    await userEvent.click(await screen.findByRole("button", { name: "Confirmer la réinitialisation" }));

    expect(await form.findByText(/Rattachement réinitialisé|Rien à réinitialiser/)).toBeInTheDocument();
    await waitFor(() => expect(fake.calls.filter((c) => c.path === `${API}/admin`)).toHaveLength(2)); // relue
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Databricks" })).toBeEnabled());
    expect(screen.getByRole("checkbox", { name: "Databricks" })).toBeChecked();
    expect(screen.getByLabelText("Canonique (min 1)")).toHaveValue(2);
    expect(screen.queryByText(/n'ont pas été reprises/)).toBeNull();
    // Le brouillon n'est pas gardé en réserve : annuler revient bien à la gouvernance du serveur.
    await userEvent.click(screen.getByRole("button", { name: "Annuler" }));
    expect(screen.getByRole("checkbox", { name: "Databricks" })).not.toBeChecked();
  });

  it("[S-0034-04] sans compte publié connu, un brouillon écrit sur l'ancienne gouvernance n'est pas repris, et le dit", async () => {
    let account = "claire-m";
    server(() => refusal("remote_partial"), () => ((account = "anna.k"), done(false)), () => account);
    render(<Screen />);
    await userEvent.click(await screen.findByRole("checkbox", { name: "Databricks" }));
    const form = await attachment();
    await fail(form);
    await userEvent.click(form.getByRole("button", { name: RESET }));
    await userEvent.click(await screen.findByRole("button", { name: "Confirmer la réinitialisation" }));

    expect(await screen.findByText(/Vos modifications non enregistrées n'ont pas été reprises : la gouvernance du dépôt a changé depuis leur saisie\. Refaites-les/)).toBeInTheDocument();
    expect(await screen.findByText("anna.k", { selector: ".admin-sub" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Databricks" })).not.toBeChecked();
  });

  it("[S-0034-04] un brouillon qui contient déjà le compte local n'est pas repris : rien n'est fusionné, la bannière le dit", async () => {
    let account = "claire-m";
    server(
      () => refusal("remote_partial"),
      () => ((account = "anna.k"), done(true)),
      () => account,
    );
    render(<Screen />);
    // Le compte local est ajouté à la main au brouillon, alors que le serveur le remet sous ses rôles.
    await userEvent.click(await screen.findByRole("button", { name: "Inviter" }));
    const member = within(screen.getByRole("group", { name: "Nouveau membre" }));
    await userEvent.type(member.getByRole("textbox", { name: /Nom/ }), "Anna K.");
    await userEvent.type(member.getByRole("textbox", { name: /Compte/ }), "anna.k");
    await userEvent.selectOptions(member.getByRole("combobox", { name: "Entité" }), "perrault-fr");
    await userEvent.click(member.getByRole("button", { name: "Ajouter le membre" }));
    const form = await attachment();
    await fail(form);
    await userEvent.click(form.getByRole("button", { name: RESET }));
    await userEvent.click(await screen.findByRole("button", { name: "Confirmer la réinitialisation" }));

    expect(await screen.findByText(/Vos modifications non enregistrées n'ont pas été reprises : le compte anna\.k figurait déjà dans le brouillon\. Refaites-les à partir de la gouvernance du dépôt\./)).toBeInTheDocument();
    // La gouvernance du serveur : un seul membre, le créateur restauré avec son rôle de référent.
    const members = within(await screen.findByRole("table", { name: "Utilisateurs et rôles" }));
    await waitFor(() => expect(members.getAllByRole("row")).toHaveLength(2)); // en-tête + créateur
    expect(members.getByText("anna.k", { selector: ".admin-sub" })).toBeInTheDocument();
    expect(members.queryByText("claire-m", { selector: ".admin-sub" })).toBeNull();
    expect(screen.getByRole("button", { name: /^Enregistrer et/ })).toBeDisabled(); // espace local, rien en cours
  });

  it("[S-0034-05] un refus de la réinitialisation dit pourquoi, garde la confirmation ouverte, et un nouvel essai passe", async () => {
    let attempts = 0;
    server(
      () => refusal("origin_conflict"),
      () => (++attempts === 1
        ? refusal("workspace_dirty", "« governance.yaml » a des modifications non enregistrées dans le clone de l'espace : les enregistrer ou les annuler, puis réinitialiser le rattachement.")
        : done(false)),
    );
    render(<Screen />);
    const form = await attachment();
    await fail(form);
    await userEvent.click(form.getByRole("button", { name: RESET }));
    await userEvent.click(await screen.findByRole("button", { name: "Confirmer la réinitialisation" }));

    const dialog = within(await screen.findByRole("alertdialog"));
    expect(await dialog.findByRole("alert")).toHaveTextContent(/La réinitialisation n'a pas abouti.*puis réinitialiser le rattachement/);
    expect(dialog.getByRole("button", { name: "Confirmer la réinitialisation" })).toBeEnabled();
    expect(form.getByText(/Adresse origin différente/)).toBeInTheDocument(); // l'erreur d'origine reste

    await userEvent.click(dialog.getByRole("button", { name: "Confirmer la réinitialisation" }));
    expect(await form.findByText(/Rattachement réinitialisé/)).toBeInTheDocument();
  });

  it.each([
    ["remote_exists", "Cet espace est rattaché à son dépôt distant : Atlas ne le détache pas."],
    ["reset_incomplete", "La réinitialisation n'a pas pu aller au bout (étape : références distantes)."],
  ])("[S-0034-05] %s : message du serveur ou traduit, jamais de sortie de git", async (code, message) => {
    server(() => refusal("origin_conflict"), () => refusal(code, `${message} fatal: gho_SECRET`));
    render(<Screen />);
    const form = await attachment();
    await fail(form);
    await userEvent.click(form.getByRole("button", { name: RESET }));
    await userEvent.click(await screen.findByRole("button", { name: "Confirmer la réinitialisation" }));
    const dialog = within(await screen.findByRole("alertdialog"));
    const alert = await dialog.findByRole("alert");
    if (code === "reset_incomplete") expect(alert).toHaveTextContent("Relancez la réinitialisation");
    else expect(alert).toHaveTextContent("Atlas ne le détache pas");
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("[S-0034-06] gèle le reste du formulaire pendant la requête, comme le rattachement", async () => {
    let release: (value: { json: unknown }) => void = () => undefined;
    const slow = new Promise<{ json: unknown }>((resolve) => (release = resolve));
    server(() => refusal("origin_conflict"), () => slow as never);
    render(<Screen />);
    await userEvent.click(await screen.findByRole("checkbox", { name: "Databricks" }));
    const form = await attachment();
    await fail(form);
    await userEvent.click(form.getByRole("button", { name: RESET }));
    await userEvent.click(await screen.findByRole("button", { name: "Confirmer la réinitialisation" }));

    expect(await screen.findByText("Réinitialisation de la copie locale…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmer la réinitialisation" })).toBeDisabled();
    expect(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Annuler" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Databricks" })).toBeDisabled();
    release(done(false));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Databricks" })).toBeEnabled());
  });

  it("[S-0034-06] est suspendue tant qu'une modification de membre est ouverte", async () => {
    server(() => refusal("origin_conflict"), () => done(false));
    render(<Screen />);
    const form = await attachment();
    await fail(form);
    expect(form.getByRole("button", { name: RESET })).toBeEnabled();
    await userEvent.click(await screen.findByRole("button", { name: "Modifier Anna K." }));
    expect(form.getByRole("button", { name: RESET })).toBeDisabled();
    await userEvent.click(within(screen.getByRole("group", { name: "Membre Anna K." })).getByRole("button", { name: "Annuler" }));
    expect(form.getByRole("button", { name: RESET })).toBeEnabled();
  });
});

describe("réinitialiser depuis le panneau de création (plan 0034)", () => {
  it("[S-0034-07] la confirmation se ferme avec Échap sans fermer le panneau, et la réinitialisation vide le champ", async () => {
    const onClose = vi.fn();
    const fake = fakeServer(({ method, path }) => {
      if (path === "/api/workspaces" && method === "POST") return { status: 201, json: workspace({ id: "acme", git_remote: "" }) };
      if (path === "/api/workspaces/acme/remote") {
        return refusal("origin_conflict", "Le clone de l'espace a déjà un « origin » qui diffère.");
      }
      if (path === "/api/workspaces/acme/remote/reset") return { json: { ...workspace({ id: "acme", git_remote: "" }), reset: { status: "reset", identity_reverted: false, reverted_account: null } } };
      return undefined;
    });
    render(<CreateWorkspace onClose={onClose} onCreated={vi.fn()} />);
    const dialog = within(screen.getByRole("dialog", { name: "Créer un espace" }));
    await userEvent.type(dialog.getByLabelText(/^Nom/), "Acme");
    await userEvent.type(dialog.getByLabelText("Dépôt distant"), "/depots/acme.git");
    await userEvent.click(dialog.getByRole("button", { name: "Créer l'espace" }));
    expect(await dialog.findByText("Espace créé, dépôt distant non rattaché")).toBeInTheDocument();
    // Le refus est détaillé une fois, dans le groupe, avec la réinitialisation qui le défait.
    expect(dialog.getAllByText(/Le clone de l'espace a déjà un « origin » qui diffère/)).toHaveLength(1);

    const trigger = await dialog.findByRole("button", { name: RESET });
    await userEvent.click(trigger);
    await dialog.findByRole("alertdialog");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(onClose).not.toHaveBeenCalled(); // Échap n'a fermé que la confirmation
    expect(trigger).toHaveFocus();

    await userEvent.click(trigger);
    await userEvent.click(await dialog.findByRole("button", { name: "Confirmer la réinitialisation" }));
    expect(await dialog.findByText(/Rattachement réinitialisé\./)).toBeInTheDocument();
    expect(dialog.getByLabelText(/^Adresse du dépôt vide/)).toHaveValue("");
    expect(dialog.getByText(/Le rattachement a été réinitialisé\./)).toBeInTheDocument(); // plus l'ancienne erreur
    expect(dialog.queryByText(/origin » qui diffère/)).toBeNull();
    expect(fake.calls.filter((c) => c.path === "/api/workspaces/acme/remote/reset")).toHaveLength(1);
  });
});


describe("réinitialiser depuis la coque d'un espace rouvert (plan 0034)", () => {
  const reader = workspace({ id: "maison-perrault", name: "Maison Perrault", git_remote: "", account: "anna.k", role: "lecteur", role_label: "Lecteur", space_referent: false, attachment: "interrupted" });
  const restored = workspace({ id: "maison-perrault", name: "Maison Perrault", git_remote: "", account: "anna.k", attachment: null });

  function shell(initial = reader, view: "catalogue" | "administration" = "catalogue") {
    const fake = fakeServer((call) => {
      if (call.path === API) return { json: initial };
      if (call.path === `${API}/remote/reset`) {
        return { json: { ...restored, reset: { status: "reset", identity_reverted: true, reverted_account: "claire-m" } } };
      }
      return undefined;
    });
    render(<WorkspaceShell wsId="maison-perrault" view={view} onUnknown={() => undefined} />);
    return fake;
  }

  it("[S-0034-10] un lecteur rouvre l'espace à moitié rattaché : la bannière se voit sans Administration, la réinitialisation la retire et rend le rôle", async () => {
    const fake = shell();
    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent("Le rattachement de cet espace à un dépôt a été interrompu.");
    expect(screen.queryByRole("link", { name: "Administration" })).toBeNull(); // le rôle ne la montre pas
    expect(screen.queryByRole("link", { name: "Reprendre le rattachement" })).toBeNull();
    const trigger = within(banner).getByRole("button", { name: RESET });

    // Même confirmation que le formulaire : Annuler est focalisé, Échap rend le focus au bouton.
    await userEvent.click(trigger);
    const dialog = screen.getByRole("alertdialog", { name: "Réinitialiser le rattachement ?" });
    expect(dialog).toHaveTextContent("Le dépôt distant n'est pas modifié");
    expect(within(dialog).getByRole("button", { name: "Annuler" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(trigger).toHaveFocus();
    expect(fake.calls.some((c) => c.path.endsWith("/remote/reset"))).toBe(false);

    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole("button", { name: "Confirmer la réinitialisation" }));

    expect(await screen.findByText(/Rattachement réinitialisé\. Seule la copie locale a changé/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/a été interrompu/)).toBeNull());
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(await screen.findByRole("link", { name: "Administration" })).toBeInTheDocument(); // le rôle est revenu
    expect(screen.getByText("Référent d'annuaire")).toBeInTheDocument();
  });

  it("[S-0034-10] un référent voit aussi le lien vers l'Administration, sauf sur l'Administration elle-même ; rien sans reste", async () => {
    shell(workspace({ ...reader, space_referent: true, role: "referent", role_label: "Référent d'annuaire" }));
    const link = await screen.findByRole("link", { name: "Reprendre le rattachement" });
    expect(link).toHaveAttribute("href", "#/w/maison-perrault/administration");
  });

  it("[S-0034-10] sans reste de rattachement, aucune bannière", async () => {
    shell(restored);
    await screen.findByText("Maison Perrault", { selector: ".switcher-name" });
    expect(screen.queryByText(/a été interrompu/)).toBeNull();
  });
});

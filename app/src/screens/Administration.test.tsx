import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminState, Governance } from "../api";
import { fakeServer, workspace, type Call } from "../test/fakeServer";
import { Administration, domainReferents, mainRole, withoutDomain, withoutMember } from "./Administration";

const API = "/api/workspaces/groupe-nordis";

// La gouvernance de examples/espace-nordis, telle que le serveur la rend.
const GOVERNANCE: Governance = {
  schema_version: 1,
  validators_required: { canonical: 2, variants: 1 },
  domains: [
    { id: "finance", label: "Finance", referents: ["claire.m"], validators: ["claire.m", "marc.d"], validators_required: null },
    { id: "ventes", label: "Ventes", referents: ["marc.d"], validators: ["marc.d"], validators_required: null },
    { id: "supply", label: "Supply chain", referents: ["sami.b"], validators: ["sami.b"], validators_required: { canonical: 1, variants: 1 } },
    { id: "marketing", label: "Marketing", referents: [], validators: [], validators_required: null },
  ],
  members: [
    { account: "julien.h", name: "Julien H.", entity: "groupe", roles: [{ role: "referent", domains: [] }] },
    { account: "claire.m", name: "Claire M.", entity: "nordis-fr", roles: [{ role: "referent", domains: ["finance"] }] },
    { account: "marc.d", name: "Marc D.", entity: "groupe", roles: [{ role: "validateur", domains: ["finance", "ventes"] }] },
    { account: "sami.b", name: "Sami B.", entity: "groupe", roles: [{ role: "referent", domains: ["supply"] }] },
    { account: "anna.k", name: "Anna K.", entity: "nordis-de", roles: [{ role: "contributeur", domains: [] }] },
  ],
  allowed_platforms: ["databricks", "snowflake"],
  tolerance: { percent: 1 },
};

function state(overrides: Partial<AdminState> = {}): AdminState {
  return {
    governance: structuredClone(GOVERNANCE),
    base_digest: "d1",
    warnings: ["Marketing"],
    space_referents: ["julien.h"],
    single_referent: true,
    kpi_counts: { finance: 18, ventes: 14, supply: 7, marketing: 3 },
    document_counts: { finance: 21, ventes: 14, supply: 7 },
    platforms: [
      { id: "databricks", label: "Databricks", auth: "OAuth · token personnel", supported: true },
      { id: "snowflake", label: "Snowflake", auth: "SSO · paire de clés", supported: false },
      { id: "bigquery", label: "BigQuery", auth: "OAuth Google", supported: false },
      { id: "fabric", label: "Microsoft Fabric", auth: "Entra ID", supported: false },
      { id: "redshift", label: "Redshift", auth: "IAM", supported: false },
    ],
    repository: { url: "git@github.com:nordis/skifer-atlas.git", main_branch: "main", synced_at: "2026-10-31T08:00:00+00:00", index_fresh: false },
    ...overrides,
  };
}

type Handler = (call: Call) => { status?: number; json?: unknown } | undefined;

function server(admin: AdminState | (() => AdminState) = state(), extra: Handler = () => undefined) {
  return fakeServer((call) => {
    const found = extra(call);
    if (found) return found;
    if (call.path === `${API}/admin`) return { json: typeof admin === "function" ? admin() : admin };
    if (call.path === `${API}/admin/governance` && call.method === "POST") return { status: 201, json: { id: 12, title: "Gouvernance de l'espace", merged: true, mention: "Fusionnée sans revue : aucun autre compte habilité", changes: [] } };
    return undefined;
  });
}

const saves = (calls: Call[]) => calls.filter((c) => c.path === `${API}/admin/governance`);
const savedGovernance = (calls: Call[]) => (saves(calls).at(-1)?.body as { governance: Governance; base_digest: string }).governance;
const domains = () => within(screen.getByRole("region", { name: "Domaines métier" }));
const saveButton = () => screen.getByRole("button", { name: /^Enregistrer et/ });

function screenFor() {
  return <Administration ws={workspace()} heading={createRef()} />;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("règles", () => {
  it("référents d'un domaine et rôle principal, comme le serveur", () => {
    expect(domainReferents(GOVERNANCE, "finance")).toEqual(["claire.m"]);
    expect(domainReferents(GOVERNANCE, "marketing")).toEqual([]);
    expect(mainRole(GOVERNANCE, GOVERNANCE.members[2])).toBe("referent"); // référent de Ventes par le domaine
    expect(mainRole(GOVERNANCE, GOVERNANCE.members[4])).toBe("contributeur");
  });

  it("retirer un membre ou un domaine ne laisse aucune référence, et n'élargit aucun rôle (plan 0023)", () => {
    const noMarc = withoutMember(GOVERNANCE, "marc.d");
    expect(noMarc.members.map((m) => m.account)).not.toContain("marc.d");
    expect(noMarc.domains.find((d) => d.id === "finance")?.validators).toEqual(["claire.m"]);
    expect(noMarc.domains.find((d) => d.id === "ventes")).toMatchObject({ referents: [], validators: [] });
    const noFinance = withoutDomain(GOVERNANCE, "finance");
    expect(noFinance.domains.map((d) => d.id)).toEqual(["ventes", "supply", "marketing"]);
    // Claire n'était référente que de Finance : lectrice, et non référente de tout l'espace.
    expect(noFinance.members[1].roles).toEqual([{ role: "lecteur", domains: [] }]);
    expect(noFinance.members[2].roles).toEqual([{ role: "validateur", domains: ["ventes"] }]);
  });
});

describe("administration", () => {
  it("sections de la maquette, référent seul, aucun champ de token (critères 6 et 8)", async () => {
    server();
    render(screenFor());
    expect(await screen.findByRole("heading", { level: 1, name: "Administration — Groupe Nordis" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Vous êtes le seul référent de l'espace");
    expect(screen.getByRole("alert")).toHaveTextContent("Fusionnée sans revue : aucun autre compte habilité");

    expect(domains().getByText("Finance").parentElement).toHaveTextContent("Référent Claire M. · 2 validateurs · 18 KPI");
    expect(domains().getByText("Aucun référent · 3 KPI")).toHaveClass("tone-warn");
    expect(screen.getByRole("spinbutton", { name: "Canonique (min 1)" })).toHaveValue(2);
    expect(screen.getByRole("spinbutton", { name: "Déclinaisons (min 1)" })).toHaveValue(1);
    expect(within(screen.getByRole("region", { name: "Validateurs requis" })).getByText("canonique 1 · déclinaisons 1")).toBeInTheDocument();

    const members = screen.getByRole("table", { name: "Utilisateurs et rôles" });
    expect(within(members).getByRole("row", { name: /Marc D\./ })).toHaveTextContent("Référent");
    expect(within(members).getByRole("row", { name: /Marc D\./ })).toHaveTextContent("Finance, Ventes");
    expect(within(members).getByRole("row", { name: /Anna K\./ })).toHaveTextContent("nordis-deContributeurTout l'espace");

    const repository = within(screen.getByRole("region", { name: "Dépôt Git de l'espace" }));
    expect(repository.getByText("git@github.com:nordis/skifer-atlas.git")).toHaveClass("mono");
    expect(repository.getByText(/index à reconstruire/)).toBeInTheDocument();
    expect(repository.queryByText(/Require review from Code Owners/)).not.toBeInTheDocument();

    expect(screen.getByRole("checkbox", { name: "Databricks" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "BigQuery" })).not.toBeChecked();
    expect(saveButton()).toHaveTextContent("Enregistrer et fusionner");
    expect(saveButton()).toBeDisabled();
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(screen.queryByLabelText(/token/i)).not.toBeInTheDocument();
  });

  it("nouveau domaine sans référent : l'alerte, puis l'enregistrement fusionné (critères 2 et 8)", async () => {
    let current = state();
    const api = server(() => current, ({ path, method }) => {
      if (path === `${API}/admin/governance` && method === "POST") {
        current = state({ base_digest: "d2", governance: { ...GOVERNANCE, domains: [...GOVERNANCE.domains, { id: "data", label: "Data", referents: [], validators: [], validators_required: null }] } });
        return { status: 201, json: { id: 12, title: "Gouvernance de l'espace", merged: true, mention: "Fusionnée sans revue : aucun autre compte habilité", changes: ["Domaine « Data » ajouté."] } };
      }
      return undefined;
    });
    render(screenFor());
    await userEvent.click(await screen.findByRole("button", { name: "Domaine" }));
    const form = within(screen.getByRole("group", { name: "Nouveau domaine" }));
    await userEvent.type(form.getByRole("textbox", { name: /Libellé/ }), "Data");
    expect(form.getByRole("textbox", { name: /Identifiant/ })).toHaveValue("data");
    await userEvent.click(form.getByRole("button", { name: "Ajouter le domaine" }));
    expect(domains().getAllByText(/Aucun référent/)).toHaveLength(2);

    await userEvent.click(saveButton());
    expect(await screen.findByText(/Paramètres enregistrés : proposition n° 12 fusionnée sans revue\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Voir la proposition" })).toHaveAttribute("href", "#/w/groupe-nordis/propositions?n=12&status=merged&domain=tous");
    expect(saves(api.calls)[0].body).toMatchObject({ base_digest: "d1" });
    expect(savedGovernance(api.calls).domains.at(-1)).toEqual({ id: "data", label: "Data", referents: [], validators: [], validators_required: null });
    await waitFor(() => expect(api.calls.filter((c) => c.path === `${API}/admin`)).toHaveLength(2));
  });

  it("un identifiant de domaine déjà pris est refusé", async () => {
    server();
    render(screenFor());
    await userEvent.click(await screen.findByRole("button", { name: "Domaine" }));
    const form = within(screen.getByRole("group", { name: "Nouveau domaine" }));
    await userEvent.type(form.getByRole("textbox", { name: /Libellé/ }), "Finance");
    await userEvent.click(form.getByRole("button", { name: "Ajouter le domaine" }));
    expect(form.getByText("Un domaine porte déjà cet identifiant.")).toBeInTheDocument();
  });

  it("validateurs à 0 refusés, sur l'espace comme sur un domaine (critère 3)", async () => {
    server();
    render(screenFor());
    const canonical = await screen.findByRole("spinbutton", { name: "Canonique (min 1)" });
    await userEvent.clear(canonical);
    await userEvent.type(canonical, "0");
    expect(screen.getByText("Au moins 1.")).toBeInTheDocument();
    expect(canonical).toHaveAttribute("aria-invalid", "true");
    expect(saveButton()).toBeDisabled();
    await userEvent.clear(canonical);
    await userEvent.type(canonical, "3");
    expect(saveButton()).toBeEnabled();

    await userEvent.click(screen.getByRole("button", { name: "Annuler" }));
    expect(canonical).toHaveValue(2);
    await userEvent.click(domains().getByRole("button", { name: "Modifier le domaine Ventes" }));
    const form = within(screen.getByRole("group", { name: "Domaine Ventes" }));
    await userEvent.click(form.getByRole("checkbox", { name: "Nombre de validateurs propre au domaine" }));
    const override = form.getByRole("spinbutton", { name: "Déclinaisons (min 1)" });
    await userEvent.clear(override);
    await userEvent.type(override, "0");
    await userEvent.click(form.getByRole("button", { name: "Appliquer" }));
    expect(form.getByText("Au moins 1.")).toBeInTheDocument();
  });

  it("renommer un domaine ne change que son libellé (critère 5)", async () => {
    const api = server();
    render(screenFor());
    await userEvent.click(await screen.findByRole("button", { name: "Modifier le domaine Supply chain" }));
    const form = within(screen.getByRole("group", { name: "Domaine Supply chain" }));
    expect(form.queryByRole("textbox", { name: /Identifiant/ })).not.toBeInTheDocument();
    const label = form.getByRole("textbox", { name: /Libellé/ });
    await userEvent.clear(label);
    await userEvent.type(label, "Supply");
    await userEvent.click(form.getByRole("button", { name: "Appliquer" }));
    expect(domains().getByText("Supply")).toBeInTheDocument();
    await userEvent.click(saveButton());
    await screen.findByText(/proposition n° 12/);

    const expected = structuredClone(GOVERNANCE);
    expected.domains[2].label = "Supply";
    expect(savedGovernance(api.calls)).toEqual(expected);
  });

  it("inviter un membre et lui donner un domaine", async () => {
    const api = server();
    render(screenFor());
    await userEvent.click(await screen.findByRole("button", { name: "Inviter" }));
    const form = within(screen.getByRole("group", { name: "Nouveau membre" }));
    await userEvent.type(form.getByRole("textbox", { name: /Nom/ }), "Léa B.");
    await userEvent.type(form.getByRole("textbox", { name: /Compte/ }), "lea b");
    await userEvent.click(form.getByRole("button", { name: "Ajouter le membre" }));
    expect(form.getByText(/Le compte de la personne sur l'hébergeur/)).toBeInTheDocument();
    await userEvent.clear(form.getByRole("textbox", { name: /Compte/ }));
    await userEvent.type(form.getByRole("textbox", { name: /Compte/ }), "lea.b");
    await userEvent.selectOptions(form.getByRole("combobox", { name: "Entité" }), "nordis-fr");
    await userEvent.selectOptions(form.getByRole("combobox", { name: "Rôle" }), "validateur");
    await userEvent.click(form.getByRole("checkbox", { name: "Ventes" }));
    expect(form.getByText(/l'accès au dépôt se donne sur l'hébergeur/)).toBeInTheDocument();
    await userEvent.click(form.getByRole("button", { name: "Ajouter le membre" }));

    const row = within(screen.getByRole("table", { name: "Utilisateurs et rôles" })).getByRole("row", { name: /Léa B\./ });
    expect(row).toHaveTextContent("nordis-frValidateurVentes");
    await userEvent.click(saveButton());
    await screen.findByText(/proposition n° 12/);
    expect(savedGovernance(api.calls).members.at(-1)).toEqual({
      account: "lea.b",
      name: "Léa B.",
      entity: "nordis-fr",
      roles: [{ role: "validateur", domains: ["ventes"] }],
    });
  });

  it("retirer un membre, mais jamais le dernier référent de l'espace (plan 0023)", async () => {
    const api = server();
    render(screenFor());
    await userEvent.click(await screen.findByRole("button", { name: "Modifier Julien H." }));
    let form = within(screen.getByRole("group", { name: "Membre Julien H." }));
    expect(form.getByRole("button", { name: "Retirer de l'espace" })).toBeDisabled();
    expect(form.getByText(/Seul référent de l'espace/)).toBeInTheDocument();
    await userEvent.click(form.getByRole("button", { name: "Annuler" }));

    await userEvent.click(screen.getByRole("button", { name: "Modifier Marc D." }));
    form = within(screen.getByRole("group", { name: "Membre Marc D." }));
    expect(form.getByText(/L'accès au dépôt se retire sur l'hébergeur/)).toBeInTheDocument();
    await userEvent.click(form.getByRole("button", { name: "Retirer de l'espace" }));
    expect(within(screen.getByRole("table", { name: "Utilisateurs et rôles" })).queryByRole("row", { name: /Marc D\./ })).toBeNull();
    await userEvent.click(saveButton());
    await screen.findByText(/proposition n° 12/);
    const saved = savedGovernance(api.calls);
    expect(saved.members.map((m) => m.account)).not.toContain("marc.d");
    expect(saved.domains[0].validators).toEqual(["claire.m"]);
  });

  it("retirer un domaine sans document ; un domaine qui en porte reste (plan 0023)", async () => {
    const api = server();
    render(screenFor());
    await userEvent.click(await screen.findByRole("button", { name: "Modifier le domaine Supply chain" }));
    let form = within(screen.getByRole("group", { name: "Domaine Supply chain" }));
    expect(form.getByRole("button", { name: "Retirer le domaine" })).toBeDisabled();
    expect(form.getByText(/7 documents rattachés : les rattacher à un autre domaine/)).toBeInTheDocument();
    await userEvent.click(form.getByRole("button", { name: "Annuler" }));

    await userEvent.click(domains().getByRole("button", { name: "Modifier le domaine Marketing" }));
    form = within(screen.getByRole("group", { name: "Domaine Marketing" }));
    expect(form.getByText(/Les rôles limités à ce domaine sont retirés/)).toBeInTheDocument();
    await userEvent.click(form.getByRole("button", { name: "Retirer le domaine" }));
    expect(domains().queryByText("Marketing")).toBeNull();
    await userEvent.click(saveButton());
    await screen.findByText(/proposition n° 12/);
    expect(savedGovernance(api.calls).domains.map((d) => d.id)).toEqual(["finance", "ventes", "supply"]);
  });

  it("donner plusieurs rôles à un membre (plan 0023)", async () => {
    const api = server();
    render(screenFor());
    await userEvent.click(await screen.findByRole("button", { name: "Modifier Anna K." }));
    const form = within(screen.getByRole("group", { name: "Membre Anna K." }));
    await userEvent.click(form.getByRole("button", { name: "+ Ajouter un rôle" }));
    const second = within(form.getByRole("group", { name: "Rôle 2" }));
    await userEvent.selectOptions(second.getByRole("combobox", { name: "Rôle 2" }), "contributeur");
    await userEvent.click(form.getByRole("button", { name: "Appliquer" }));
    expect(second.getByText("Ce rôle figure déjà : regroupez ses domaines.")).toBeInTheDocument();
    await userEvent.selectOptions(second.getByRole("combobox", { name: "Rôle 2" }), "referent");
    await userEvent.click(second.getByRole("checkbox", { name: "Ventes" }));
    await userEvent.click(form.getByRole("button", { name: "Appliquer" }));
    const row = within(screen.getByRole("table", { name: "Utilisateurs et rôles" })).getByRole("row", { name: /Anna K\./ });
    expect(row).toHaveTextContent("Référent");
    await userEvent.click(saveButton());
    await screen.findByText(/proposition n° 12/);
    expect(savedGovernance(api.calls).members[4].roles).toEqual([
      { role: "contributeur", domains: [] },
      { role: "referent", domains: ["ventes"] },
    ]);
  });

  it("plateformes autorisées : une case retire la plateforme", async () => {
    const api = server();
    render(screenFor());
    await userEvent.click(await screen.findByRole("checkbox", { name: "Snowflake" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "BigQuery" }));
    await userEvent.click(saveButton());
    await screen.findByText(/proposition n° 12/);
    expect(savedGovernance(api.calls).allowed_platforms).toEqual(["databricks", "bigquery"]);
  });

  it("Synchroniser met à jour la date et réindexe (critère 7)", async () => {
    const api = server(state(), ({ path }) => {
      if (path === `${API}/sync`) return { json: { status: "fast_forward", commit: "c2", warnings: [], reindexed: true, synced_at: new Date().toISOString() } };
      return undefined;
    });
    render(screenFor());
    const repository = within(await screen.findByRole("region", { name: "Dépôt Git de l'espace" }));
    await userEvent.click(repository.getByRole("button", { name: "Synchroniser" }));
    expect(await repository.findByText("Synchronisé · index reconstruit.")).toBeInTheDocument();
    expect(repository.getByText("à l'instant · index à jour")).toHaveClass("tone-ok");
    expect(api.calls.some((c) => c.method === "POST" && c.path === `${API}/sync`)).toBe(true);
  });

  it("deux référents : proposition à relire, rappel Code Owners, sans bandeau (critère 8)", async () => {
    const two = structuredClone(GOVERNANCE);
    two.members[1].roles = [{ role: "referent", domains: [] }];
    server(state({ governance: two, single_referent: false, space_referents: ["claire.m", "julien.h"] }), ({ path, method }) => {
      if (path === `${API}/admin/governance` && method === "POST") return { status: 201, json: { id: 13, title: "Gouvernance de l'espace", merged: false, mention: null, changes: [] } };
      return undefined;
    });
    render(screenFor());
    await screen.findByRole("heading", { level: 1 });
    expect(await screen.findByText(/Require review from Code Owners/)).toBeInTheDocument();
    expect(screen.queryByText("Vous êtes le seul référent de l'espace")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: "Redshift" }));
    expect(saveButton()).toHaveTextContent("Enregistrer et créer la proposition");
    await userEvent.click(saveButton());
    expect(await screen.findByText(/Proposition n° 13 ouverte : elle attend la revue d'un autre référent\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Voir la proposition" })).toHaveAttribute("href", "#/w/groupe-nordis/propositions?n=13&status=open&domain=tous");
    expect(saveButton()).toBeDisabled(); // pas de doublon tant que rien ne change
  });

  it("gouvernance changée entre-temps : message et relecture", async () => {
    const api = server(state(), ({ path, method }) => {
      if (path === `${API}/admin/governance` && method === "POST") return { status: 409, json: { detail: { code: "stale_base", message: "governance.yaml a changé sur la branche principale depuis son ouverture : recharger les paramètres." } } };
      return undefined;
    });
    render(screenFor());
    await userEvent.click(await screen.findByRole("checkbox", { name: "Redshift" }));
    await userEvent.click(saveButton());
    expect(await screen.findByText(/a changé sur la branche principale/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Relire les paramètres" }));
    await waitFor(() => expect(api.calls.filter((c) => c.path === `${API}/admin`)).toHaveLength(2));
  });

  it("un compte qui n'est pas référent de l'espace reçoit un refus (critère 1)", async () => {
    server(state(), ({ path }) => (path === `${API}/admin` ? { status: 403, json: { detail: { code: "forbidden", message: "L'administration est réservée aux référents de l'espace." } } } : undefined));
    render(screenFor());
    expect(await screen.findByText("Réservée aux référents de l'espace")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Enregistrer/ })).not.toBeInTheDocument();
  });
});

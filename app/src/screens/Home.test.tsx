import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ALTAVIA, fakeServer, workspace } from "../test/fakeServer";
import { Home } from "./Home";

afterEach(() => vi.unstubAllGlobals());

const home = () => render(<Home notice={null} onDismissNotice={() => {}} />);

describe("accueil des espaces", () => {
  it("affiche une carte par espace, conforme à la maquette (critère 1)", async () => {
    const server = fakeServer(({ path }) => (path === "/api/workspaces" ? { json: [workspace(), ALTAVIA] } : undefined));
    home();
    const cards = await screen.findAllByRole("link");
    expect(cards).toHaveLength(2);

    const nordis = within(cards[0]);
    expect(cards[0]).toHaveAttribute("href", "#/w/groupe-nordis/catalogue");
    expect(nordis.getByText("GN")).toBeInTheDocument();
    expect(nordis.getByText("Référent d'annuaire")).toHaveClass("role-referent");
    expect(nordis.getByText("Groupe Nordis")).toBeInTheDocument();
    expect(nordis.getByText("Retail · 3 entités · 4 domaines")).toBeInTheDocument();
    expect(nordis.getByText("42 KPI")).toBeInTheDocument();
    expect(nordis.getByText("18 concepts")).toBeInTheDocument();
    expect(nordis.getByText("5 propositions en attente")).toHaveClass("count-warn");

    const altavia = within(cards[1]);
    expect(altavia.getByText("Contributeur")).toHaveClass("role-contributeur");
    expect(altavia.getByText("Énergie · 5 entités · 2 domaines")).toBeInTheDocument();
    expect(altavia.getByText("1 concept")).toBeInTheDocument();
    expect(altavia.getByText("Aucune proposition")).not.toHaveClass("count-warn");

    expect(screen.getByText("julien.h")).toBeInTheDocument();
    expect(server.calls[0].headers.Authorization).toBe("Bearer jeton");
  });

  it("n'affiche que les compteurs connus", async () => {
    const partial = workspace({ sector: "", counts: { kpi: 3, concept: null, open_proposals: null } });
    fakeServer(({ path }) => (path === "/api/workspaces" ? { json: [partial] } : undefined));
    home();
    const card = within(await screen.findByRole("link"));
    expect(card.getByText("3 entités · 4 domaines")).toBeInTheDocument();
    expect(card.getByText("3 KPI")).toBeInTheDocument();
    expect(card.queryByText(/concept|proposition/)).toBeNull();
  });

  it("affiche la carte vide sans espace (critère 2)", async () => {
    fakeServer(({ path }) => (path === "/api/workspaces" ? { json: [] } : undefined));
    home();
    expect(await screen.findByText("Aucun espace pour l'instant")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Espaces" })).toBeNull();
    expect(screen.getByText(/Ils ne quittent jamais votre poste/)).toBeInTheDocument();
  });

  it("signale une erreur d'API et permet de réessayer", async () => {
    let fail = true;
    fakeServer(({ path }) =>
      path === "/api/workspaces"
        ? fail
          ? { status: 500, json: { detail: { code: "index_failed", message: "Index illisible." } } }
          : { json: [] }
        : undefined,
    );
    home();
    expect(await screen.findByRole("alert")).toHaveTextContent("Index illisible.");
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(await screen.findByText("Aucun espace pour l'instant")).toBeInTheDocument();
  });
});

describe("créer un espace", () => {
  it("dérive l'identifiant, crée l'espace et ouvre son catalogue (critère 3)", async () => {
    const server = fakeServer(({ method, path, body }) => {
      if (path === "/api/workspaces" && method === "GET") return { json: [] };
      if (path === "/api/workspaces" && method === "POST") {
        return { status: 201, json: workspace({ ...(body as object), counts: undefined }) };
      }
      if (path === "/api/workspaces/maison-perrault/remote") return { json: workspace() };
    });
    home();
    await userEvent.click(await screen.findByRole("button", { name: "Créer un espace" }));
    const dialog = within(screen.getByRole("dialog", { name: "Créer un espace" }));
    expect(dialog.getByLabelText(/^Nom/)).toHaveFocus();
    await userEvent.type(dialog.getByLabelText(/^Nom/), "Maison Perrault");
    expect(dialog.getByLabelText(/^Identifiant/)).toHaveValue("maison-perrault");
    await userEvent.type(dialog.getByLabelText("Secteur"), "Luxe");
    await userEvent.type(dialog.getByLabelText("Entités"), "mp-fr, mp-it");
    await userEvent.type(dialog.getByLabelText("Dépôt distant"), "/depots/perrault.git");
    await userEvent.click(dialog.getByRole("button", { name: "Créer l'espace" }));

    await waitFor(() => expect(window.location.hash).toBe("#/w/maison-perrault/catalogue"));
    const posts = server.calls.filter((c) => c.method === "POST");
    expect(posts.map((c) => [c.path, c.body])).toEqual([
      ["/api/workspaces", { id: "maison-perrault", name: "Maison Perrault", sector: "Luxe", entities: ["mp-fr", "mp-it"] }],
      ["/api/workspaces/maison-perrault/remote", { remote_url: "/depots/perrault.git" }],
    ]);
  });

  it("affiche le 409 sous le champ identifiant (critère 3)", async () => {
    fakeServer(({ method, path }) => {
      if (path === "/api/workspaces" && method === "GET") return { json: [workspace()] };
      if (path === "/api/workspaces" && method === "POST") {
        return { status: 409, json: { detail: { code: "workspace_exists", message: "existe" } } };
      }
    });
    home();
    await userEvent.click(await screen.findByRole("button", { name: "Créer un espace" }));
    const dialog = within(screen.getByRole("dialog"));
    await userEvent.type(dialog.getByLabelText(/^Nom/), "Groupe Nordis");
    await userEvent.click(dialog.getByRole("button", { name: "Créer l'espace" }));
    const id = dialog.getByLabelText(/^Identifiant/);
    await waitFor(() => expect(id).toHaveAttribute("aria-invalid", "true"));
    expect(id).toHaveAccessibleDescription(/Un espace porte déjà cet identifiant/);
    expect(window.location.hash).toBe("");
  });

  it("refuse un identifiant hors motif sans appeler le serveur", async () => {
    const server = fakeServer(({ path }) => (path === "/api/workspaces" ? { json: [] } : undefined));
    home();
    await userEvent.click(await screen.findByRole("button", { name: "Créer un espace" }));
    const dialog = within(screen.getByRole("dialog"));
    await userEvent.click(dialog.getByRole("button", { name: "Créer l'espace" }));
    expect(dialog.getByLabelText(/^Nom/)).toHaveAccessibleDescription("Le nom est requis.");
    await userEvent.type(dialog.getByLabelText(/^Identifiant/), "-X");
    await userEvent.click(dialog.getByRole("button", { name: "Créer l'espace" }));
    expect(dialog.getByLabelText(/^Identifiant/)).toHaveAccessibleDescription(/minuscules, chiffres et tirets/);
    expect(server.calls.filter((c) => c.method === "POST")).toEqual([]);
  });

  it("garde l'espace créé si le dépôt distant ne se rattache pas", async () => {
    fakeServer(({ method, path }) => {
      if (path === "/api/workspaces" && method === "GET") return { json: [] };
      if (path === "/api/workspaces" && method === "POST") return { status: 201, json: workspace({ id: "acme" }) };
      if (path === "/api/workspaces/acme/remote") {
        return { status: 422, json: { detail: { code: "credentials_in_url", message: "x" } } };
      }
    });
    home();
    await userEvent.click(await screen.findByRole("button", { name: "Créer un espace" }));
    const dialog = within(screen.getByRole("dialog"));
    await userEvent.type(dialog.getByLabelText(/^Nom/), "Acme");
    await userEvent.type(dialog.getByLabelText("Dépôt distant"), "https://moi:secret@exemple/acme.git");
    await userEvent.click(dialog.getByRole("button", { name: "Créer l'espace" }));
    expect(await dialog.findByText("Espace créé, dépôt distant non rattaché")).toBeInTheDocument();
    expect(dialog.getByText(/Retirez l'identifiant et le mot de passe/)).toBeInTheDocument();
    await userEvent.click(dialog.getByRole("button", { name: "Ouvrir l'espace" }));
    expect(window.location.hash).toBe("#/w/acme/catalogue");
  });

  it("se ferme avec Échap et rend le focus au bouton", async () => {
    fakeServer(({ path }) => (path === "/api/workspaces" ? { json: [] } : undefined));
    home();
    const open = await screen.findByRole("button", { name: "Créer un espace" });
    await userEvent.click(open);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(open).toHaveFocus();
  });
});

describe("rejoindre un espace", () => {
  it("clone, montre la progression, puis ouvre l'espace (critère 4)", async () => {
    let finish: (value: { status: number; json: unknown }) => void = () => {};
    const server = fakeServer(({ method, path }) => {
      if (path === "/api/workspaces" && method === "GET") return { json: [] };
      if (path === "/api/workspaces/join") return new Promise((resolve) => (finish = resolve));
    });
    home();
    await userEvent.click(await screen.findByRole("button", { name: "Rejoindre un espace" }));
    const dialog = within(screen.getByRole("dialog", { name: "Rejoindre un espace" }));
    await userEvent.type(dialog.getByLabelText(/^Adresse du dépôt/), "/depots/nordis.git");
    await userEvent.click(dialog.getByRole("button", { name: "Cloner et ouvrir" }));
    expect(await dialog.findByText("Clonage du dépôt…")).toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "Cloner et ouvrir" })).toBeDisabled();
    finish({ status: 201, json: workspace() });
    await waitFor(() => expect(window.location.hash).toBe("#/w/groupe-nordis/catalogue"));
    expect(server.calls.find((c) => c.path === "/api/workspaces/join")?.body).toEqual({
      remote_url: "/depots/nordis.git",
    });
  });

  it.each([
    ["git_missing", 503, "Git est introuvable sur ce poste"],
    ["sync_conflict", 409, "Le dépôt local a divergé du dépôt distant"],
    ["clone_failed", 500, "Le dépôt n'a pas pu être cloné"],
  ])("traduit l'erreur %s", async (code, status, title) => {
    fakeServer(({ method, path }) => {
      if (path === "/api/workspaces" && method === "GET") return { json: [] };
      if (path === "/api/workspaces/join") return { status, json: { detail: { code, message: "brut" } } };
    });
    home();
    await userEvent.click(await screen.findByRole("button", { name: "Rejoindre un espace" }));
    const dialog = within(screen.getByRole("dialog"));
    await userEvent.type(dialog.getByLabelText(/^Adresse du dépôt/), "/x.git");
    await userEvent.click(dialog.getByRole("button", { name: "Cloner et ouvrir" }));
    expect(await dialog.findByRole("alert")).toHaveTextContent(title);
    expect(dialog.getByRole("button", { name: "Cloner et ouvrir" })).toBeEnabled();
  });
});

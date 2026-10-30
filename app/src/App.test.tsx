import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { ALTAVIA, fakeServer, workspace } from "./test/fakeServer";

afterEach(() => vi.unstubAllGlobals());

const FAST = { attempts: 2, delayMs: 1 };

function goTo(hash: string) {
  act(() => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
}

function nordisServer(proposals: unknown[] = [{ id: 1 }, { id: 2 }, { id: 3 }]) {
  return fakeServer(({ path }) => {
    if (path === "/api/workspaces") return { json: [workspace(), ALTAVIA] };
    if (path.endsWith("/proposals?status=open&for_me=true")) return { json: proposals };
  });
}

describe("démarrage et serveur injoignable", () => {
  it("annonce le démarrage tant que le serveur ne répond pas", async () => {
    let ready: (value: { json: unknown }) => void = () => {};
    const server = fakeServer(({ path }) => {
      if (path === "/health") return new Promise((resolve) => (ready = resolve));
      if (path === "/api/workspaces") return { json: [] };
    });
    render(<App startup={FAST} />);
    expect(screen.getByText("Démarrage du serveur local…")).toBeInTheDocument();
    await waitFor(() => expect(server.calls).toHaveLength(1));
    ready({ json: { status: "ok", version: "0.0.1" } });
    expect(await screen.findByText("Aucun espace pour l'instant")).toBeInTheDocument();
  });

  it("affiche le bandeau, puis Réessayer fonctionne après redémarrage (critère 5)", async () => {
    const server = fakeServer(({ path }) => (path === "/api/workspaces" ? { json: [workspace()] } : undefined));
    server.setDown(true);
    render(<App startup={FAST} />);
    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent("Serveur local injoignable");
    server.setDown(false);
    await userEvent.click(within(banner).getByRole("button", { name: "Réessayer" }));
    expect(await screen.findByText("Groupe Nordis")).toBeInTheDocument();
    expect(screen.queryByText("Serveur local injoignable")).toBeNull();
  });

  it("bascule sur le bandeau quand le serveur tombe en cours de route", async () => {
    const server = nordisServer();
    render(<App startup={FAST} />);
    expect(await screen.findByText("Groupe Nordis")).toBeInTheDocument();
    server.setDown(true);
    goTo("#/w/groupe-nordis/catalogue");
    expect(await screen.findByText("Serveur local injoignable")).toBeInTheDocument();
    server.setDown(false);
    await userEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(await screen.findByRole("heading", { name: "Catalogue" })).toBeInTheDocument();
  });
});

describe("coque d'un espace", () => {
  it("affiche l'espace courant dans le sélecteur, qui ramène à l'accueil (critère 6)", async () => {
    nordisServer();
    window.location.hash = "#/w/groupe-nordis/catalogue";
    render(<App startup={FAST} />);
    const switcher = await screen.findByRole("link", { name: /Espace\s*Groupe Nordis/ });
    expect(switcher).toHaveAttribute("href", "#/");
    expect(screen.getByRole("heading", { name: "Catalogue" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Catalogue/ })).toHaveAttribute("aria-current", "page");
    await userEvent.click(switcher);
    expect(await screen.findByRole("heading", { name: "Vos espaces de travail" })).toBeInTheDocument();
  });

  it("montre Administration au référent et le compteur des propositions qui l'attendent", async () => {
    nordisServer();
    window.location.hash = "#/w/groupe-nordis/comparaison";
    render(<App startup={FAST} />);
    const nav = within(await screen.findByRole("navigation", { name: "Navigation de l'espace" }));
    expect(nav.getAllByRole("link").map((l) => l.textContent)).toEqual([
      "Catalogue",
      "Propositions3 en attente de votre revue",
      "Comparaison",
      "Connexions",
      "Administration",
    ]);
    expect(screen.getByText("Référent d'annuaire")).toBeInTheDocument();
    expect(screen.getByText(/plan 0015/)).toBeInTheDocument(); // écran pas encore livré
  });

  it("masque Administration à un rôle non référent, même par l'URL (critère 7)", async () => {
    nordisServer([]);
    window.location.hash = "#/w/altavia-energie/administration";
    render(<App startup={FAST} />);
    const nav = within(await screen.findByRole("navigation", { name: "Navigation de l'espace" }));
    expect(nav.queryByRole("link", { name: /Administration/ })).toBeNull();
    expect(nav.getByRole("link", { name: "Propositions" })).toBeInTheDocument(); // pas de compteur
    await waitFor(() => expect(window.location.hash).toBe("#/w/altavia-energie/catalogue"));
  });

  it("ramène à l'accueil avec un message pour un espace inconnu", async () => {
    nordisServer();
    window.location.hash = "#/w/inconnu/catalogue";
    render(<App startup={FAST} />);
    expect(await screen.findByText("L'espace « inconnu » n'est pas dans votre registre local.")).toBeInTheDocument();
    expect(window.location.hash).toBe("#/");
    await userEvent.click(screen.getByRole("button", { name: "Fermer" }));
    expect(screen.queryByText(/inconnu/)).toBeNull();
  });
});

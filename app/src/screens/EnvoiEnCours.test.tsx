import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeServer, workspace, type Call } from "../test/fakeServer";
import { CreateWorkspace } from "./CreateWorkspace";
import { JoinWorkspace } from "./JoinWorkspace";

// Issue n° 146 : tant que la création ou l'adhésion est en vol, le panneau ne se ferme pas ;
// sinon la réponse arrivait après coup et naviguait alors que l'utilisateur était ailleurs.

afterEach(() => vi.unstubAllGlobals());

type Reply = { status: number; json: unknown };

// Le focus reste dans le panneau : il ne s'échappe pas vers la page dessous.
function expectFocusInside() {
  expect(screen.getByRole("dialog")).toContainElement(document.activeElement as HTMLElement);
}

function deferred() {
  let release!: (reply: Reply) => void;
  const promise = new Promise<Reply>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe("Panneau latéral : fermeture pendant l'envoi (146)", () => {
  it("[S-0005-13] Échap et « Fermer » sont sans effet tant que la création est en vol", async () => {
    const pending = deferred();
    fakeServer((call: Call) => (call.path === "/api/workspaces" && call.method === "POST" ? pending.promise : undefined));
    const onClose = vi.fn();
    const onCreated = vi.fn();
    render(<CreateWorkspace onClose={onClose} onCreated={onCreated} />);
    await userEvent.type(screen.getByLabelText(/Nom/), "Maison Perrault");
    await userEvent.click(screen.getByRole("button", { name: "Fermer" }));
    expect(onClose).toHaveBeenCalledTimes(1); // hors envoi, la fermeture marche
    await userEvent.click(screen.getByRole("button", { name: "Créer l'espace" }));
    expect(await screen.findByRole("button", { name: "Création…" })).toBeDisabled();

    expectFocusInside();
    await userEvent.click(screen.getByRole("button", { name: "Fermer" }));
    await userEvent.keyboard("{Escape}");
    await userEvent.tab();
    expectFocusInside();
    expect(onClose).toHaveBeenCalledTimes(1);

    pending.release({ status: 201, json: workspace({ id: "maison-perrault", name: "Maison Perrault" }) });
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
  });

  it("[S-0005-13] Échap et « Fermer » sont sans effet tant que l'adhésion est en vol, puis fonctionnent après un échec", async () => {
    const pending = deferred();
    fakeServer((call: Call) => (call.path === "/api/workspaces/join" ? pending.promise : undefined));
    const onClose = vi.fn();
    render(<JoinWorkspace onClose={onClose} onJoined={() => undefined} />);
    await userEvent.type(screen.getByLabelText(/Adresse du dépôt/), "/depots/nordis.git");
    await userEvent.click(screen.getByRole("button", { name: "Cloner et ouvrir" }));
    expect(await screen.findByText("Clonage du dépôt…")).toBeInTheDocument();

    // Le champ et le bouton d'envoi sont désactivés : « Fermer » garde le focus dans le panneau.
    expect(screen.getByRole("button", { name: "Fermer" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Fermer" })).toHaveFocus();
    expectFocusInside();
    await userEvent.keyboard("{Escape}");
    await userEvent.tab();
    expectFocusInside();
    await userEvent.click(screen.getByRole("button", { name: "Fermer" }));
    expect(onClose).not.toHaveBeenCalled();

    pending.release({ status: 502, json: { detail: { code: "clone_failed", message: "x" } } });
    expect(await screen.findByText("Le dépôt n'a pas pu être cloné")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fermer" })).not.toHaveAttribute("aria-disabled");
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { explain } from "./messages";

describe("explain", () => {
  it("base occupée par un autre processus : la cause et quoi faire (ADR 0032)", () => {
    const busy = new ApiError(503, "index_busy", "La base de l'espace est ouverte par un autre processus Atlas.");
    expect(explain(busy)).toEqual({
      title: "Base de l'espace occupée",
      text: "Un autre processus Atlas (la ligne de commande, par exemple) utilise la base de cet espace. Réessayez quand il aura fini.",
    });
  });

  it("[S-0005-12] liste des espaces ou dépôt tenus par un autre processus : la cause et quoi faire (ADR 0039)", () => {
    const registry = new ApiError(503, "registry_busy", "La liste des espaces est en cours de modification par un autre processus Atlas.");
    expect(explain(registry)).toEqual({
      title: "Liste des espaces occupée",
      text: "Un autre processus Atlas (la ligne de commande, par exemple) modifie la liste des espaces. Réessayez dans un instant.",
    });
    const clone = new ApiError(503, "clone_busy", "Une autre opération tient le dépôt de l'espace.");
    expect(explain(clone)).toEqual({
      title: "Espace en cours d'utilisation",
      text: "Une autre opération (une synchronisation dans la ligne de commande, par exemple) utilise le dépôt de cet espace. Réessayez quand elle aura fini.",
    });
  });

  // Refus de la revue et de la fusion : le serveur y joint la sortie de git ou la réponse de GitHub.
  const REFUSALS: [code: string, status: number, raw: string, title: string, advice: RegExp][] = [
    ["merge_conflict", 409, "git merge a échoué : CONFLICT (content): Merge conflict in kpis/revenu-net.yaml", "La fusion provoque un conflit", /reproposer/],
    ["merge_refused", 409, "git push a échoué : ! [remote rejected] main -> main (fetch first)", "Le dépôt a refusé la fusion", /réessayez/],
    ["branch_protected", 409, "GitHub a répondu 405 : Required status check is expected", "La branche principale est protégée", /sur GitHub/],
    ["head_changed", 409, "GitHub a répondu 409 : Head branch was modified.", "La proposition a changé depuis son affichage", /approuver la proposition de nouveau/],
    ["not_open", 409, "La proposition #5 n'est plus ouverte.", "La proposition n'est plus ouverte", /« Fusionnées » ou « Fermées »/],
    ["cannot_review_own", 422, "L'auteur ne peut pas approuver sa propre proposition.", "Vous ne pouvez pas relire votre proposition", /un autre validateur/],
    ["comment_required", 422, "Une demande de changements s'accompagne d'un commentaire qui dit quoi changer.", "Commentaire manquant", /Écrivez un commentaire/],
  ];

  it.each(REFUSALS)("[S-0014-08] %s : un titre et une consigne, jamais le texte du serveur", (code, status, raw, title, advice) => {
    const explained = explain(new ApiError(status, code, raw));
    expect(explained.title).toBe(title);
    expect(explained.text).toMatch(advice);
    expect(explained.title).not.toBe("L'opération a échoué");
    expect(explained.text).not.toContain(raw);
  });

  // `not_ready` : plusieurs causes (décompte, changements demandés, aucun habilité). La raison
  // du serveur, en français, est conservée devant la consigne.
  it.each([
    "1 validation(s) sur 2.",
    "Changements demandés par claire.m.",
    "2 validations requises, 1 seul(s) autre(s) compte(s) habilité(s).",
    "Aucun compte n'est habilité à approuver dans ce domaine.",
  ])("[S-0014-08] not_ready : la raison « %s » précède la consigne", (reason) => {
    const explained = explain(new ApiError(409, "not_ready", reason));
    expect(explained.title).toBe("La proposition ne remplit plus les conditions de fusion");
    expect(explained.text.startsWith(`${reason} Rien n'a été fusionné.`)).toBe(true);
    expect(explained.text).toMatch(/relisez la proposition/);
  });

  // Codes des connecteurs et du coffre : chacun a un titre et une consigne, jamais le texte brut du serveur.
  it.each([
    ["not_connected", 409, "Pas encore connecté", /Mes connexions/],
    ["access_expired", 409, "Accès expiré", /Mes connexions/],
    ["vault_unavailable", 503, "Trousseau du système indisponible", /Déverrouillez/],
    ["oauth_port_busy", 409, "Une connexion OAuth est déjà en cours", /Terminez-la/],
    ["query_failed", 502, "La plateforme a refusé la requête", /Vérifiez vos droits/],
    ["query_timeout", 504, "La requête a dépassé le délai", /entrepôt/],
    ["host_unreachable", 502, "Hôte injoignable", /Vérifiez l'adresse/],
    ["host_rejected", 422, "GitHub a refusé la demande", /Rechargez/],
  ])("[S-0016-09] %s : titre et consigne, sans le texte brut du serveur", (code, status, title, advice) => {
    const raw = `texte brut du serveur pour ${code}`;
    const found = explain(new ApiError(status, code, raw));
    expect(found.title).toBe(title);
    expect(found.text).toMatch(advice);
    expect(found.text).not.toContain(raw);
    expect(found.title).not.toBe("L'opération a échoué");
  });

  it("[S-0016-09] seuls not_connected et access_expired mènent à la reconnexion", () => {
    const actions = ["not_connected", "access_expired", "vault_unavailable", "oauth_port_busy", "query_failed", "query_timeout", "host_unreachable", "host_rejected"]
      .filter((code) => explain(new ApiError(409, code, "x")).action === "reconnect");
    expect(actions).toEqual(["not_connected", "access_expired"]);
  });

  it("un code inconnu garde le titre générique et le texte du serveur", () => {
    expect(explain(new ApiError(500, "inconnu", "Détail du serveur."))).toEqual({ title: "L'opération a échoué", text: "Détail du serveur." });
  });
});

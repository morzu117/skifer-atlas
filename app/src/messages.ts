import { ApiError, UnreachableError } from "./api";

export type Explained = { title: string; text: string };

// Codes d'erreur du serveur traduits pour l'utilisateur : ce qui s'est passé, et quoi faire.
const KNOWN: Record<string, Explained> = {
  git_missing: {
    title: "Git est introuvable sur ce poste",
    text: "Installez Git (git-scm.com), puis relancez Skifer Atlas.",
  },
  git_timeout: {
    title: "Git ne répond pas",
    text: "Le dépôt met trop de temps à répondre. Vérifiez la connexion, puis réessayez.",
  },
  sync_conflict: {
    title: "Le dépôt local a divergé du dépôt distant",
    text: "Des modifications locales empêchent la mise à jour. Contactez le référent de l'espace.",
  },
  clone_failed: {
    title: "Le dépôt n'a pas pu être cloné",
    text: "Vérifiez l'adresse et vos droits d'accès au dépôt, puis réessayez.",
  },
  invalid_workspace: {
    title: "Ce dépôt n'est pas un espace Atlas",
    text: "Il n'a pas de fichier atlas.yaml valide. Vérifiez l'adresse du dépôt.",
  },
  credentials_in_url: {
    title: "Adresse avec identifiants",
    text: "Retirez l'identifiant et le mot de passe de l'adresse : Atlas ne les enregistre jamais.",
  },
  invalid_remote: {
    title: "Adresse de dépôt invalide",
    text: "Donnez une adresse HTTPS, SSH ou un chemin vers un dépôt Git.",
  },
  document_exists: {
    title: "Identifiant déjà pris",
    text: "Un document ou un brouillon porte déjà cet identifiant. Proposez une modification depuis sa fiche, ou choisissez-en un autre.",
  },
  github_not_configured: {
    title: "Connexion GitHub non configurée",
    text: "Cette installation d'Atlas n'a pas de client OAuth GitHub (ATLAS_GITHUB_CLIENT_ID). Contactez l'équipe qui la distribue.",
  },
  device_flow_failed: {
    title: "GitHub a refusé la connexion",
    text: "Recommencez la connexion. Si le refus persiste, vérifiez que l'application Skifer Atlas est autorisée par votre organisation.",
  },
  host_auth_failed: {
    title: "GitHub demande une connexion",
    text: "Connectez-vous à GitHub dans Mes connexions, puis réessayez.",
  },
  workspace_exists: {
    title: "Identifiant déjà pris",
    text: "Un espace porte déjà cet identifiant sur ce poste. Choisissez-en un autre.",
  },
};

export function explain(error: unknown): Explained {
  if (error instanceof UnreachableError) {
    return { title: "Serveur local injoignable", text: "Réessayez dans un instant." };
  }
  if (error instanceof ApiError) {
    return KNOWN[error.code] ?? { title: "L'opération a échoué", text: error.message };
  }
  return { title: "L'opération a échoué", text: String(error) };
}

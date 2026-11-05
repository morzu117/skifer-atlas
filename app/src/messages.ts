import { ApiError, UnreachableError } from "./api";

export type Explained = { title: string; text: string };

// Codes d'erreur du serveur traduits pour l'utilisateur : ce qui s'est passé, et quoi faire.
const KNOWN: Record<string, Explained> = {
  git_missing: {
    title: "Git est introuvable sur ce poste",
    text: "Installez Git (git-scm.com), puis relancez Skifer Atlas.",
  },
  index_busy: {
    title: "Base de l'espace occupée",
    text: "Un autre processus Atlas (la ligne de commande, par exemple) utilise la base de cet espace. Réessayez quand il aura fini.",
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
  access_host_mismatch: {
    title: "Connexion liée à un autre hôte",
    text: "Ce point d'accès a changé d'hôte, ou sa connexion est ancienne. Reconnectez-vous avant de l'utiliser.",
  },
  remote_not_found: {
    title: "Dépôt introuvable",
    text: "Vérifiez l'adresse. Si le dépôt est privé, le compte GitHub connecté doit y avoir accès.",
  },
  remote_not_empty: {
    title: "Ce dépôt n'est pas vide",
    text: "Atlas ne rattache qu'un dépôt vierge, pour ne rien écraser. Créez-en un sans README, licence ni .gitignore, puis réessayez.",
  },
  remote_not_writable: {
    title: "Pas de droit d'écriture sur ce dépôt",
    text: "Le compte connecté ne peut pas y pousser (lecture seule ou dépôt archivé). Demandez un accès en écriture ou choisissez un autre dépôt.",
  },
  remote_partial: {
    title: "Rattachement interrompu",
    text: "La publication partielle doit être résolue avant de réessayer.",
  },
  origin_conflict: {
    title: "Adresse origin différente",
    text: "Le clone possède déjà une configuration origin différente. Corrigez-la avant de réessayer.",
  },
  attach_incomplete: {
    title: "Dépôt publié, rattachement à terminer",
    text: "Le dépôt a bien reçu l'espace, mais le rattachement n'a pas pu s'achever sur ce poste. Rattachez de nouveau avec la même adresse : le nouvel essai termine le rattachement, sans rien republier.",
  },
  remote_exists: {
    title: "Espace déjà rattaché",
    text: "Cet espace a déjà un dépôt distant : rien n'a été modifié.",
  },
  unsupported_host: {
    title: "Hébergeur non pris en charge",
    text: "Atlas rattache un dépôt GitHub. Vérifiez l'adresse.",
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
    // Messages du serveur, en français et sans sortie de git : ils disent quel compte,
    // ou quelle adresse origin (identifiant masqué), est en cause.
    if (error.code === "remote_partial" || error.code === "origin_conflict") {
      return { title: KNOWN[error.code].title, text: error.message };
    }
    return KNOWN[error.code] ?? { title: "L'opération a échoué", text: error.message };
  }
  return { title: "L'opération a échoué", text: String(error) };
}

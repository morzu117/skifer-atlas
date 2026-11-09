import { ApiError, ServerInfoError, UnreachableError } from "./api";

/** `action: "reconnect"` : l'accès à la plateforme est à refaire ; l'écran qui affiche
 * l'erreur y mène (Mes connexions) au lieu de seulement la décrire. */
export type Explained = { title: string; text: string; action?: "reconnect" };

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
  registry_busy: {
    title: "Liste des espaces occupée",
    text: "Un autre processus Atlas (la ligne de commande, par exemple) modifie la liste des espaces. Réessayez dans un instant.",
  },
  clone_busy: {
    title: "Espace en cours d'utilisation",
    text: "Une autre opération (une synchronisation dans la ligne de commande, par exemple) utilise le dépôt de cet espace. Réessayez quand elle aura fini.",
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
    text: "Le dépôt a bien reçu l'espace, mais le rattachement n'a pas pu s'achever sur ce poste. Rattachez de nouveau avec la même adresse : le nouvel essai termine le rattachement, sans rien republier. Vous pouvez aussi réinitialiser le rattachement pour repartir de zéro.",
  },
  reset_incomplete: {
    title: "Réinitialisation interrompue",
    text: "Aucun commit n'est perdu et le dépôt distant n'a pas été modifié. Relancez la réinitialisation : elle reprend là où elle s'est arrêtée.",
  },
  identity_not_found: {
    title: "Gouvernance à corriger d'abord",
    text: "La gouvernance ne contient plus le compte du créateur et aucun commit d'identité d'Atlas ne l'explique. Rien n'a été modifié : remettez le compte du créateur dans governance.yaml, enregistrez, puis réinitialisez.",
  },
  remote_exists: {
    title: "Espace déjà rattaché",
    text: "Cet espace a déjà un dépôt distant : rien n'a été modifié.",
  },
  comparison_running: {
    title: "Comparaison déjà en cours",
    text: "Attendez sa fin avant de relancer cette comparaison.",
  },
  unsupported_host: {
    title: "Hébergeur non pris en charge",
    text: "Atlas rattache un dépôt GitHub. Vérifiez l'adresse.",
  },
  workspace_exists: {
    title: "Identifiant déjà pris",
    text: "Un espace porte déjà cet identifiant sur ce poste. Choisissez-en un autre.",
  },
  // Propositions : revue et fusion (plan 0006). Le serveur y joint la sortie de git ou la
  // réponse de GitHub, en anglais ; l'écran dit ce qui s'est passé et quoi faire.
  merge_conflict: {
    title: "La fusion provoque un conflit",
    text: "La proposition modifie des lignes que la branche principale a changées depuis. Rien n'a été fusionné : demandez à l'auteur de la reproposer à partir de la version courante.",
  },
  merge_refused: {
    title: "Le dépôt a refusé la fusion",
    text: "La branche principale a sans doute avancé pendant l'opération. Rien n'a été fusionné : relisez la proposition, puis réessayez.",
  },
  branch_protected: {
    title: "La branche principale est protégée",
    text: "Une règle de la branche, sur GitHub, empêche cette fusion (vérifications ou relectures exigées par le dépôt, par exemple). Rien n'a été fusionné : remplissez la condition sur GitHub, ou contactez le référent de l'espace.",
  },
  head_changed: {
    title: "La proposition a changé depuis son affichage",
    text: "Son auteur a ajouté des commits : les validations données ne valent plus pour cette version. Rien n'a été fusionné. L'écran vient d'être relu : relisez le diff, puis faites approuver la proposition de nouveau.",
  },
  // Le serveur donne ici la raison exacte, en français (« Changements demandés par claire.m. »,
  // « 1 validation(s) sur 2. »…) : `explain` la place avant cette consigne.
  not_ready: {
    title: "La proposition ne remplit plus les conditions de fusion",
    text: "Rien n'a été fusionné. L'écran vient d'être relu : relisez la proposition, puis agissez selon ce qu'elle indique (validations à obtenir, changements demandés à traiter).",
  },
  not_open: {
    title: "La proposition n'est plus ouverte",
    text: "Elle a déjà été fusionnée ou fermée. Rien à faire : retrouvez-la dans les filtres « Fusionnées » ou « Fermées ».",
  },
  cannot_review_own: {
    title: "Vous ne pouvez pas relire votre proposition",
    text: "L'auteur ne peut ni l'approuver ni demander de changements. Demandez à un autre validateur du domaine de la relire.",
  },
  comment_required: {
    title: "Commentaire manquant",
    text: "Une demande de changements doit dire ce qui doit changer. Écrivez un commentaire, puis envoyez la demande de nouveau.",
  },
  // Connecteurs et coffre (plans 0008, 0016, 0018).
  not_connected: {
    title: "Pas encore connecté",
    text: "Aucun accès n'est enregistré pour ce point d'accès sur ce poste. Connectez-vous depuis Mes connexions, puis réessayez.",
    action: "reconnect",
  },
  access_expired: {
    title: "Accès expiré",
    text: "La session ou le token n'est plus accepté par la plateforme. Reconnectez-vous depuis Mes connexions, puis réessayez.",
    action: "reconnect",
  },
  vault_unavailable: {
    title: "Trousseau du système indisponible",
    text: "Atlas ne range un identifiant que dans le trousseau de ce poste, jamais ailleurs. Déverrouillez le trousseau (ou démarrez son service), puis réessayez.",
  },
  oauth_port_busy: {
    title: "Une connexion OAuth est déjà en cours",
    text: "Le port de retour de la connexion est occupé (l'autre connexion d'Atlas, ou la CLI Databricks). Terminez-la ou fermez-la, puis réessayez.",
  },
  query_failed: {
    title: "La plateforme a refusé la requête",
    text: "Vérifiez vos droits sur le schéma et l'entrepôt de ce point d'accès, puis réessayez.",
  },
  query_timeout: {
    title: "La requête a dépassé le délai",
    text: "La plateforme n'a pas répondu à temps et la requête a été interrompue. Vérifiez que l'entrepôt est démarré, puis réessayez.",
  },
  host_unreachable: {
    title: "Hôte injoignable",
    text: "Atlas n'a pas pu joindre le serveur. Vérifiez l'adresse et la connexion réseau (VPN, proxy), puis réessayez.",
  },
  host_rejected: {
    title: "GitHub a refusé la demande",
    text: "Elle ne correspond plus à l'état du dépôt (une proposition identique existe peut-être déjà, ou la branche a changé). Rechargez l'écran, puis réessayez ; si le refus persiste, contactez le référent de l'espace.",
  },
};

/** L'explication d'un code du serveur, ou `undefined` s'il n'est pas traduit. */
export const translated = (code: string): Explained | undefined => KNOWN[code];

export function explain(error: unknown): Explained {
  if (error instanceof ServerInfoError) {
    return {
      title: "Serveur local injoignable",
      text: "L'application n'a pas pu lire l'adresse et le token du serveur local. Relancez Skifer Atlas.",
    };
  }
  if (error instanceof UnreachableError) {
    return { title: "Serveur local injoignable", text: "Réessayez dans un instant." };
  }
  if (error instanceof ApiError) {
    // Messages du serveur, en français et sans sortie de git : ils disent quel compte,
    // ou quelle adresse origin (identifiant masqué), est en cause.
    if (error.code === "remote_partial" || error.code === "origin_conflict") {
      return { title: KNOWN[error.code].title, text: error.message };
    }
    // La raison du refus (décompte, changements demandés, aucun habilité) précède la consigne.
    if (error.code === "not_ready") {
      return { title: KNOWN.not_ready.title, text: `${error.message} ${KNOWN.not_ready.text}` };
    }
    return translated(error.code) ?? { title: "L'opération a échoué", text: error.message };
  }
  return { title: "L'opération a échoué", text: String(error) };
}

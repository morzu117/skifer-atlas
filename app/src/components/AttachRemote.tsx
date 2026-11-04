import { useEffect, useState, type KeyboardEvent } from "react";
import { api, ApiError, type GitHubStatus, type Workspace } from "../api";
import { explain, type Explained } from "../messages";
import { Banner } from "./Banner";
import { Field } from "./Field";
import { GitHubConnect } from "./GitHubConnect";

// Rattacher un espace créé dans Atlas à un dépôt distant vide (plan 0033, ADR 0037). Pour
// GitHub, la connexion (device flow, plan 0025) précède : le serveur identifie le compte avec
// son jeton, vérifie ses droits d'écriture et que le dépôt est vide, avant de pousser. Ni
// formulaire ni champ de jeton : ce composant se place dans un formulaire (Administration).

// Ces deux codes servent aussi à d'autres opérations (propositions, synchronisation) : leur
// explication propre au rattachement reste ici.
const ATTACH_ERRORS: Record<string, Explained> = {
  push_failed: {
    title: "L'envoi vers le dépôt a échoué",
    text: "Le dépôt n'a rien reçu et l'espace reste local. Vérifiez vos droits d'écriture, puis réessayez.",
  },
  host_unreachable: {
    title: "Dépôt injoignable",
    text: "Vérifiez l'adresse et la connexion, puis réessayez.",
  },
};

/** Adresse d'un dépôt GitHub : HTTPS, SSH ou syntaxe scp. */
export const isGitHubRemote = (url: string) =>
  /^(https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)[^/\s]+\/[^/\s]+/.test(url.trim());

export function AttachRemote({
  ws,
  initialUrl = "",
  blocked,
  onPending,
  onAttached,
}: {
  ws: Pick<Workspace, "id">;
  initialUrl?: string;
  /** Raison pour laquelle le rattachement est suspendu (une modification est en cours). */
  blocked?: string;
  /** Annonce le début et la fin de la requête : l'écran qui l'héberge gèle ses autres champs. */
  onPending?: (pending: boolean) => void;
  onAttached: (ws: Workspace) => void;
}) {
  const [url, setUrl] = useState(initialUrl);
  const [missing, setMissing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Explained | null>(null);
  const [github, setGithub] = useState<GitHubStatus | null>(null);
  const [revision, setRevision] = useState(0);
  const onGitHub = isGitHubRemote(url);

  useEffect(() => {
    if (!onGitHub) return;
    let alive = true;
    api
      .github(ws.id)
      .then((status) => alive && setGithub(status))
      .catch(() => alive && setGithub(null));
    return () => {
      alive = false;
    };
  }, [ws.id, onGitHub, revision]);

  const connected = github?.state === "connected";
  // Sans client OAuth, aucun bouton : le serveur dira, au rattachement, ce qu'il manque.
  const needsConnection = onGitHub && github !== null && github.configured && !connected;

  async function attach() {
    if (blocked) return;
    setMissing(!url.trim());
    if (!url.trim()) return;
    setError(null);
    setPending(true);
    onPending?.(true);
    try {
      onAttached(await api.setRemote(ws.id, url.trim()));
    } catch (reason) {
      const found = (reason instanceof ApiError && ATTACH_ERRORS[reason.code]) || explain(reason);
      if (reason instanceof ApiError && reason.code === "host_auth_failed") {
        setError({ title: found.title, text: onGitHub ? "Connectez-vous à GitHub ci-dessous, puis réessayez." : "Le dépôt refuse l'authentification : vérifiez vos accès, puis réessayez." });
        setRevision((n) => n + 1);
      } else {
        setError(found);
      }
    } finally {
      setPending(false);
      onPending?.(false);
    }
  }

  function onEnter(event: KeyboardEvent) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (!pending && !needsConnection && !blocked) void attach();
  }

  return (
    <div className="attach-remote" role="group" aria-label="Rattacher un dépôt distant">
      <Field
        label="Adresse du dépôt vide"
        id="attach-remote-url"
        required
        error={missing ? "L'adresse du dépôt est requise." : undefined}
        hint="Un dépôt vierge, créé sans README, licence ni .gitignore. HTTPS ou SSH, sans identifiant dans l'adresse."
      >
        <input
          className="mono"
          value={url}
          disabled={pending}
          onChange={(e) => (setUrl(e.target.value), setError(null))}
          onKeyDown={onEnter}
        />
      </Field>
      {onGitHub && github && (
        <div className="attach-remote-github">
          {connected ? (
            <span className="tone-ok" role="status">
              {github.account ? `Connecté à GitHub en tant que @${github.account}.` : "Connecté à GitHub (jeton de l'environnement)."}
            </span>
          ) : github.configured ? (
            <>
              <span className="muted">
                {github.state === "expired" ? "Le jeton GitHub de cet espace est refusé." : "Atlas se sert de votre compte GitHub pour vérifier vos droits sur le dépôt et y envoyer l'espace."}
              </span>
              <GitHubConnect
                workspace={ws.id}
                primary
                label={github.state === "expired" ? "Reconnecter GitHub" : "Se connecter à GitHub"}
                onConnected={() => (setError(null), setRevision((n) => n + 1))}
              />
            </>
          ) : (
            <span className="muted">Connexion GitHub non configurée pour cette installation.</span>
          )}
        </div>
      )}
      {pending && (
        <div className="progress" role="status">
          <span className="progress-bar" aria-hidden="true" />
          Vérification du dépôt, puis envoi de l'espace…
        </div>
      )}
      {error && (
        <Banner tone="bad" title={error.title}>
          {error.text}
        </Banner>
      )}
      {blocked && <span className="field-hint" id="attach-remote-blocked">{blocked}</span>}
      <button type="button" className="btn btn-primary btn-sm" disabled={pending || needsConnection || !!blocked} aria-describedby={blocked ? "attach-remote-blocked" : undefined} onClick={() => void attach()}>
        Rattacher le dépôt
      </button>
    </div>
  );
}

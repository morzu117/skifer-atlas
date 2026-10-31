import { useState, type FormEvent } from "react";
import { ApiError, api, type Workspace } from "../api";
import { Banner } from "../components/Banner";
import { Drawer } from "../components/Drawer";
import { Field } from "../components/Field";
import { GitHubConnect } from "../components/GitHubConnect";
import { explain, type Explained } from "../messages";

// Rejoindre un espace par l'adresse de son dépôt : clone, lecture d'atlas.yaml, rôle
// donné par governance.yaml (plan 0005). Un dépôt GitHub privé demande d'abord une
// connexion GitHub (plan 0025) : son jeton sert au clonage, puis va au coffre de l'espace.

export const isGitHubHttps = (url: string) => /^https:\/\/github\.com\/[^/]+\/[^/]+/.test(url.trim());
export function JoinWorkspace({ onClose, onJoined }: { onClose: () => void; onJoined: (ws: Workspace) => void }) {
  const [url, setUrl] = useState("");
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<Explained | null>(null);
  const [pending, setPending] = useState(false);
  const [needsGitHub, setNeedsGitHub] = useState(false);

  async function join(githubFlow?: string) {
    setError(null);
    setPending(true);
    try {
      onJoined(await api.joinWorkspace(url.trim(), githubFlow));
    } catch (failure) {
      setError(explain(failure));
      setNeedsGitHub(failure instanceof ApiError && failure.code === "clone_failed" && isGitHubHttps(url));
      setPending(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMissing(!url.trim());
    if (!url.trim()) return;
    await join();
  }

  return (
    <Drawer title="Rejoindre un espace" onClose={onClose}>
      <form className="form" onSubmit={submit} noValidate>
        <Field
          label="Adresse du dépôt"
          id="join-url"
          required
          error={missing ? "L'adresse du dépôt est requise." : undefined}
          hint="HTTPS, SSH ou chemin d'un dépôt local, sans identifiant dans l'adresse."
        >
          <input className="mono" value={url} onChange={(e) => setUrl(e.target.value)} disabled={pending} />
        </Field>
        {pending && (
          <div className="progress" role="status">
            <span className="progress-bar" aria-hidden="true" />
            Clonage du dépôt…
          </div>
        )}
        {error && (
          <Banner tone="bad" title={error.title}>
            {error.text}
            {needsGitHub && " Si le dépôt est privé, connectez-vous à GitHub : le clonage reprendra ensuite."}
          </Banner>
        )}
        {needsGitHub && !pending && <GitHubConnect primary onConnected={(flow) => void join(flow)} />}
        <button type="submit" className="btn btn-primary" disabled={pending}>
          Cloner et ouvrir
        </button>
      </form>
    </Drawer>
  );
}

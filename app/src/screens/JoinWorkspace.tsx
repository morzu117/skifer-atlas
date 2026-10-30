import { useState, type FormEvent } from "react";
import { api, type Workspace } from "../api";
import { Banner } from "../components/Banner";
import { Drawer } from "../components/Drawer";
import { Field } from "../components/Field";
import { explain, type Explained } from "../messages";

// Rejoindre un espace par l'adresse de son dépôt : clone, lecture d'atlas.yaml, rôle
// donné par governance.yaml (plan 0005).
export function JoinWorkspace({ onClose, onJoined }: { onClose: () => void; onJoined: (ws: Workspace) => void }) {
  const [url, setUrl] = useState("");
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<Explained | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMissing(!url.trim());
    setError(null);
    if (!url.trim()) return;
    setPending(true);
    try {
      onJoined(await api.joinWorkspace(url.trim()));
    } catch (failure) {
      setError(explain(failure));
      setPending(false);
    }
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
          </Banner>
        )}
        <button type="submit" className="btn btn-primary" disabled={pending}>
          Cloner et ouvrir
        </button>
      </form>
    </Drawer>
  );
}

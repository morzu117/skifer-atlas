import { useState, type FormEvent } from "react";
import { api, ApiError, type Workspace } from "../api";
import { Banner } from "../components/Banner";
import { Drawer } from "../components/Drawer";
import { Field } from "../components/Field";
import { Icon } from "../components/Icon";
import { slugify, WORKSPACE_ID } from "../format";
import { explain, type Explained } from "../messages";

type Errors = { name?: string; id?: string; form?: Explained; remote?: Explained };

// Formulaire non maquetté (guide 7) : nom, identifiant dérivé et modifiable, secteur,
// entités, dépôt distant facultatif. Le créateur devient référent de l'espace.
export function CreateWorkspace({ onClose, onCreated }: { onClose: () => void; onCreated: (ws: Workspace) => void }) {
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [idTouched, setIdTouched] = useState(false);
  const [sector, setSector] = useState("");
  const [entities, setEntities] = useState("");
  const [remote, setRemote] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState<Workspace | null>(null);

  function changeName(value: string) {
    setName(value);
    if (!idTouched) setId(slugify(value));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const found: Errors = {};
    if (!name.trim()) found.name = "Le nom est requis.";
    if (!WORKSPACE_ID.test(id)) {
      found.id = "De 2 à 64 caractères : minuscules, chiffres et tirets, sans tiret au début.";
    }
    setErrors(found);
    if (found.name || found.id) return;
    setPending(true);
    try {
      const list = entities.split(",").map((e) => e.trim()).filter(Boolean);
      const workspace = await api.createWorkspace({ id, name: name.trim(), sector: sector.trim(), entities: list });
      if (remote.trim()) {
        try {
          await api.setRemote(workspace.id, remote.trim());
        } catch (error) {
          setCreated(workspace);
          setErrors({ remote: explain(error) });
          return;
        }
      }
      onCreated(workspace);
    } catch (error) {
      if (error instanceof ApiError && error.code === "workspace_exists") {
        setErrors({ id: explain(error).text });
      } else {
        setErrors({ form: explain(error) });
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Drawer title="Créer un espace" onClose={onClose}>
      <form className="form" onSubmit={submit} noValidate>
        <Field label="Nom" required error={errors.name} id="ws-name">
          <input value={name} onChange={(e) => changeName(e.target.value)} />
        </Field>
        <Field label="Identifiant" required error={errors.id} id="ws-id" hint="Dans l'URL et le nom du dossier.">
          <input
            className="mono"
            value={id}
            onChange={(e) => {
              setIdTouched(true);
              setId(e.target.value);
            }}
          />
        </Field>
        <Field label="Secteur" id="ws-sector">
          <input value={sector} onChange={(e) => setSector(e.target.value)} />
        </Field>
        <Field label="Entités" id="ws-entities" hint="Séparées par des virgules, ex. nordis-fr, nordis-de.">
          <input className="mono" value={entities} onChange={(e) => setEntities(e.target.value)} />
        </Field>
        <Field label="Dépôt distant" id="ws-remote" hint="Facultatif : un dépôt vide, rattachable plus tard.">
          <input className="mono" value={remote} onChange={(e) => setRemote(e.target.value)} />
        </Field>
        {errors.form && <Banner tone="bad" title={errors.form.title}>{errors.form.text}</Banner>}
        {created && errors.remote ? (
          <Banner
            tone="warn"
            title="Espace créé, dépôt distant non rattaché"
            action={
              <button type="button" className="btn btn-secondary" onClick={() => onCreated(created)}>
                Ouvrir l'espace
              </button>
            }
          >
            {errors.remote.title} : {errors.remote.text} Rattachez-le plus tard depuis l'administration.
          </Banner>
        ) : (
          <button type="submit" className="btn btn-primary" disabled={pending}>
            <Icon name="plus" className="icon-sm" />
            {pending ? "Création…" : "Créer l'espace"}
          </button>
        )}
      </form>
    </Drawer>
  );
}

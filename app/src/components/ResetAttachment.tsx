import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { api, ApiError, type RemoteReset, type Workspace } from "../api";
import { explain, type Explained } from "../messages";
import { Banner } from "./Banner";

// « Réinitialiser le rattachement » (plan 0034, ADR 0038) : le bouton, sa confirmation explicite et
// la requête, partagés par le formulaire de rattachement (AttachRemote) et la bannière de la coque
// d'un espace rouvert (WorkspaceShell). Seule la copie locale change ; le dépôt distant n'est
// jamais modifié.

export const RESET_DONE = "Rattachement réinitialisé. Seule la copie locale a changé : le dépôt distant n'a pas été modifié.";
export const RESET_NOTHING = "Rien à réinitialiser : la copie locale n'avait aucun reste de rattachement.";

type Options = {
  /** Début et fin de la requête : l'écran qui héberge le bouton gèle ses autres champs. */
  onPending?: (pending: boolean) => void;
  /** La réinitialisation a réussi : l'espace tel que le serveur le rend, et le message à montrer. */
  onDone: (result: RemoteReset, message: string, workspace: Workspace) => void;
};

export function useAttachmentReset(wsId: string, { onPending, onDone }: Options) {
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<Explained | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const confirmId = useId();

  // Focus : la confirmation reçoit le focus à l'ouverture (sur « Annuler », le choix sans effet),
  // et le rend au bouton qui l'a ouverte à la fermeture.
  useEffect(() => {
    if (confirming) cancel.current?.focus();
    else if (restoreFocus.current) {
      restoreFocus.current = false;
      trigger.current?.focus();
    }
  }, [confirming]);

  function close() {
    restoreFocus.current = true;
    setConfirming(false);
    setResetError(null);
  }

  async function run() {
    setResetError(null);
    setResetting(true);
    onPending?.(true);
    try {
      const { reset, ...workspace } = await api.resetRemote(wsId);
      setConfirming(false);
      onDone(reset, reset.status === "nothing_to_do" ? RESET_NOTHING : RESET_DONE, workspace as Workspace);
    } catch (reason) {
      // Le serveur dit lui-même ce qui bloque (gouvernance modifiée, autre branche…), en français.
      setResetError(reason instanceof ApiError && reason.code !== "reset_incomplete"
        ? { title: "La réinitialisation n'a pas abouti", text: reason.message }
        : explain(reason));
    } finally {
      setResetting(false);
      onPending?.(false);
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    event.stopPropagation(); // dans le panneau de création, Échap ne ferme que la confirmation
    if (!resetting) close();
  }

  return { confirming, resetting, resetError, trigger, cancel, confirmId, open: () => setConfirming(true), close, run, onKeyDown };
}

export type AttachmentReset = ReturnType<typeof useAttachmentReset>;

/** Le bouton secondaire qui ouvre la confirmation. */
export function ResetButton({ reset, disabled }: { reset: AttachmentReset; disabled?: boolean }) {
  return (
    <button
      ref={reset.trigger}
      type="button"
      className="btn btn-secondary btn-sm"
      aria-expanded={reset.confirming}
      aria-controls={reset.confirming ? reset.confirmId : undefined}
      disabled={disabled}
      onClick={reset.open}
    >
      Réinitialiser le rattachement
    </button>
  );
}

/** La confirmation en ligne (`alertdialog`), rendue sous le bouton quand elle est ouverte. */
export function ResetConfirmation({ reset }: { reset: AttachmentReset }) {
  if (!reset.confirming) return null;
  const { confirmId, resetting, resetError } = reset;
  return (
    <div
      id={confirmId}
      className="attach-reset"
      role="alertdialog"
      aria-labelledby={`${confirmId}-title`}
      aria-describedby={`${confirmId}-text`}
      onKeyDown={reset.onKeyDown}
    >
      <h3 id={`${confirmId}-title`}>Réinitialiser le rattachement ?</h3>
      <p id={`${confirmId}-text`}>
        Seule la copie locale de l'espace est réinitialisée : elle revient à l'état d'un espace sans dépôt distant, sans perdre aucun de vos commits. Le dépôt distant n'est pas modifié : s'il a gardé une publication partielle, il faudra peut-être le vider avant de le réutiliser.
      </p>
      {resetting && (
        <div className="progress" role="status">
          <span className="progress-bar" aria-hidden="true" />
          Réinitialisation de la copie locale…
        </div>
      )}
      {resetError && (
        <Banner tone="bad" title={resetError.title}>
          {resetError.text}
        </Banner>
      )}
      <div className="attach-reset-actions">
        <button ref={reset.cancel} type="button" className="btn btn-neutral btn-sm" disabled={resetting} onClick={reset.close}>
          Annuler
        </button>
        <button type="button" className="btn btn-danger btn-sm" disabled={resetting} onClick={() => void reset.run()}>
          Confirmer la réinitialisation
        </button>
      </div>
    </div>
  );
}

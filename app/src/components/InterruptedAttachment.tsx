import type { Workspace } from "../api";
import { href } from "../router";
import { Banner } from "./Banner";
import { ResetButton, ResetConfirmation, useAttachmentReset } from "./ResetAttachment";

// Bannière de la coque d'un espace dont le rattachement à un dépôt a été interrompu (plan 0034,
// ADR 0038). Elle se voit de n'importe quel écran et pour tout rôle : après une fusion de l'identité
// du créateur sans écriture au registre, la gouvernance locale ne le désigne plus référent, et
// l'Administration, où vit le bouton du formulaire de rattachement, n'est plus accessible.
// La réinitialisation, elle, n'exige aucun rôle : un espace local n'existe que sur ce poste.

export function InterruptedAttachment({
  ws,
  adminLink,
  onReset,
}: {
  ws: Workspace;
  /** Vrai hors de l'Administration : le référent peut y reprendre le rattachement. */
  adminLink: boolean;
  /** L'espace relu par le serveur : plus de bannière, le rôle de référent est revenu. */
  onReset: (next: Workspace, message: string) => void;
}) {
  const reset = useAttachmentReset(ws.id, { onDone: (_result, message, next) => onReset(next, message) });
  if (ws.attachment !== "interrupted") return null;
  return (
    <>
      <Banner
        tone="warn"
        title="Rattachement interrompu"
        action={
          <span className="banner-actions">
            <ResetButton reset={reset} />
            {adminLink && ws.space_referent === true && (
              <a className="btn btn-neutral btn-sm" href={href.view(ws.id, "administration")}>
                Reprendre le rattachement
              </a>
            )}
          </span>
        }
      >
        Le rattachement de cet espace à un dépôt a été interrompu. Seule votre copie locale est concernée : réinitialisez-le pour repartir d'un espace sans dépôt distant.
      </Banner>
      <ResetConfirmation reset={reset} />
    </>
  );
}

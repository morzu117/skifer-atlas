import { test } from "./isolation";
import { domainWithReferent, leaveConfirmationByKeyboard, platformsByKeyboard, validatorsByKeyboard } from "./ui-administration.gestes";

// Écran 107 sous WebKit, le moteur de la vue Tauri sous macOS (ADR 0030) : les gestes sensibles
// au moteur (cases à la barre d'espace, champs numériques aux flèches, focus et dialogue de
// confirmation) que ui-administration.spec.ts fait sous Chromium, avec le même code.

test("[S-UI-107-06] WebKit : validateurs requis au clavier, plancher à 1, 0 refusé, valeur relue", async ({ page, request }) => {
  await validatorsByKeyboard(page, request);
});

test("[S-UI-107-08] WebKit : plateformes autorisées à la barre d'espace, enregistrées et relues", async ({ page, request }) => {
  await platformsByKeyboard(page, request);
});

// Navigation au clavier reportée par décision du 13 novembre 2026.
test.fixme("[S-UI-107-11] WebKit : confirmation de sortie, focus, Tab enfermé, Échap reste, Entrée quitte", async ({ page, request }) => {
  await leaveConfirmationByKeyboard(page, request);
});

test("[S-UI-107-03] WebKit : « + Domaine » avec référent et validateurs cochés au clavier, relu après enregistrement", async ({ page, request }) => {
  await domainWithReferent(page, request);
});

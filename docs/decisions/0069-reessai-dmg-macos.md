# ADR 0069 — Nouvelle tentative du bundle DMG sous macOS

Date : 2026-11-25 · Statut : **acceptée**

## Contexte

Sur les machines macOS de GitHub, `hdiutil` échoue parfois à détacher une image pendant `bundle_dmg.sh`, ce qui fait échouer la release.

## Décision

Relancer au maximum deux fois le build Tauri sous macOS si sa sortie signale `bundle_dmg.sh`. Avant chaque nouvelle tentative, détacher les images montées associées au dossier DMG du projet, attendre brièvement et émettre un avertissement. Les autres erreurs échouent immédiatement ; les autres systèmes conservent une exécution directe.

## Conséquences

Les pannes passagères peuvent être résolues automatiquement, sans détacher les images d'autres projets. Un échec persistant reste visible et conserve son code de sortie ; les sorties de chaque tentative restent dans le journal.

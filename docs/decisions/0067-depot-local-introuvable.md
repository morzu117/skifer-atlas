# ADR 0067 — Dépôt local introuvable

Date : 2026-11-25 · Statut : **acceptée**

## Contexte

Un espace peut rester enregistré alors que son dépôt local ou son fichier `atlas.yaml` a disparu. Certaines lectures répondaient 404 comme si l'espace était inconnu, d'autres échouaient ou donnaient un résultat trompeur.

## Décision

Pour un espace enregistré, vérifier la présence du dossier et de `atlas.yaml` avant les lectures : `local_repo_missing` répond 409 et demande de les restaurer, sans exposer de chemin. Un espace inconnu reste `not_found` (404). Un dépôt proposé à l'adhésion sans métadonnées reste `invalid_workspace` (422). La liste d'accueil reste disponible : elle lit le registre et tolère les compteurs indisponibles.

À l'écran, l'espace affiche l'alerte « Dossier local introuvable » avec « Réessayer », au lieu du renvoi à l'accueil réservé à un espace inconnu (S-0005-14).

Après une avance rapide de synchronisation, un `atlas.yaml` supprimé par le dépôt distant reste signalé comme `invalid_workspace`.

Le retrait d'un espace enregistré n'existe pas dans l'application ; la restauration convient aussi aux espaces sans distant. Le contrôle ne garantit pas que le dossier ne disparaîtra pas pendant la requête.

# Plan 0015 — Comparaison (10.5)

## Objectif
Depuis l'application, on lance une comparaison chiffrée (KPI, déclinaisons, scope, tolérance) avec ses propres droits, on suit la progression par plateforme, puis on lit la matrice de synthèse, le détail par dimension avec le lien vers le nœud divergent, et l'historique local.

## Périmètre
**Dedans** : panneau de lancement 340 px ; authentification à la demande (`needs_auth` renvoie vers 0016, ou lance l'OAuth en place) ; progression ; matrice KPI × déclinaison ; détail ; bandeau d'historique et liste complète (non maquettée).
**Dehors** : export des résultats ; comparaison planifiée.

## Références
Brief 7.2, 8.3, 8.4, 10.5 ; guide 3.7, 5 (10.5), 7 (historique complet) ; `screens/10.5-comparaison.html` ; plans 0009, 0016.

## Spécification
- **Lancement** : KPI (recherche), déclinaisons (cases avec plateforme), scope (choix parmi les scopes déclarés du KPI, période restreignable), granularité (dimensions du scope), tolérance (curseur, valeurs globale et KPI affichées). Bandeau orange si une déclinaison bypasse un contrôle de cardinalité, en citant le nœud. « Lancer la comparaison », puis « Relancer ».
- **Progression** : une barre teal par plateforme (`état`, %), annulation. Mention permanente : « Exécutée avec vos droits · résultats agrégés uniquement · historique local (DuckDB, espace X) ».
- **Synthèse** : matrice des dernières comparaisons (`…/comparisons/matrix`), cellules `--atlas-pale` / `--atlas-warn-cell` / `--atlas-bad-cell` selon des seuils (≥ 99 % / ≥ 90 % / en dessous, seuils dans les tokens ou en constantes nommées), « — » gris si non comparé. Contenu : « % validation » en gras et « écart max » en 11 px. Filtre Domaine.
- **Détail** (clic sur une cellule) : tableau Dimension(s), Canonique, Déclinaison, Écart ; lignes hors tolérance en fond `--atlas-warn-bg`, avec l'écart en `--atlas-bad` et la mention « hors tolérance » ; lien « Nœud divergent : nXX · libellé », qui ouvre la fiche (0012) sur le diff canonique/déclinaison, nœud sélectionné. Valeurs formatées à la restitution uniquement (arrondi d'affichage, locale fr).
- **Historique** : bandeau des trois dernières comparaisons, et « Tout voir » vers une liste filtrable (KPI, date, utilisateur), chaque ligne rouvrant ses résultats.

## Critères d'acceptation
1. Une comparaison locale de démonstration (plateformes DuckDB) se lance, progresse et affiche 94 % / 6,1 % pour Revenu net × DE.
2. Le détail affiche Sept. 2026 hors tolérance, avec le lien vers n02 (filtre statut).
3. Une déclinaison avec bypass affiche le bandeau avant lancement.
4. Sans token valide, l'écran propose de s'authentifier, puis reprend le lancement.
5. Annuler arrête la progression et l'historique montre « annulée ».
6. Les valeurs ne sont arrondies qu'à l'affichage (la valeur exacte est visible en infobulle).
7. L'historique complet liste toutes les comparaisons de l'espace, et seulement celles-ci.

## Tests
- Composants : matrice (seuils et couleurs), détail, panneau de lancement.
- Bout en bout : comparaison entièrement locale.
- À la main : une comparaison réelle sur Databricks (une fois 0008 livré).

## Dépendances
0009, 0010 (0016 pour l'authentification depuis l'écran).

## Estimation
**M**. Incertitudes : seuils de couleur de la matrice, non fixés par le brief (à valider) ; flux d'authentification en place.

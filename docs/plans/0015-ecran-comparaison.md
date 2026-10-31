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

## Mise en œuvre (31 octobre 2026)

- **Cœur** (`core/src/skifer_atlas/`) :
  - `compare/service.py` :
    - `comparison_setup` : déclinaisons avec leur plateforme et la raison pour laquelle l'une d'elles ne se compare pas (`unavailable`), scopes et granularités possibles, tolérances du KPI et de l'espace ;
    - `preview_comparison` : la préparation seule, avec alertes, plans, tolérance et accès manquants ;
    - `missing_access`, partagé avec `check_access` ;
    - `domain_label` dans la matrice ;
  - `compare/orchestrate.py` : le nœud divergent porte son libellé, celui du canonique s'il existe ;
  - `api/routes/comparisons.py` : `GET …/comparisons/setup?kpi=` et `POST …/comparisons/preview` ;
  - `sheet.py` et `api/routes/sheet.py` : `GET …/documents/{id}/canonical-diff`, et 422 `not_a_variant` pour un document qui n'est pas une déclinaison. `labelled_layout` est partagé avec les propositions.
- **Interface** (`app/src/`) :
  - `screens/Comparison.tsx` :
    - le panneau de lancement :
      - déclinaisons non comparables grisées, avec leur raison ;
      - scope, période et granularité, avec un scope ad hoc si l'on restreint ;
      - curseur de tolérance ;
      - aperçu et bandeaux d'alerte ;
      - « Connexion requise » avec OAuth sur place et reprise du lancement ;
      - progression et Annuler ;
    - la matrice : seuils 99 / 90, filtre Domaine ;
    - le détail : lignes hors tolérance, valeur exacte en infobulle, lien « Nœud divergent » ;
    - le bandeau d'historique et la liste complète filtrée (`?vue=historique`) ;
  - `components/DiffColumns.tsx` : le diff deux colonnes de 0014, partagé, avec un nœud sélectionné ;
  - `screens/Fiche.tsx` : « Écarts au canonique » sur une déclinaison, et `?diff=canonique&node=n02` ;
  - `external.ts` : ouverture d'une adresse dans le navigateur du système, avec le plugin shell et la capacité `shell:allow-open` ;
  - `format.ts` :
    - `percent` arrondit, plafonné à 99 % sous 100 ;
    - `gap`, `amount` et `dimension` (« Sept. 2026 ») ;
  - tokens ajoutés : `--atlas-launch-basis`, `--atlas-launch-w`, `--atlas-results-basis`, `--atlas-progress-h`, `--atlas-matrix-min-w`, `--atlas-matrix-spacing`.

  Les choix que le plan ne fixait pas, ou dont on s'écarte, sont dans l'**ADR 0019** :
  - `setup` et `preview` ;
  - les déclinaisons non comparables décochées ;
  - le KPI en liste ;
  - une `calendar_period` non restreignable ;
  - la tolérance envoyée seulement si on l'a touchée ;
  - les seuils en constantes nommées ;
  - l'arrondi du % ;
  - l'OAuth sur place ;
  - le diff au canonique sur la fiche ;
  - l'historique de 500 entrées filtré côté client.
- **Tests** :
  - `core/tests/repo/test_comparison_screen.py` (5 tests) :
    - `setup` : trois déclinaisons, dont nordis-es non comparable, granularités et tolérances ;
    - aperçu sans exécution : surcharge hors points sur DE, puis bypass de cardinalité sur DE et FR après modification de la jointure, et toujours aucun historique (critère 3) ;
    - accès manquants (critère 4) ;
    - nœud divergent « Factures validées », septembre DE à 6,1 % hors tolérance, matrice à 94 % / 6,1 % (critères 1 et 2) ;
    - diff au canonique et `not_a_variant`.
  - Vitest, `npm test`, 109 tests. Nouveau : `screens/Comparison.test.tsx` (7 tests) :
    - seuils ;
    - matrice : couleurs, « non comparé », filtre Domaine (critère 1) ;
    - détail : hors tolérance, valeur exacte en `title`, lien vers n02 (critères 2 et 6) ;
    - panneau : nordis-es grisée, bandeau de bypass avant lancement, scope ad hoc et tolérance (critère 3) ;
    - `needs_auth`, connexion, relecture du statut, reprise du lancement (critère 4) ;
    - progression, Annuler, « annulée » (critère 5) ;
    - historique filtré (critère 7).

    Deux tests de fiche couvrent le diff au canonique, avec le nœud sélectionné.
  - Playwright, `npm run e2e`, `e2e/comparaison.spec.ts` (3 tests), entièrement local :
    - lancement, progression, 94 % / 6,1 % sur Revenu net × DE ;
    - détail : Sept. 2026 hors tolérance, puis le lien ouvre la fiche sur n02, entouré et visible ;
    - « Tout voir » et filtres.

    axe-core passe à chaque étape.
- **Reste à faire** :
  - une comparaison réelle sur Databricks depuis l'écran, à la main ;
  - vérification à la main sous Tauri, notamment l'ouverture du navigateur ;
  - valider les seuils 99 / 90 ;
  - export et comparaisons planifiées (hors périmètre).

# ADR 0019 — Écran de comparaison

Date : 2026-10-31 · Statut : **acceptée** (mise en œuvre du plan 0015)

## Contexte

Le plan 0015 fait de l'écran 10.5 le lieu des comparaisons chiffrées :
- un panneau de lancement ;
- la progression par plateforme ;
- la matrice de synthèse et le détail par dimension ;
- l'historique local.

Le moteur, le stockage DuckDB et les routes viennent du plan 0009. Plusieurs points restent ouverts :
- ce que le panneau doit savoir avant de lancer ;
- les seuils de couleur de la matrice ;
- l'authentification depuis l'écran ;
- le lien vers le nœud divergent ;
- la forme de l'historique complet.

## Décision

- **`GET …/comparisons/setup?kpi=`** remplit le panneau en un appel :
  - les déclinaisons, chacune avec sa plateforme et `unavailable`, qui vaut `null` ou la raison pour laquelle la déclinaison ne se compare pas ;
  - les scopes déclarés, avec leurs granularités possibles : tous les sous-ensembles ordonnés des dimensions du scope, les plus fins d'abord ;
  - la tolérance du KPI et celle de l'espace.

  `unavailable` vient d'une préparation à blanc de chaque déclinaison seule, sur le premier scope. Il couvre une déclinaison :
  - en retard sur le canonique ;
  - qui ne se résout pas ;
  - que le canonique ne peut pas lire (`canonical_not_rebindable`, comme nordis-es) ;
  - sans point d'accès.

  Une telle déclinaison n'est pas cochée, sa case est grisée et la raison s'affiche sous elle. Sans cela, nordis-es, cochée par défaut, bloquait tout le lancement.
- **`POST …/comparisons/preview`** prend le corps du lancement et rend, sans rien exécuter ni enregistrer :
  - les alertes : bypass de cardinalité, surcharge hors points déclarés ;
  - la plateforme et le point d'accès de chaque déclinaison ;
  - la tolérance retenue et la granularité ;
  - les accès qui me manquent.

  Le panneau l'appelle 200 ms après chaque changement. Les bandeaux orange apparaissent donc avant le lancement (critère 3).
- **Scope.** Un scope déclaré tel quel part en `scope_id`. Une période restreinte ou une granularité plus grossière part en `scope` ad hoc, avec le périmètre du scope déclaré. Une période `calendar_period` (FY2026_Q4) n'est pas restreignable : le moteur ne découpe pas une période de calendrier.
- **Tolérance.** Le curseur va de 0 à 5 % et affiche la valeur globale et celle du KPI. La tolérance ne part dans la requête que si on l'a touchée : sinon le serveur applique sa règle (KPI, puis espace, puis 1 %).
- **KPI** : une liste déroulante des KPI déclinés, et non une recherche. Elle tient en quelques lignes par espace ; la recherche viendra si la liste grandit.
- **Authentification sur place.** Un accès manquant, connu par l'aperçu ou par un 409 `needs_auth`, ouvre le bandeau « Connexion requise ». Il propose un bouton « Se connecter à … » par point d'accès et un lien vers Mes connexions (0016). Le bouton :
  1. lance l'OAuth du plan 0008 (`…/authorize`) ;
  2. ouvre l'adresse dans le navigateur du système (`shell:allow-open`, ajouté aux capacités Tauri) ;
  3. relit `…/status` chaque seconde.

  Quand tous les accès sont connectés, le lancement demandé reprend de lui-même (critère 4). Jamais de champ de token (guide 10.6).
- **Progression** : une barre par plateforme, d'après le plan de l'aperçu, mise à jour par `GET …/comparisons/{n}` toutes les 400 ms. En exécution locale (`ATLAS_COMPARE_DATA`), la barre porte la plateforme déclarée de la déclinaison (Databricks), et non DuckDB : c'est celle qui servira en vrai.
- **Seuils de la matrice** : 99 % et plus en `--atlas-pale`, 90 % et plus en `--atlas-warn-cell`, en dessous en `--atlas-bad-cell`. Ce sont des constantes nommées (`PASS_THRESHOLD`, `WARN_THRESHOLD`, dans `Comparison.tsx`) : le brief ne les fixe pas et elles restent à valider.
- **Arrondi du %.** `percent()` arrondit désormais au plus proche (93,75 donne 94 %, comme la maquette), au lieu de tronquer. Il plafonne à 99 % tant que la valeur n'est pas exactement 100 : une validation incomplète ne s'affiche jamais « 100 % ».
- **Cellule de matrice.** C'est un lien vers `?id=…&variant=…`, avec `aria-current` sur la cellule ouverte. Son nom accessible commence par le KPI et la déclinaison, puis reprend le texte visible : « Revenu net × nordis-de : 94 % de validation, écart max 6,1 % ». Les mots ajoutés sont en `sr-only`, et non dans un `aria-label`, pour que le nom contienne le texte affiché (WCAG 2.5.3).
- **Valeurs exactes.** Le détail formate canonique, déclinaison et écart en locale fr, et met la valeur exacte en `title` (critère 6). Rien n'est arrondi avant l'affichage.
- **Nœud divergent nommé.** `prepare` (0009) ajoute au nœud divergent son libellé, celui du canonique s'il existe. L'information est stockée avec les synthèses. Le lien « Nœud divergent : n02 · Factures validées » ouvre la fiche de la déclinaison sur `?diff=canonique&node=n02`.
- **Diff au canonique sur la fiche.** `GET …/documents/{id}/canonical-diff` rend les deux graphes disposés et le rapport de diff 0003. Il répond 422 `not_a_variant` pour un document qui n'est pas une déclinaison. L'onglet Définition d'une déclinaison gagne une section « Écarts au canonique » :
  - fermée, elle offre le lien « Comparer au canonique » ;
  - ouverte, elle montre le nœud demandé, entouré (`is-selected`) et amené dans la zone visible.

  Le diff deux colonnes de 0014 devient le composant partagé `DiffColumns`.
- **Historique** : le bandeau montre les trois dernières comparaisons, et « Tout voir » ouvre `?vue=historique`. Cette vue charge les 500 dernières comparaisons de l'espace et les filtre côté client, par KPI, utilisateur et « Depuis le ». Les filtres sont dans l'adresse. L'historique est celui de l'index local de l'espace : il ne montre que ses comparaisons (critère 7).
- **Synthèse rechargée sans clignoter.** Après une comparaison, la matrice et le bandeau se relisent en gardant l'affichage précédent. Sinon le panneau de lancement, qui dépend de la liste des KPI, se démontait et perdait « Relancer ».

## Conséquences

- `setup` prépare chaque déclinaison une fois, sans requête. Son coût croît avec le nombre de déclinaisons du KPI. Il n'a pas été mesuré au-delà de la démonstration.
- Une déclinaison qui ne se prépare que sur un autre scope que le premier est marquée non comparable. Aucun KPI de la démonstration n'est dans ce cas.
- L'export des résultats et les comparaisons planifiées restent hors périmètre.
- La comparaison réelle sur Databricks depuis l'écran n'a pas été faite à la main. Elle passe par le même chemin que la comparaison locale, aux points d'accès près.

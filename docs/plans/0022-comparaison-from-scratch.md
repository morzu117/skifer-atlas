# Plan 0022 — Comparer une déclinaison from scratch

## Objectif
Une déclinaison `from_scratch` comme Nordis ES se compare au canonique. Le canonique se rebranche sur ses sources dès que ses colonnes s'y retrouvent par `binding`. ES obtient un vrai pourcentage de conformité à côté de FR et DE, au lieu de `canonical_not_rebindable`.

## Périmètre
**Dedans** :
- le rebranchement `from_scratch` de `compare/rebind.py` : correspondance des colonnes par attribut de concept, colonnes réellement lues, types compatibles, sources communes ;
- un message `canonical_not_rebindable` qui liste les colonnes manquantes et dit quoi rattacher ;
- les données de démonstration de Nordis ES : source, `binding`, concept Commande, fichiers CSV de comparaison ;
- les tests (cœur, API, écran) et le scénario de bout en bout de la comparaison.

**Dehors** :
- la correspondance de valeurs (un statut `cerrada` n'est pas traduit en `validée`) ;
- les conversions de type implicites (un `timestamp` ne devient pas une `date`) ;
- un nouveau format YAML : `binding` existe déjà dans le modèle (plan 0001).

## Références
Brief 4.2 ; analyse Q11 ; plans 0001, 0003, 0007, 0009, 0015 ; ADR 0012 (« Conséquences » : Nordis ES), ADR 0015.

## Spécification
- **Diagnostic** (état du plan 0009) : la source n01 de Nordis ES n'a pas les colonnes `facture_id`, `statut`, `date_facture`, `montant_ttc`, `montant_taxes` et `avoirs` du canonique. Le moteur exige toutes les colonnes déclarées, même celles qu'aucun nœud ne lit (`facture_id`). Il ne retrouve une colonne par son attribut que si le canonique la rattache explicitement. La date de référence (n06) n'a, en plus, aucune source ES.
- **Attribut d'une colonne** : celui que lui donne son `binding`, sinon son propre nom. C'est la convention du diff (plan 0003), appliquée aux deux côtés. Une colonne du canonique se retrouve dans la source candidate par cet attribut, sinon par son nom.
- **Types** : identiques, ou `integer` là où le canonique attend `decimal` ou `double`. Cet élargissement est sans perte. Rien d'autre : pas de `timestamp` pour une `date` (conversion de fuseau implicite).
- **Colonnes nécessaires** :
  - celles que le graphe du canonique lit : leur retrait fait échouer la propagation des colonnes ;
  - celles que le canonique rattache au concept : le scope filtre et regroupe sur elles.

  Une autre colonne introuvable est retirée de la source rebranchée.
- **Source commune** : une source du canonique dont le concept n'a aucune source dans la déclinaison garde sa table. Elle est lue sur la plateforme de la déclinaison, comme les sources non surchargées en mode `override`. Au moins une source doit être rebranchée, sinon `canonical_not_rebindable`.
- **Refus** : `canonical_not_rebindable`, « colonnes de n01 introuvables dans <table> ou d'un autre type : avoirs ; les rattacher au concept « commande » par un binding ». Un type incompatible est précisé : « montant_taxes (decimal attendu, string dans iva) ».
- **Démonstration** :
  - la source ES `FINANZAS.PUBLIC.FACTURAS` déclare aussi `estado_grupo`, `fecha_factura`, `importe_bruto`, `iva` et `abonos`, rattachés par `binding` à `statut`, `date_facture`, `montant_ttc`, `montant_taxes` et `avoirs` ;
  - le concept Commande déclare ces attributs ;
  - le graphe d'ES ne change pas ;
  - `core/tests/fixtures/compare/revenu-net/nordis-es/` contient les factures et les jours comptables. Une facture du 30 juin, clôturée après minuit à Madrid, compte en juin pour le canonique et en juillet pour ES.

## Critères d'acceptation
1. Une comparaison de Revenu net sur FR, DE et ES s'exécute en local dans DuckDB. ES obtient 75 % de validation sur 8 cellules, avec un écart maximal de 2,93 % (juin et juillet). DE reste à 94 % et FR à 100 %.
2. Une déclinaison dont la source n'a vraiment pas une colonne lue par le canonique est refusée avec `canonical_not_rebindable`, et le message liste la colonne (`avoirs`).
3. Une colonne lue d'un autre type est nommée avec les deux types. Un entier se lit là où le canonique attend un décimal.
4. Une colonne que rien ne lit peut manquer (`facture_id`). Une colonne rattachée au concept, non (`commande_id`).
5. La date de référence, sans source ES, reste une source commune lue sur Snowflake. Une déclinaison qui ne partage aucun concept avec le canonique est refusée.
6. L'écran de comparaison propose nordis-es, cochée, et la matrice l'affiche à 75 %.

## Tests
- `core/tests/compare/test_compare.py` : critères 1 à 5, et la CLI sur une source sans `abonos`.
- `core/tests/repo/test_comparisons_api.py` : ES par l'API (75 %) ; 422 `canonical_not_rebindable` qui nomme `avoirs`.
- `core/tests/repo/test_comparison_screen.py` : aucune déclinaison indisponible.
- Playwright, `app/e2e/comparaison.spec.ts` : nordis-es cochée, barre Snowflake, matrice et historique (critère 6).

## Dépendances
0009, 0015, 0018.

## Estimation
**S**. Incertitude : les tables communes doivent exister sur la plateforme de la déclinaison. Sinon, la requête du canonique échoue à l'exécution.

## Mise en œuvre (31 octobre 2026)

Décisions : [ADR 0026](../decisions/0026-comparaison-from-scratch.md). L'ADR 0012 y renvoie depuis sa conséquence sur Nordis ES.

- **Diagnostic** : Nordis ES était refusée sur `facture_id`, `statut`, `date_facture`, `montant_ttc`, `montant_taxes` et `avoirs`.
  - `facture_id` n'est lue par aucun nœud : le moteur était trop strict.
  - `statut` est un attribut de Commande, mais le canonique ne le rattache pas par `binding` : le moteur ne le cherchait que par son nom.
  - Les quatre autres manquaient vraiment dans la table espagnole.
  - Une fois n01 rebranchée, n06 (Date de référence, sans source ES) aurait bloqué à son tour.
- **Cœur** (`core/src/skifer_atlas/compare/rebind.py`) :
  - attribut d'une colonne : son `binding`, sinon son nom, des deux côtés ;
  - colonnes nécessaires : lues par le graphe (retrait testé par `propagate`) ou rattachées au concept ; les autres, introuvables, sont retirées de la source rebranchée ;
  - `compatible` : types égaux, ou `integer` pour `decimal` et `double` (`WIDENING`) ;
  - source commune pour un concept sans source dans la déclinaison, lue sur sa plateforme (`Rebound.common`) ; refus si aucune source n'est rebranchée ;
  - message de refus : table candidate, colonnes manquantes, types attendus et lus, invitation à rattacher par `binding`.
- **Démonstration** :
  - `examples/espace-nordis/variants/revenu-net/nordis-es.yaml` : cinq colonnes et leur `binding` ; graphe inchangé ;
  - `examples/espace-nordis/concepts/commande.yaml` : attributs `date_facture`, `montant_ttc`, `montant_taxes`, `avoirs` ;
  - `core/tests/fixtures/compare/revenu-net/nordis-es/` (nouveau) : `FINANZAS.PUBLIC.FACTURAS.csv` et `gold.finance.dim_date.csv` ;
  - résultat : FR 100 %, DE 93,75 % (piste n02), ES 75 % sur 8 cellules, écart maximal 2,93 % (juin -2,86 %, juillet +2,93 %).
- **Tests** : 776 réussis, 4 ignorés (`uv run pytest -q`) ; `ruff` propre.
  - `core/tests/compare/test_compare.py` : le test du refus d'ES devient six tests :
    - FR, DE et ES ensemble, avec le SQL et les colonnes de la source rebranchée (critère 1) ;
    - source commune (critère 5) ;
    - colonne manquante listée (critère 2) ;
    - colonne non lue ou rattachée (critère 4) ;
    - type incompatible nommé, entier élargi (critère 3) ;
    - aucun concept partagé (critère 5).

    La CLI échoue désormais sur une source sans `abonos`.
  - `core/tests/repo/test_comparisons_api.py` : ES par l'API à 75 % ; le 422 `canonical_not_rebindable` passe par une copie sans `abonos` et nomme `avoirs`.
  - `core/tests/repo/test_comparison_screen.py` : plus aucune déclinaison indisponible.
  - Playwright, `app/e2e/comparaison.spec.ts` : nordis-es cochée, barre « Snowflake · nordis-es », lien de matrice à 75 % / 2,9 %, historique « nordis-de 94 % · nordis-es 75 % · nordis-fr 100 % » (critère 6). Non relancé ici : ports fixes.
  - Vitest, `npm test` : 136 tests, inchangés. Le serveur simulé garde une déclinaison non comparable, cas que l'écran sait toujours afficher.
- **Reste à faire** :
  - relancer `npm run e2e` (scénario de comparaison modifié) ;
  - une comparaison réelle d'ES sur Snowflake, avec la table commune des jours comptables sur ce compte (compte Snowflake reporté, plan 0018) ;
  - la correspondance de valeurs entre vocabulaires locaux et du groupe, hors périmètre : aujourd'hui, la source doit porter la colonne du groupe ;
  - signaler à l'écran les sources communes d'une comparaison (`Rebound.common` n'est pas encore exposé).

Plans spec-driven, un par fichier, numérotés (voir docs/KICKOFF.md). Analyse préalable : `docs/analysis.md`.

Statut : plans validés le 30 octobre 2026, développement lancé par le plan 0001.

| Plan | Titre | Livrable observable | Dépend de | Taille |
|---|---|---|---|---|
| 0001 | Modèle des dix nœuds et YAML versionné | `atlas validate`, `atlas schema` | — | M |
| 0002 | Validation de graphe, variantes, normalisation | `atlas check / resolve / normalize / fingerprint` | 0001 | M |
| 0003 | Diff structurel et classification | `atlas diff` | 0001, 0002 | L |
| 0004 | Extraction SQL → graphe | `atlas extract`, démo extraction + diff | 0001–0003 | L |
| 0005 | Espaces, dépôt Git, catalogue indexé | API catalogue, versions, dépendances | 0001, 0002 | M |
| 0006 | Propositions et gouvernance | API propositions (branche + PR), décompte des validations | 0003, 0005 | L |
| 0007 | Compilation SQL multi-dialecte | `atlas compile`, `atlas run` (DuckDB) | 0001, 0002 | L |
| 0008 | Coffre de secrets et connecteur Databricks | API connexions, OAuth, test, requête agrégée | 0005 | L |
| 0009 | Comparaison chiffrée et historique DuckDB | `atlas compare`, API comparaisons | 0003, 0007, 0008 | L |
| 0010 | Coque, accueil des espaces (10.0) | app : accueil, création, adhésion | 0005 | M |
| 0011 | Catalogue (10.1) | app : catalogue réel | 0010 | S |
| 0012 | Fiche KPI (10.2) | app : fiche, versions, diff | 0011, 0003, 0004, 0009 | M |
| 0013 | Éditeur de graphe (10.3) | app : édition et soumission | 0012, 0002, 0006, 0007 | L |
| 0014 | Propositions (10.4) | app : revue, approbation, fusion | 0006, 0012 | L |
| 0015 | Comparaison (10.5) | app : lancement, matrice, détail | 0009, 0010 | M |
| 0016 | Connexions (10.6) | app : connexions personnelles | 0008, 0010 | S |
| 0017 | Administration (10.7) | app : gouvernance par proposition | 0006, 0010 | M |
| 0018 | Connecteur Snowflake | comparaison Databricks × Snowflake | 0008, 0009 | M |
| 0019 | Packaging sidecar et build release | installateurs signés, tests de fumée | 0008, 0018 | M |

**Chemin critique** : 0001 → 0002 → 0003 → 0005 → 0006 → 0010 → 0011 → 0012 → 0013 → 0014. La branche « chiffrée » 0007 → 0008 → 0009 → 0018 peut avancer en parallèle dès 0002, et l'extraction 0004 dès 0003.

**Écarts par rapport à l'ordre suggéré par le KICKOFF** : l'extraction (0004) passe avant les espaces Git, parce qu'elle ne dépend que du cœur et donne tout de suite une démonstration `extract` + `diff` sur du SQL réel ; la compilation (0007) passe avant le coffre et le connecteur, parce qu'elle se teste entièrement sur DuckDB ; le test de fumée du binaire figé arrive dès 0008, sans attendre le plan de packaging.

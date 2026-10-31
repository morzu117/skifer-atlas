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
| 0020 | Tags des versions fusionnées hors d'Atlas | `sync` qui tague les fusions faites sur GitHub | 0005, 0006 | S |
| 0022 | Comparer une déclinaison from scratch | Nordis ES comparée à côté de FR et DE | 0009, 0015, 0018 | S |
| 0023 | Administration : retraits et rôles multiples | app : retirer un membre ou un domaine, plusieurs rôles par membre | 0017 | S |
| 0025 | Jeton GitHub au coffre | device flow, jeton rangé par espace, dépôts privés | 0006, 0008, 0016 | M |

**Chemin critique** : 0001 → 0002 → 0003 → 0005 → 0006 → 0010 → 0011 → 0012 → 0013 → 0014. La branche « chiffrée » 0007 → 0008 → 0009 → 0018 peut avancer en parallèle dès 0002, et l'extraction 0004 dès 0003.

**Écarts par rapport à l'ordre suggéré par le KICKOFF** : l'extraction (0004) passe avant les espaces Git, parce qu'elle ne dépend que du cœur et donne tout de suite une démonstration `extract` + `diff` sur du SQL réel ; la compilation (0007) passe avant le coffre et le connecteur, parce qu'elle se teste entièrement sur DuckDB ; le test de fumée du binaire figé arrive dès 0008, sans attendre le plan de packaging.

## Reste à faire

Mise à jour le 31 octobre 2026, après le plan 0019. Cette liste regroupe les « Reste à faire » des sections « Mise en œuvre » des plans, sans ce que les plans suivants ont livré. Une ligne se retire quand elle est faite, avec le plan ou l'ADR qui la règle.

**Comptes et certificats** (bloquent une vérification réelle) :
- Certificats Apple Developer ID et Windows à obtenir, puis à poser en secrets du dépôt. Vérifier ensuite la signature, la notarisation, Gatekeeper et SmartScreen au premier tag (0019, critère 1).
- Espace Databricks de test, pour :
  - l'OAuth réel et la requête agrégée (0008) ;
  - une comparaison réelle, depuis l'API puis depuis l'écran (0009, 0015, 0016) ;
  - l'exécution à la main du SQL Databricks généré (0007).
- Compte Snowflake, pour :
  - le test réel, avec le SSO du fournisseur d'identité d'un client pilote (0018, critère 1) ;
  - le mécanisme d'échec Snowflake (0007) ;
  - les ajustements de compilation qu'ils révéleraient.
- Dépôt GitHub de test : l'enregistrement réel de la gouvernance avec la règle Code Owners (0017).

**Vérifications à la main** :
- Installation sur un poste vierge de chaque OS, puis le parcours accueil → catalogue → fiche (0019).
- Sous Tauri :
  - création, ouverture et bascule entre deux espaces (0010) ;
  - recherche avec accents et navigation au clavier du catalogue (0011) ;
  - fiche (0012) ;
  - éditeur (0013) ;
  - propositions (0014) ;
  - comparaison et ouverture du navigateur (0015) ;
  - retour OAuth (0016).
- Keyring et connecteurs figés sous Windows (0008, 0018). La CI couvre `_selftest` et les tests du binaire ; un poste réel reste à faire.
- Extraction d'un vrai script de production anonymisé (0004).
- Relecture d'un diff from scratch (0014).

**Relectures produit** :
- Fiche KPI, dont la maquette est à retravailler (0012).
- Session d'édition avec un utilisateur métier (0013).
- Seuils de comparaison 99 / 90 (0015).
- Libellés de l'administration, avec un référent (0017).

**Développement** :
- Poser le tag au `sync` quand une PR a été fusionnée directement sur GitHub (0006, ADR 0009).
- Ranger le jeton GitHub au coffre au lieu de `ATLAS_GITHUB_TOKEN` (0006).
- Route de révision d'une proposition, si l'écran en a besoin (0006).
- Écarts de compilation connus (ADR 0010) : division, `WEEK_START` de Snowflake, garde sur une sortie vide (0007).
- `binding` ou source commune, pour que Nordis ES se compare en from scratch (0009, ADR 0012).
- Rendu de React Flow au-delà de 50 nœuds (0013).
- Administration : retirer un membre ou un domaine, membres aux rôles multiples (0017).

**Hors périmètre, à décider** :
- Linux : binaire, Secret Service, installateur (0008, 0018, 0019).
- Mise à jour automatique et canal de distribution (0019).
- Notifications (0014).
- Export et comparaisons planifiées (0015).

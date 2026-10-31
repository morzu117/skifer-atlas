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
| 0021 | Écarts de compilation entre moteurs | même résultat sur les trois dialectes : division, semaine, garde | 0007, 0018 | S |
| 0022 | Comparer une déclinaison from scratch | Nordis ES comparée à côté de FR et DE | 0009, 0015, 0018 | S |
| 0023 | Administration : retraits et rôles multiples | app : retirer un membre ou un domaine, plusieurs rôles par membre | 0017 | S |
| 0024 | Graphes volumineux dans l'éditeur | rendu fluide au-delà de 50 nœuds | 0013 | S |
| 0025 | Jeton GitHub au coffre | device flow, jeton rangé par espace, dépôts privés | 0006, 0008, 0016 | M |
| 0026 | Parcours WebKit de bout en bout | parcours 0010–0016, graphe de 200 nœuds et axe sous WebKit | 0010–0016, 0024 | S |

**Chemin critique** : 0001 → 0002 → 0003 → 0005 → 0006 → 0010 → 0011 → 0012 → 0013 → 0014. La branche « chiffrée » 0007 → 0008 → 0009 → 0018 peut avancer en parallèle dès 0002, et l'extraction 0004 dès 0003.

**Écarts par rapport à l'ordre suggéré par le KICKOFF** : l'extraction (0004) passe avant les espaces Git, parce qu'elle ne dépend que du cœur et donne tout de suite une démonstration `extract` + `diff` sur du SQL réel ; la compilation (0007) passe avant le coffre et le connecteur, parce qu'elle se teste entièrement sur DuckDB ; le test de fumée du binaire figé arrive dès 0008, sans attendre le plan de packaging.

## Reste à faire

Mise à jour le 31 octobre 2026, après les plans 0019 à 0026. Cette liste regroupe les « Reste à faire » des sections « Mise en œuvre » des plans, sans ce que les plans suivants ont livré. Une ligne se retire quand elle est faite, avec le plan ou l'ADR qui la règle (voir « Réglé » en fin de liste).

**Comptes et certificats** (bloquent une vérification réelle) :
- Certificats Apple Developer ID et Windows à obtenir, puis à poser en secrets du dépôt. Vérifier ensuite la signature, la notarisation, Gatekeeper et SmartScreen au premier tag (0019, critère 1).
- Client OAuth « Skifer Atlas » à créer sur GitHub, avec le device flow activé, puis `ATLAS_GITHUB_CLIENT_ID` à poser dans la build de release. C'est un identifiant public, pas un secret (0025).
- Espace Databricks de test, pour :
  - l'OAuth réel et la requête agrégée (0008) ;
  - une comparaison réelle, depuis l'API puis depuis l'écran (0009, 0015, 0016) ;
  - l'exécution à la main du SQL Databricks généré, avec les règles de l'ADR 0025 : division, semaine, garde (0007, 0021).
- Compte Snowflake, pour :
  - le test réel, avec le SSO du fournisseur d'identité d'un client pilote (0018, critère 1) ;
  - le mécanisme d'échec Snowflake et les règles de l'ADR 0025 (0007, 0021) ;
  - une comparaison réelle de Nordis ES, avec la table commune des jours comptables sur ce compte (0022) ;
  - les ajustements de compilation qu'ils révéleraient.
- Dépôt GitHub de test, pour :
  - l'enregistrement réel de la gouvernance avec la règle Code Owners (0017) ;
  - le tag posé au `sync` après une fusion faite dans l'interface de GitHub (0020) ;
  - la connexion par le device flow et l'adhésion à un dépôt privé (0025).

**Vérifications à la main** :
- Installation sur un poste vierge de chaque OS, puis le parcours accueil → catalogue → fiche (0019).
- Dans l'app Tauri installée, ce que les parcours WebKit du plan 0026 n'exercent pas : fenêtre native, ouverture du navigateur système par le plugin shell (0015, 0016), démarrage et arrêt du sidecar empaqueté, trousseau système. Un graphe réel d'une centaine de nœuds (0024).
- Keyring et connecteurs figés sous Windows (0008, 0018). La CI couvre `_selftest` et les tests du binaire ; un poste réel reste à faire.
- Extraction d'un vrai script de production anonymisé (0004).
- Relecture d'un diff from scratch (0014).

**Relectures produit** :
- Fiche KPI, dont la maquette est à retravailler (0012).
- Session d'édition avec un utilisateur métier (0013), qui dira aussi si le seuil de 50 nœuds (rendu des seules cartes visibles) gêne (0024).
- Seuils de comparaison 99 / 90 (0015).
- Libellés de l'administration, avec un référent (0017, 0023).
- Attributs ajoutés au concept Commande de la démonstration sans changer sa version, pour la comparaison de Nordis ES (0022).

**Développement** :
- Route de révision d'une proposition, si l'écran en a besoin (0006).
- Autres paramètres de session : fuseau de Databricks, `TIMESTAMP_TYPE_MAPPING` de Snowflake pour `CAST(… AS TIMESTAMP)` (0021).
- Afficher à l'écran les sources communes d'une comparaison : `Rebound.common` n'est pas encore exposé (0022).
- Onglets de la fiche au clavier sous WebKit macOS : Tab seul ne passe pas par les liens (⌥Tab, ou réglage macOS). Deux pistes : des boutons à la place des liens, ou l'option WKWebView qui fait passer Tab par les liens (0026, ADR 0030).

**Hors périmètre, à décider** :
- Linux : binaire, Secret Service, installateur (0008, 0018, 0019).
- Mise à jour automatique et canal de distribution (0019).
- Notifications (0014).
- Export et comparaisons planifiées (0015).
- Correspondance de valeurs entre vocabulaires locaux et du groupe : aujourd'hui, la source porte la colonne du groupe (0022).
- Rafraîchissement des jetons GitHub à durée limitée (0025).

**Réglé** depuis la mise à jour précédente :
- Parcours des plans 0010 à 0016 et graphe de 200 nœuds sous WebKit, le moteur de Tauri macOS, avec axe : plan 0026, ADR 0030.
- Test instable de `test_snowflake_compare.py` : une vraie course dans `get_comparison`, qui pouvait lire « interrupted » une comparaison en train de se terminer. Corrigée, avec un test dédié.
- Tag posé au `sync` après une fusion faite sur GitHub : plan 0020, ADR 0024.
- Écarts de compilation (division, `WEEK_START`, garde sur une sortie vide) : plan 0021, ADR 0025.
- Nordis ES comparée en from scratch : plan 0022, ADR 0026.
- Administration, retraits et rôles multiples : plan 0023, ADR 0027.
- Rendu de React Flow au-delà de 50 nœuds : plan 0024, ADR 0028.
- Jeton GitHub au coffre : plan 0025, ADR 0029.

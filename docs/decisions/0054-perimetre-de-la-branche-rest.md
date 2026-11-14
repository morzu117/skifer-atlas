# ADR 0054 — Périmètre de la branche points d'accès REST : cœur et CLI, sans génération

Date : 2026-11-07 · Statut : **proposée** (branche points d'accès REST, plan 0036)

## Contexte

Le design du 2026-11-07, écrit par droplet pour le fonds, proposait deux choses dans une même branche :
- des points d'accès REST ;
- une génération optionnelle de la couche sémantique (`atlas generate`), exécutable sans le moteur Skifer.

Le propriétaire a tranché (réponses 3 et 4) :
- **Cœur et CLI seulement.** L'écran Connexions vient dans un plan suivant, une fois le modèle stabilisé.
- **Skifer est obligatoire.** Pas de commande `atlas generate`, pas d'artefact autonome. Le contrôle nocturne du fonds lance `atlas compare` lui-même.

## Décision

- **Construction : gpt-ops**, sur une branche issue de celle-ci, après approbation des ADR par le propriétaire (décision du propriétaire, 91871).

- **La branche se réduit au point d'accès REST.** Elle couvre :
  - le modèle du point (0050) et les jeux de données (0051) ;
  - le choix du runner (0052) et la clé (0053) ;
  - les budgets, le registre d'usage et le cache Parquet ;
  - la CLI.
- **Aucun écran dans cette branche.** La saisie de la clé et l'affichage des budgets viennent dans un plan suivant, qui prolongera l'ADR 0020.
- **Aucune génération dans cette branche.** Skifer reste une dépendance obligatoire d'Atlas (réponse 4, maintenue en 91871).
- **La scission de Skifer en un cœur et des briques est une décision distincte et ultérieure du propriétaire** (91871 : « pas maintenant »). Cette branche ne la prépare pas et ne lui promet rien.
  - Constat revérifié à HEAD (8191997) : Atlas n'importe que deux modules de Skifer, `skifer.core.op_catalog` (`model/nodes.py:28`, `editor.py:26`) et `skifer.analyzer.frontends` (`extract/parse.py:15`).
  - Atlas n'a aucun mécanisme de greffon : ni groupe `entry_points` ni registre ; seuls `atlas` et `skifer-atlas-server` figurent dans `[project.scripts]` (`core/pyproject.toml:22-24`). Cette branche n'en ajoute pas.

## Conséquences

- Le contrôle nocturne du fonds installe Atlas et lance `atlas compare` avec un point d'accès `rest`. Sur un serveur sans D-Bus, la clé est lue dans l'environnement (0053).
- Toute génération future, ou la scission de Skifer, fera l'objet de ses propres ADR et plan, décidés par le propriétaire.
- Rien dans cette branche ne change le format des documents : `schema_version` reste à 1 (0050).

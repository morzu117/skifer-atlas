# ADR 0017 — Éditeur de graphe

Date : 2026-10-30 · Statut : **acceptée** (mise en œuvre du plan 0013)

## Contexte

Le plan 0013 fait de l'écran 10.3 un éditeur de DAG où le YAML reste le pivot. Il laisse ouverts plusieurs points :

- l'ajout de `graph.next_id` au schéma ;
- la forme de la validation ;
- l'emplacement des brouillons ;
- le rendu de l'en-tête coloré des nœuds, que le guide 4 prévoit en blanc sur la couleur de famille ;
- la création d'un document neuf ;
- l'écran après la soumission.

Le critère 11 (validation sous 150 ms sur 50 nœuds) a aussi révélé un coût quadratique dans le compilateur.

## Décision

- **Pas de `graph.next_id`.**
  - Le schéma Skifer ne change pas : le YAML reste le format pivot du moteur.
  - Le prochain identifiant vaut 1 + le plus grand des trois numéros suivants :
    - celui du document ;
    - celui des versions taguées de ce document ;
    - le plus haut déjà attribué dans le brouillon, conservé avec lui (`highest`).
  - Un identifiant supprimé n'est donc jamais réattribué, ni dans la session, ni d'une version à l'autre. Le critère 1 se lit « hors `next_id` » : sans le champ, la fixture est reproduite telle quelle.
- **Le document circule en JSON, le YAML vient du serveur.**
  - Le client tient le document analysé et lui applique des opérations pures (`editor/model.ts`) : ajout, champ, connexion, retrait, remplacement entier.
  - `POST …/editor/check` rend :
    - le YAML ;
    - les fragments par nœud ;
    - les problèmes ;
    - l'état permanent ;
    - les colonnes de chaque nœud ;
    - le SQL par dialecte.
  - Le YAML sort par `dump_document` quand le document est valide, et dans l'ordre des clés du modèle sinon. Le texte est donc canonique quel que soit l'ordre de saisie.
  - Pour s'aligner sur les fichiers du dépôt :
    - `dump_document` garde les dates en dates ;
    - un bloc qui porte `justification` (une surcharge) ne s'écrit jamais sur une ligne.
- **Validation partielle.**
  - Un document invalide garde les colonnes de ses nœuds valides, et tout nœud dont les entrées sont connues reçoit ses colonnes.
  - Un filtre ou un dédoublonnage incomplet ne change pas les colonnes. Il est remplacé, pour la propagation seulement, par un filtre neutre. Sans cela, oublier `nulls` sur n02 vidait les listes de colonnes de n03 à n05.
  - Les problèmes de la propagation partielle s'ajoutent à ceux du schéma, sans doublon.
- **Dialectes de l'état permanent.** Databricks et Snowflake, ceux de la ligne d'état du plan. Le SQL d'un nœud est sa CTE dans le SQL complet. Seuls les ancêtres de la sortie sont compilés (ADR 0010) : pour un nœud hors de ce chemin, le panneau affiche le SQL complet et le signale.
- **Brouillons et positions** :
  - emplacement : `.atlas/drafts/<id>.json` et `.atlas/layout/<id>.json`, dans le dossier de l'espace, hors dépôt ;
  - contenu du brouillon : le document, les positions, `highest` et la version de base ;
  - enregistrement automatique 800 ms après la dernière modification.

  À la réouverture, le brouillon est repris avec un bandeau. Si la version courante a changé depuis, le bandeau le signale (« La version courante a changé depuis ce brouillon ») et propose de repartir de la nouvelle version.
- **Validation temporisée** à 300 ms. Seule la dernière réponse s'applique.
- **Annuler / rétablir.**
  - Une entrée de la pile regroupe les opérations d'une action, comme un ajout depuis la palette avec sa connexion.
  - La frappe dans un même champ texte se fusionne en une seule entrée.
  - Le retour de la vue YAML est une opération `replace` : il s'annule comme les autres.
- **Sortie du graphe.** Ajouter un nœud au bout de la chaîne en fait la sortie, puisque la sortie suit la chaîne. Le panneau de propriétés permet de la redéfinir.
- **Palette au clic.** Un clic, ou Entrée, ajoute le nœud à droite du nœud sélectionné et l'y relie. Le glisser-déposer reste possible, et le graphe se construit aussi au clavier.
- **Colonnes à cocher dans l'ordre du clic** (`group_by`, clés). L'ordre fait partie du YAML (`[mois_fiscal, entite]` dans la fixture) : un tri alphabétique l'aurait réécrit.
- **En-tête des nœuds en édition.**
  - Le blanc sur la couleur de famille ne passe pas 4,5:1 (3,58:1 sur `--atlas-node-rows`, ADR 0016).
  - L'en-tête est donc blanc, avec le texte en `--atlas-ink`. La famille se lit à deux endroits : un filet de 4 px en haut du nœud (`--atlas-node-band`) et la pastille devant le type.
  - La mini-carte colore les nœuds par famille, à partir des mêmes variables.
- **Plein écran.** L'éditeur occupe la fenêtre, sans la barre latérale de l'espace. Le lien de retour mène à la fiche, à celle du canonique pour une déclinaison, ou au catalogue pour un document neuf.
- **Création d'un document.**
  - « Nouveau concept ou KPI » ouvre un formulaire : type, libellé, identifiant (déduit du libellé tant qu'on ne le modifie pas), propriétaire et domaine.
  - `POST …/editor/documents` répond 409 `document_exists` si un document ou un brouillon porte déjà l'identifiant.
  - Le modèle de départ déclare `semantics` et `entity` à `TODO` : le document est invalide tant qu'on ne les a pas remplis, et les problèmes le disent.
- **Panneau du document.** Il donne l'entité d'un concept (attributs, clé) et la justification d'une déclinaison. Les scopes et la tolérance, rares, s'éditent dans la vue YAML.
- **Soumission.**
  - Le bouton est `aria-disabled` et non `disabled`. Cliqué avec des erreurs, il explique le blocage (« Soumission bloquée : n erreur(s) à corriger ») et ouvre l'onglet Problèmes.
  - La fenêtre récapitule, via `POST …/editor/preview` :
    - la nature de la proposition ;
    - le domaine ;
    - les validations requises ;
    - le diff à la version courante.
  - La justification est obligatoire.
  - Après la création, l'éditeur affiche « Proposition n° X créée » et supprime le brouillon.
- **Mode surcharge.**
  - Le canevas montre le canonique, et la palette et l'outil d'arête sont désactivés.
  - « Remplacer ce nœud » copie le nœud canonique dans `overrides`. « Retirer la surcharge » l'en retire.
  - Un remplacement hors point déclaré affiche le bandeau orange du plan.
- **CodeMirror chargé à la demande.** La vue YAML (CodeMirror 6, `@codemirror/lang-yaml`) est un module séparé de 427 kB. Le paquet principal reste sous le seuil de 500 kB de Vite.
- **Performance du compilateur.**
  - `compile_document` ajoutait chaque CTE par `query.with_(…)`, qui recopie toute la requête : la compilation était quadratique en nombre de nœuds.
  - Avec `copy=False`, le SQL produit est identique (75 tests de compilation inchangés). La validation de 50 nœuds passe de 225 ms à 78 ms (médiane, par l'API).

## Conséquences

- Le schéma Skifer est inchangé. Un document édité dans Atlas est relu tel quel par le moteur, et un fichier écrit à la main se rouvre dans l'éditeur.
- La validation reste côté serveur : le client ne réimplémente aucune règle des plans 0001, 0002 et 0007.
- Le diff d'une proposition (0014) pourra reprendre `preview` et le composant de diff de la fenêtre de soumission.
- Un graphe de plusieurs centaines de nœuds n'a pas été mesuré. La propagation et la compilation restent linéaires, mais le rendu React Flow des formulaires n'a été éprouvé qu'à 50 nœuds.

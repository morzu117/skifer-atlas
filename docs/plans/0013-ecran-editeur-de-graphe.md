# Plan 0013 — Éditeur de graphe (10.3)

## Objectif
On construit ou modifie un concept, un KPI ou une surcharge dans un éditeur de DAG fonctionnel, où le YAML reste le pivot : chaque action produit un YAML valide ou un problème localisé sur un nœud ; « Soumettre la proposition » crée la PR.

## Périmètre
**Dedans** : en-tête, barre d'outils, palette des dix types, canevas React Flow, panneau de propriétés (Propriétés / Entrées / YAML du nœud), panneau bas (Problèmes, Colonnes en sortie, SQL compilé), état permanent de validation, vue « Éditer en YAML » plein écran, annuler/rétablir, disposition automatique, brouillon local, mode surcharge (édition limitée aux remplacements de nœuds), soumission.
**Dehors** : création de domaine ou de point d'accès ; diff de proposition (0014).

## Références
Brief 3.3, 3.5, 3.6, 4.1, 10.3 ; guide 1.2, 3.2, 3.3, 4 (nœud en édition, arêtes), 5 (10.3, tableau des champs par type), 7 (vue YAML non maquettée) ; `screens/10.3-editeur-graphe.html` ; plans 0001, 0002, 0006, 0007.

## Spécification
- **Modèle côté client** : l'état est le document YAML analysé, et le canevas n'est qu'une projection. Chaque modification passe par une opération (`add_node`, `set_field`, `connect`, `remove`…) appliquée au document. La pile d'annulation porte sur ces opérations. Positions du canevas dans un fichier annexe local (`.atlas/layout/<id>.json` dans le dossier de l'espace, hors dépôt), jamais dans le YAML.
- **Validation** : `POST …/validate` (0001 et 0002 ; temporisé à 300 ms, avec le document et l'id du nœud modifié) → problèmes `{severity, node_id, message}`, `columns_at` du nœud sélectionné, compilabilité par dialecte (0007). L'état permanent affiche « Schéma valide · Sans cycle · Compilable Databricks, Snowflake », ou le premier problème.
- **Palette** : les dix types en quatre familles (Entrées, Lignes, Combinaison, Résultat), avec recherche ; glisser-déposer crée un nœud avec un nouvel `id` (plus grand existant + 1, jamais réutilisé dans le document, y compris après suppression : le dernier attribué est conservé dans `graph.next_id`, champ ajouté au schéma par ce plan si l'arbitrage le confirme, sinon calculé depuis les versions précédentes).
- **Nœuds** : rendu exact du guide 4 (184 px, 200 px pour une jointure avec ports « gauche » / « droite », en-tête coloré par famille, étiquette VARIATION, `id` à droite, expression en mono, ligne de métadonnées, avertissement dans le corps). Arêtes `smoothstep` + `ArrowClosed`. Mini-carte, trame de 24 px.
- **Propriétés** : formulaire généré par type, selon le tableau du guide 5 ; champs requis marqués ; clés de jointure choisies dans `columns_at` des deux entrées ; contrôle de cardinalité en radios ; case « Point de variation » sur le canonique ; note « pourquoi ce nœud ». L'onglet YAML du nœud est en lecture et reflète exactement le fragment.
- **Éditer en YAML** : bascule plein écran sur un éditeur de code (CodeMirror 6, sans dépendance réseau) avec la même validation. Retour au canevas autorisé seulement si le YAML est analysable. Pas de vue YAML en parallèle.
- **Mode surcharge** : ouvert depuis une déclinaison. Le canevas montre le canonique en lecture ; seuls les nœuds peuvent être remplacés (Q3). Un remplacement hors point déclaré affiche un bandeau orange : « Hors points déclarés : la validation canonique s'appliquera ». La justification par surcharge est requise.
- **Brouillon local** : enregistrement automatique (« Enregistré il y a n min (local) ») dans le dossier de l'espace, hors dépôt ; reprise proposée à la réouverture.
- **Soumission** : exige zéro erreur. Une fenêtre demande la justification et récapitule le diff (0003) et le nombre de validations requises (0006). « Soumettre la proposition » appelle `POST …/proposals`.

## Critères d'acceptation
1. Reconstruire « Revenu net » n01 à n05 à la souris produit un YAML identique, à l'octet près, à la fixture de référence (hors `next_id`).
2. Une clé de jointure ne peut être choisie que parmi les colonnes amont ; une colonne supprimée en amont fait apparaître un problème sur le nœud aval.
3. Créer un cycle est refusé à la connexion, avec un message.
4. Un filtre sans « nulls » bloque la soumission et le problème « Aller au nœud » sélectionne le nœud.
5. Annuler/rétablir couvre ajout, suppression, connexion et modification de champ (20 opérations aller-retour : document identique).
6. Modifier le YAML plein écran puis revenir au canevas reflète les changements ; un YAML non analysable empêche le retour.
7. En mode surcharge, seul le remplacement de nœuds est possible ; une surcharge de n02 (filtre statut) affiche le bandeau hors points déclarés.
8. Le SQL compilé du nœud sélectionné s'affiche pour Databricks et Snowflake.
9. Un brouillon survit à un redémarrage de l'app.
10. La soumission crée la proposition (vérifiée via 0006 sur `LocalHost`).
11. Validation incrémentale < 150 ms sur un graphe de 50 nœuds (mesure notée).

## Tests
- Composants : formulaires par type (dix cas), opérations sur le document (tests purs), pile d'annulation.
- Bout en bout : Playwright pour la construction complète de la fixture, le mode surcharge et la soumission.
- À la main : session d'édition avec un utilisateur métier ; vérifier que rien hors vocabulaire n'est proposé.

## Dépendances
0012, 0002, 0006, 0007.

## Estimation
**L**, le plus gros plan de la série. Incertitudes : performance de React Flow avec des formulaires riches ; ergonomie du mode surcharge ; ajout de `next_id` au schéma.

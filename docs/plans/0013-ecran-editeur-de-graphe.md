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

## Mise en œuvre (30 octobre 2026)

- **Cœur** (`core/src/skifer_atlas/`) :
  - `editor.py` :
    - ouverture d'un document : copie en version suivante, brouillon et positions, plus haut nœud attribué, vocabulaire fermé, calendriers, domaines, canonique d'une déclinaison ;
    - création d'un document neuf ;
    - validation (`check`) : problèmes, état permanent, colonnes par nœud, SQL par dialecte et CTE du nœud, YAML canonique et fragments, avec validation partielle d'un document incomplet ;
    - analyse d'un YAML saisi (`parse`) ;
    - brouillons ;
    - aperçu de la proposition (`preview`) ;
  - `api/routes/editor.py` : `GET`/`POST …/editor/documents`, `PUT`/`DELETE …/documents/{id}/draft`, `POST …/editor/check`, `/parse` et `/preview`, derrière le token de session ;
  - `model/io.py` : dates gardées en dates, surcharges jamais écrites sur une ligne ;
  - `compile/builder.py` : CTE ajoutées sans recopie de la requête (`copy=False`).
- **Interface** (`app/src/`) :
  - `editor/model.ts` : opérations pures sur le document, refus des cycles, pile d'annulation avec fusion de la frappe, identifiants jamais réutilisés, disposition automatique ;
  - `editor/Canvas.tsx` : canevas React Flow, nœuds du guide 4, ports gauche / droite des jointures, trame de 24 px, mini-carte ;
  - `editor/Palette.tsx`, `editor/Properties.tsx` (Propriétés / Entrées / YAML du nœud, panneau du document), `editor/forms.tsx` (formulaire par type) et `editor/fields.tsx` ;
  - `editor/BottomPanel.tsx` : Problèmes, Colonnes en sortie, SQL compilé, état permanent ;
  - `editor/YamlView.tsx` : vue YAML plein écran (CodeMirror 6, chargé à la demande) ;
  - `editor/SubmitDialog.tsx` : récapitulatif, justification, création de la proposition ;
  - `screens/Editor.tsx` : création d'un document, session d'édition, brouillon automatique, raccourcis d'annulation ;
  - `screens/WorkspaceShell.tsx` : l'éditeur occupe la fenêtre, sans barre latérale ;
  - tokens ajoutés : `--atlas-node-join-w`, `--atlas-node-band`, `--atlas-port`, `--atlas-halo`, `--atlas-swatch`, `--atlas-minimap-w`, `--atlas-minimap-h`, `--atlas-bottom-h`, `--atlas-canvas-min-h`.

  Les choix que le plan ne fixait pas, ou dont on s'écarte, sont dans l'**ADR 0017** :
  - pas de `graph.next_id` : le prochain identifiant se calcule depuis le document, ses versions taguées et le brouillon ;
  - YAML rendu par le serveur ;
  - validation partielle ;
  - brouillons dans `.atlas/` ;
  - en-tête de nœud blanc avec filet de famille, pour le contraste ;
  - éditeur plein écran ;
  - soumission en `aria-disabled` ;
  - CodeMirror à la demande ;
  - correctif de performance du compilateur.
- **Mesure (critère 11)** :
  - graphe de 50 nœuds : une source, 48 calculs, une agrégation ;
  - validation complète par l'API (`POST …/editor/check`, sans SQL de nœud) : médiane de 78 ms sur cinq mesures (61, 78, 79, 61, 79 ms), soit environ 61 ms hors HTTP ;
  - avant le correctif du compilateur, 225 ms : chaque CTE recopiait la requête entière.
- **Tests** :
  - `core/tests/repo/test_editor_api.py` (12 tests), sur le dépôt de `depot-nordis.sh` :
    - ouverture en v5 et vocabulaire fermé ;
    - SQL de n03 pour les deux dialectes (critère 8) ;
    - filtre sans `nulls` (critère 4), avec les colonnes en aval ;
    - colonne disparue (critère 2) ;
    - cycle (critère 3) ;
    - surcharge de n02 hors points déclarés (critère 7) ;
    - document neuf et 409 ;
    - brouillon (critère 9) ;
    - YAML illisible (critère 6) ;
    - YAML canonique quel que soit l'ordre des clés (critère 1) ;
    - soumission (critère 10) ;
    - 50 nœuds sous 150 ms (critère 11).
  - Vitest, `npm test`, 91 tests. Nouveaux :
    - `editor/model.test.ts` (12 tests) : opérations, refus des cycles, jointure et union, retrait, identifiants non réutilisés, 20 opérations aller-retour (critère 5), fusion de la frappe, surcharge, disposition ;
    - `editor/forms.test.tsx` (13 tests) : un cas par type, clés de jointure prises en amont (critère 2), lecture seule ;
    - `screens/Editor.test.tsx` (6 tests) : « Aller au nœud » (critère 4), palette avec brouillon automatique et annulation, reprise d'un brouillon, soumission, mode surcharge, identifiant pris.
  - Playwright, `npm run e2e`, `e2e/editor.spec.ts` (3 tests) :
    - Revenu net reconstruit à la souris dans un document neuf. On oublie `nulls` sur n02 : la soumission est bloquée et « Aller au nœud » sélectionne n02 (critère 4). Le brouillon survit au rechargement (critère 9). Le YAML est identique à la fixture à l'octet près, à l'identifiant et la version près (critère 1). La soumission crée la proposition sur `LocalHost` (critère 10).
    - Sur Revenu net v4 : cycle refusé à la connexion (critère 3), SQL de n03 pour Databricks et Snowflake (critère 8). Dans la vue YAML, un texte illisible bloque le retour ; un libellé modifié revient au canevas, puis s'annule (critère 6).
    - Sur nordis-fr : palette désactivée, remplacement de n02 et bandeau hors points déclarés (critère 7).

    axe-core passe sans exception sur l'éditeur. `e2e/fiche.spec.ts` vérifie que « Proposer une modification » ouvre l'éditeur en v5.
- **Reste à faire** :
  - session d'édition avec un utilisateur métier, prévue par le plan ;
  - vérification à la main sous Tauri ;
  - rendu de React Flow au-delà de 50 nœuds.

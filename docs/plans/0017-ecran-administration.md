# Plan 0017 — Administration de l'espace (10.7)

## Objectif
Le référent paramètre l'espace (domaines, validateurs requis, utilisateurs et rôles, dépôt Git, plateformes autorisées) depuis l'application ; chaque enregistrement crée une proposition de modification de `governance.yaml`, et aucun token n'apparaît nulle part.

## Périmètre
**Dedans** : écran 10.7 ; formulaires de domaine et d'invitation (non maquettés) ; enregistrement via proposition (0006) ; affichage du dépôt et de la dernière synchronisation, avec « Synchroniser ».
**Dehors** : gestion des comptes sur l'hébergeur (l'invitation ajoute le compte à `governance.yaml` ; l'accès au dépôt se donne sur l'hébergeur, l'écran le rappelle).

## Références
Brief 5, 10.7 ; guide 5 (10.7), 7 ; `screens/10.7-administration.html` ; ADR 0005 ; plan 0006.

## Spécification
- Accès réservé au rôle `referent` (route et API : 403 sinon).
- Sections en grille de 2 colonnes : Domaines métier (liste, « + Domaine », alerte orange si un domaine n'a pas de référent) ; Validateurs requis (canonique et déclinaisons, min 1, surcharges par domaine, rappel « une surcharge hors des points déclarés exige toujours le nombre canonique ») ; Utilisateurs et rôles (tableau Nom / Entité / Rôle / Domaines, « + Inviter ») ; Dépôt Git (URL en mono, branche principale, dernière synchronisation, « Synchroniser ») ; Plateformes autorisées (cases avec le mode d'auth).
- « Enregistrer les paramètres » calcule le nouveau `governance.yaml` (et `allowed_platforms`), le valide, puis crée une proposition « Gouvernance » (1 référent requis, 0006). Bouton libellé « Enregistrer et créer la proposition », conformément au guide 3.2. « Annuler » restaure l'état lu.
- Renommer un domaine change son `label`, jamais son `id` (aucun fichier déplacé).
- Référent seul (ADR 0008) :
  - tant que la branche principale ne compte qu'un référent, un bandeau permanent indique que ses modifications de gouvernance sont fusionnées sans revue. Le bouton devient « Enregistrer et fusionner », avec la même mention sur la proposition créée ;
  - le rappel « Require review from Code Owners » n'apparaît qu'à partir de deux référents.

## Critères d'acceptation
1. Un non-référent n'accède ni à l'écran ni à l'API (403).
2. Ajouter un domaine sans référent affiche l'alerte.
3. Un nombre de validateurs à 0 est refusé (min 1).
4. Enregistrer crée une proposition dont le diff ne porte que sur `governance.yaml` et le `CODEOWNERS` régénéré (ADR 0009).
5. Renommer un domaine ne modifie que son libellé.
6. Aucun champ ni texte de token sur l'écran.
7. « Synchroniser » met à jour la date et réindexe.
8. Avec un seul référent, le bandeau est affiché, l'enregistrement fusionne directement avec la mention, et le bandeau disparaît après l'ajout d'un deuxième référent.

## Tests
- Composants : formulaires et validations.
- Bout en bout : modification de la gouvernance via `LocalHost`, approbation, fusion, puis effet sur le décompte des validations (0006).
- À la main : relecture des libellés avec un référent.

## Dépendances
0006, 0010.

## Estimation
**M**. Le cas du référent seul est tranché par l'ADR 0008 (fusion sans revue tracée, tant qu'aucun autre compte n'est habilité) ; ce choix est à revoir à l'usage.

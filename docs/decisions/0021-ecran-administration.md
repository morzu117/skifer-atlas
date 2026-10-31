# ADR 0021 — Écran d'administration

Date : 2026-10-31 · Statut : **acceptée** (mise en œuvre du plan 0017)

## Contexte

Le plan 0017 fait de l'écran 10.7 le lieu où le référent paramètre l'espace :
- domaines ;
- validateurs requis ;
- utilisateurs et rôles ;
- dépôt Git ;
- plateformes autorisées.

Chaque enregistrement devient une proposition sur `governance.yaml` (plan 0006). Le cas du référent seul suit l'ADR 0008. Plusieurs points restent ouverts :
- qui est « le référent » ;
- comment éviter d'écraser une gouvernance modifiée entre-temps ;
- la justification d'une proposition que l'écran rédige ;
- la date de synchronisation ;
- ce que l'écran laisse de côté.

## Décision

- **Référent d'espace seulement.** L'écran et ses routes sont réservés aux référents d'espace : le rôle `referent` sans restriction de domaine. Ce sont les seuls à pouvoir proposer une modification de la gouvernance (plan 0006). Un référent de domaine, comme Claire M. sur Finance, a bien le rôle `referent`, mais il ne voit pas Administration. La liste des espaces porte donc `space_referent`, qui pilote la navigation et la redirection.
  - `GET …/admin` et `POST …/admin/governance` répondent 403 `forbidden` aux autres comptes (critère 1).
  - Le compte retenu est celui de l'hébergeur, comme pour les propositions.
  - `GET …/governance` reste lisible par tous : `governance.yaml` est dans le dépôt que chaque membre clone.
- **`GET …/admin`** rend en un appel ce que l'écran affiche :
  - la gouvernance ;
  - l'empreinte de `governance.yaml` (`base_digest`) ;
  - les domaines sans référent ;
  - les référents d'espace et `single_referent` ;
  - le nombre de KPI par domaine, lu dans l'index ;
  - les plateformes proposées, avec leur mode d'authentification ;
  - le dépôt : URL, branche principale, dernière synchronisation, index à jour ou non.
- **Modification sur une copie locale.** L'écran modifie la gouvernance sur place, section par section. Un domaine ou un membre s'édite dans un petit formulaire en ligne (« Appliquer », « Annuler »). Rien ne part avant « Enregistrer ». « Annuler », en bas, restaure l'état lu. Enregistrer est grisé tant que :
  - rien n'a changé ;
  - un formulaire en ligne est ouvert ;
  - un nombre de validateurs est invalide (inférieur à 1, critère 3) ;
  - la proposition qui vient d'être ouverte n'a pas été suivie d'une autre modification (pas de doublon).
- **`POST …/admin/governance`** prend `{governance, base_digest}`.
  - Si `governance.yaml` a changé sur la branche principale depuis la lecture : 409 `stale_base`, et un bouton « Relire les paramètres ».
  - Une gouvernance identique à celle en vigueur : 422 `no_change`.
  - Une gouvernance invalide : 422 `invalid_governance`, avec les diagnostics.

  Les deux contrôles sont dans `create_governance_proposal`. `POST …/governance` les applique aussi, sans `base_digest`.
- **Justification rédigée par le serveur** : la liste des modifications en phrases, par exemple « Domaine « Data » ajouté. », « Domaine « Supply chain » renommé « Supply ». ». La maquette n'a pas de champ de justification. La liste est aussi rendue à l'écran (`changes`).
- **Référent seul (ADR 0008).** Quand aucun autre compte n'est habilité à approuver, la proposition est fusionnée dans la foulée. Elle porte la mention « Fusionnée sans revue : aucun autre compte habilité » et le trailer `Atlas-Review: none`. L'écran montre alors :
  - un bandeau orange permanent ;
  - le bouton « Enregistrer et fusionner » ;
  - après l'enregistrement, « Paramètres enregistrés : proposition n° X fusionnée sans revue ».

  À partir de deux référents, le bouton devient « Enregistrer et créer la proposition », et le rappel « Require review from Code Owners » apparaît sous le dépôt (critère 8).
  - Le libellé suit l'état de la branche principale, et non le formulaire : la proposition qui ajoute le deuxième référent est encore fusionnée seule.
  - Si la fusion échoue (`branch_protected`), la proposition reste ouverte et l'erreur s'affiche.
- **Domaines.** Un domaine existant ne change que de libellé, de référents, de validateurs et de surcharge. Son identifiant n'est pas modifiable (critère 5). Un nouveau domaine reçoit un identifiant déduit du libellé, modifiable avant l'ajout.
  - Référents et validateurs se cochent parmi les membres et s'écrivent dans les listes du domaine.
  - Les rôles par domaine des membres comptent aussi dans le résumé : « Référent Claire M. · 2 validateurs · 2 KPI ».
  - Un domaine sans référent affiche « Aucun référent » en orange, avec une icône (critère 2).
- **Membres.** « + Inviter » demande nom, compte sur l'hébergeur, entité, rôle et domaines (aucun domaine : tout l'espace). L'écran rappelle que l'accès au dépôt se donne sur l'hébergeur. Un membre se modifie de la même façon, à un rôle près : un membre qui a plusieurs rôles garde les siens, à modifier dans `governance.yaml`. Retirer un membre ou un domaine n'est pas proposé. Les libellés de rôle sont ceux de l'app (« Référent », « Validateur »…), et non accordés à la personne.
- **Dépôt Git.** L'URL s'affiche en lecture seule, en mono. Changer de dépôt distant n'est pas une modification de gouvernance. Rattacher un espace local à son dépôt passe par `POST …/remote` (plan 0010).
  - `Workspace.synced_at` est posé au clonage et à chaque synchronisation, y compris celles d'une proposition ou d'une fusion.
  - « Synchroniser » (`POST …/sync`) réindexe désormais si la branche a bougé, et rend `reindexed` et `synced_at` (critère 7).
- **Plateformes.** L'écran propose cinq plateformes, chacune avec son mode d'authentification, d'après la maquette : Databricks, Snowflake, BigQuery, Microsoft Fabric, Redshift. DuckDB, l'exécution locale, n'y figure pas : une autorisation existante est conservée. Aucun token, aucun champ de secret (critère 6).
- **Mise en page.** Les sections tiennent en deux colonnes si chacune garde au moins `--atlas-admin-col-min` (420 px), sinon en une seule.
- **Coque.** Tous les écrans de la navigation existent : l'écran d'attente « Cet écran arrive avec le plan … » disparaît.

## Conséquences

- La justification rédigée ne dit pas pourquoi. Les propositions de gouvernance attendent peu de discussion, et un référent qui veut s'expliquer peut commenter la proposition.
- Le libellé du bouton suit la branche principale. Ajouter un deuxième référent et changer autre chose dans le même enregistrement fusionne le tout sans revue.
- Retirer un membre ou un domaine, et modifier un membre aux rôles multiples, demande encore d'éditer `governance.yaml`.
- L'enregistrement réel sur GitHub, avec la règle « Require review from Code Owners », n'a pas été vérifié à la main.

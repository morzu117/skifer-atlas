# ADR 0027 — Administration : retraits et rôles multiples

Date : 2026-10-31 · Statut : **acceptée** (mise en œuvre du plan 0023)

## Contexte

L'ADR 0021 laissait à l'édition de `governance.yaml` trois opérations : retirer un membre, retirer un domaine, modifier un membre qui a plusieurs rôles. Le plan 0023 les ramène dans l'écran d'administration. Deux pièges : une liste de domaines vide veut dire « tout l'espace », et des documents portent l'identifiant de leur domaine.

## Décision

- **Retirer un membre retire aussi ses mentions.** Son compte quitte les référents et validateurs de chaque domaine : `governance.yaml` ne garde aucune référence à un non-membre (`unknown_member` reste une erreur). L'accès au dépôt, lui, se retire sur l'hébergeur ; l'écran le rappelle.
- **Le dernier référent de l'espace ne se retire pas.** Le bouton est grisé, avec la raison. Le serveur le refusait déjà (`no_referent`). Se retirer soi-même reste possible quand un autre référent existe : l'écran prévient qu'on perd l'administration une fois la proposition fusionnée.
- **Retirer un domaine ne doit élargir aucun rôle.** Un rôle limité à plusieurs domaines perd celui-ci ; un rôle limité à ce seul domaine disparaît, au lieu de devenir un rôle sur tout l'espace. Un membre sans rôle restant devient lecteur.
- **Un domaine qui porte des documents ne se retire pas.** L'état de l'écran donne `document_counts` (concepts, KPI, déclinaisons) ; le bouton est grisé avec le nombre de documents. Le serveur vérifie aussi, avant de créer la proposition : 422 `domain_in_use`. Rattacher ces documents à un autre domaine passe par des propositions sur les documents.
- **Rôles multiples dans le formulaire.** Chaque rôle a sa ligne, avec ses domaines ; on en ajoute ou en retire. Un même rôle ne figure qu'une fois : on regroupe ses domaines. Le tableau garde le rôle principal et la liste des domaines.
- **Rien ne part avant « Enregistrer ».** Les retraits sont des modifications locales, comme le reste ; « Annuler » les défait. Pas de confirmation de plus : la proposition est elle-même la confirmation, et sa justification dit « Domaine « Marketing » retiré. », « Marc D. (marc.d) retiré. ».

## Conséquences

- L'écran couvre désormais toute la gouvernance, sauf les plateformes non proposées par la maquette (une autorisation existante est conservée, ADR 0021).
- Les documents d'un domaine à retirer doivent d'abord changer de domaine : il n'y a pas de déplacement en bloc.

## Complément (2 novembre 2026, issue #42)

- **Le contrôle d'un retrait de domaine ne laisse pas passer faute d'index.** Si l'index de l'espace ne peut pas compter les documents, le retrait d'un domaine est refusé : 503 `index_unavailable`, à réessayer après la synchronisation. Une modification qui ne retire aucun domaine ne lit pas l'index. L'écran reste informatif : `document_counts` vide si l'index manque, et le serveur tranche.
- **Le rôle lecteur est compris dans les autres.** À côté d'un autre rôle, il est retiré à l'enregistrement, et la justification ne le cite pas. Seul, il reste.
- Tests : `core/tests/repo/test_admin.py` (`test_a_domain_is_not_removed_when_the_index_cannot_count_its_documents`, `test_a_reader_role_next_to_other_roles_is_dropped`, `test_a_name_ending_with_a_period_ends_the_sentence`).

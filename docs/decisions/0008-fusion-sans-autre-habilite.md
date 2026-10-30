# ADR 0008 — Fusion sans revue quand personne d'autre n'est habilité

Date : 2026-10-30 · Statut : **acceptée**, à revoir à l'usage (plans 0006 et 0017)

## Contexte

Trois règles se combinent :

- le créateur d'un espace en est le seul référent (plan 0005) ;
- une modification de `governance.yaml` exige l'approbation d'un référent (plan 0006) ;
- l'approbation de l'auteur ne compte jamais (plan 0006).

Un référent seul ne peut donc rien changer à la gouvernance, pas même inviter un deuxième référent, car l'invitation est elle-même une modification de `governance.yaml`. Le même blocage touche les documents : un consultant qui démarre seul un espace ne peut faire fusionner aucun KPI.

Le brief (5.2) demande de ne pas bloquer l'adoption par une gouvernance trop exigeante au départ. Le plan 0017 laissait la question ouverte.

## Décision

- **Règle.** L'auteur peut fusionner sa proposition sans approbation lorsqu'**aucun autre compte n'est habilité** à l'approuver :
  - pour une modification de `governance.yaml`, aucun autre référent d'espace ;
  - pour un document, aucun autre compte `validateur` ou `referent` sur son domaine.
  
  La règle vaut pour la gouvernance comme pour les documents.
- **Calcul sur la branche principale.** Les habilités se comptent dans le `governance.yaml` de la branche principale, jamais dans celui de la proposition. Sinon, une proposition qui retire les autres référents permettrait à son auteur de se retrouver seul et de fusionner sans revue.
- **Pas d'abaissement du nombre requis.** S'il existe au moins un autre habilité, le décompte normal s'applique en entier. Si un domaine exige deux validations et qu'un seul autre compte est habilité, la proposition reste bloquée, et le décompte l'explique (« 2 validations requises, 1 seul autre compte habilité »). L'exception ne vaut que lorsqu'il n'y a personne d'autre.
- **Trace.**
  - La proposition porte la mention « Fusionnée sans revue : aucun autre compte habilité ».
  - Le commit de fusion porte le trailer `Atlas-Review: none (no other eligible approver)`, pour qu'on la retrouve dans l'historique Git.
  - Tant que l'espace n'a qu'un référent, l'écran d'administration affiche un bandeau permanent.
- **Fin automatique.** L'exception disparaît d'elle-même dès qu'une deuxième personne habilitée figure sur la branche principale. Il n'y a rien à désactiver.
- **Protection de branche GitHub.** L'écran d'administration ne recommande d'activer « Require review from Code Owners » qu'à partir de deux référents. GitHub interdit en effet d'approuver sa propre pull request, et refuserait donc la fusion d'un référent seul. Si la règle est malgré tout active, la fusion échoue avec un code explicite (`branch_protected`), sans contournement.

## Conséquences

- `ready_to_merge` a deux voies : le décompte atteint, ou l'absence d'autre habilité. L'API expose laquelle (`merge_mode: reviewed | no_other_eligible`).
- Un espace à une personne fonctionne de bout en bout, et sa gouvernance se durcit dès qu'on y invite quelqu'un.
- C'est un choix de démarrage, à revoir avec les premiers retours. Pistes : limiter l'exception à la gouvernance, ou la rendre désactivable par le référent.

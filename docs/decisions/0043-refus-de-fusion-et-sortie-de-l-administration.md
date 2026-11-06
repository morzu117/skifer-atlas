# ADR 0043 — Refus de fusion traduits, file qui se vide, sortie de l'Administration confirmée

Date : 2026-11-06 · Statut : **acceptée** (suivi de la revue globale, issue #147 ; prolonge les plans 0006, 0014 et 0017)

## Contexte

La revue globale a relevé trois défauts sur les propositions et la gouvernance :

1. **Refus de fusion bruts (P2).** Sept codes du serveur n'avaient pas d'entrée dans `messages.ts` : `merge_conflict`, `merge_refused`, `branch_protected`, `head_changed`, `not_open`, `cannot_review_own` et `comment_required`. L'écran affichait « L'opération a échoué » avec le texte du serveur, qui reprend la sortie de git (`git merge a échoué : CONFLICT…`) ou la réponse de GitHub (`GitHub a répondu 405 : Pull Request is not mergeable`).
2. **Brouillon de gouvernance perdu (P3).** Le brouillon de l'Administration est local à l'écran : un clic sur un autre onglet de la coque l'abandonnait sans avertissement.
3. **Liste du statut précédent (P3).** Changer de filtre dans Propositions laissait la file de l'ancien statut affichée pendant la requête, ou pour toujours si elle échouait par `UnreachableError`.

Contrairement à ce que supposait le ticket, aucun mécanisme de sortie n'existait : l'éditeur (ADR 0040) n'interroge pas, il écrit son brouillon local au départ. L'Administration n'a pas de brouillon local persistant : sa copie de travail est une gouvernance entière qui n'a de sens qu'enregistrée en proposition.

## Décision

### Codes de refus traduits

Tous répondent 409, sauf `cannot_review_own` et `comment_required` (422). Le message dit ce qui s'est passé, que rien n'a été fusionné quand c'est le cas, et quoi faire. La sortie de git et la réponse de GitHub ne sont plus affichées.

| Code | Origine | Titre | Consigne |
|---|---|---|---|
| `merge_conflict` | `git merge` en conflit (hôte local), ou GitHub 405 « not mergeable » | La fusion provoque un conflit | Demander à l'auteur de reproposer à partir de la version courante |
| `merge_refused` | le `git push` de la branche principale est refusé après la fusion (hôte local) | Le dépôt a refusé la fusion | La branche principale a sans doute avancé : relire, réessayer |
| `branch_protected` | GitHub 405 hors conflit : règle de branche | La branche principale est protégée | Remplir la condition sur GitHub, ou contacter le référent |
| `head_changed` | la branche a reçu des commits depuis le décompte (GitHub 409, ou course sur l'hôte local) | La proposition a changé depuis son affichage | L'écran est relu ; relire le diff, faire approuver de nouveau |
| `not_ready` | les conditions de fusion ne sont plus remplies : décompte insuffisant (un commit le remet à zéro), changements demandés par un habilité, aucun habilité | La proposition ne remplit plus les conditions de fusion | La raison exacte du serveur (français, sans détail technique) précède : L'écran est relu, agir selon ce qu'il indique |
| `not_open` | déjà fusionnée ou fermée | La proposition n'est plus ouverte | La retrouver dans « Fusionnées » ou « Fermées » |
| `cannot_review_own` | l'auteur approuve ou demande des changements | Vous ne pouvez pas relire votre proposition | Demander à un autre validateur du domaine |
| `comment_required` | demande de changements sans commentaire | Commentaire manquant | Écrire ce qui doit changer, puis renvoyer |

`not_ready` n'était pas dans la liste du ticket : c'est le refus produit quand un commit, un retrait de validation ou une demande de changements arrive entre l'affichage et le clic sur « Fusionner ». Ses causes sont plusieurs (`decide` dans `governance/rules.py`) ; le titre est donc générique et `explain` place devant la consigne la raison exacte du serveur. `stale_base` garde son texte serveur : il est en français, nomme le document ou le fichier et dit déjà quoi faire (reproposer à partir de la version courante).

Les autres codes d'hébergeur (`host_forbidden`, `host_rejected`, `host_failed`) restent sans entrée : leur sens exact dépend de la réponse de GitHub, qu'on ne sait pas décrire sans la montrer.

**Relecture après un refus périmé.** Pour `head_changed` et `not_ready`, l'écran relit la file et le détail de la proposition tout en gardant le message affiché : ce que les consignes annoncent (« l'écran est relu ») est donc vrai. `not_open` ne relit pas : la proposition quitterait la file ouverte et emporterait le message avec elle.

### La file se vide quand le filtre change

L'effet de chargement de la file remet `queue` en chargement quand l'espace ou le statut changent, pas à chaque relecture : une revue ou une fusion relit la file sous le même filtre sans démonter la proposition ouverte ni son bandeau. Le drapeau d'annulation de l'effet existait déjà et empêche une réponse tardive d'un ancien filtre d'écraser la plus récente. Si le serveur est injoignable, la file reste en « Chargement des propositions… » sous le bandeau de la coque, plutôt que d'afficher la liste d'un autre statut.

### Sortie de l'Administration

- **Mécanisme (`router.ts`, `useLeaveGuard`).** Le routeur n'a pas de bloqueur de navigation (le routage par hash n'en offre pas, et `hashchange` arrive après le changement). Un hook inscrit, tant qu'un écran porte du travail non enregistré : un écouteur de clic en phase de capture sur les liens `a[href^="#/"]` (onglets de la coque, sélecteur d'espace, liens internes), un garde dans `navigate()` pour les navigations faites par le code, et un `beforeunload` pour la fermeture du navigateur. Une adresse qui ne change que les paramètres de la même vue ne déclenche rien. Les clics modifiés (Cmd, Ctrl, Maj, Alt) ne sont pas retenus.
- **Composant.** `Confirmation` (alertdialog, focus sur « Annuler », retour du focus sur le lien cliqué par `returnFocusTo`). « Quitter l'Administration ? » — « Les modifications de la gouvernance n'ont pas été enregistrées : elles seront perdues si vous quittez cet écran. » — « Quitter sans enregistrer ». « Annuler » reste sur l'écran, brouillon intact. La question se ferme d'elle-même si le brouillon est annulé ou enregistré pendant qu'elle est ouverte.
- **Quand.** Le brouillon diffère de la gouvernance lue (`dirty`) **et** n'est pas celui que la dernière requête réussie a envoyé (l'instantané soumis est mémorisé ; une modification faite pendant l'attente de la réponse reste donc non enregistrée, le bouton « Enregistrer » se réactive et le bandeau « enregistré » ajoute que les modifications faites depuis l'envoi ne le sont pas), **ou** le formulaire d'un domaine ou d'un membre est ouvert et modifié sans avoir été appliqué : sa saisie vit dans le formulaire, hors du brouillon. Chaque formulaire compare son état à celui de son ouverture et le signale à l'écran (`useReportEdited`). Une fois la proposition créée ou fusionnée avec ce brouillon, il vit dans le dépôt : on peut partir sans question. Une nouvelle modification réarme la question.
- **Pas de brouillon local.** On demande confirmation plutôt que d'écrire un brouillon comme l'éditeur : la gouvernance s'enregistre en bloc contre une base (`base_digest`) et un brouillon repris plus tard risquerait de porter sur une base périmée. Le rattachement garde son propre transport de brouillon, inchangé.

## Conséquences

- Les clics sur les liens et les appels à `navigate` sont couverts. **Limites assumées** : le retour arrière du navigateur et la modification manuelle de l'adresse ne sont pas retenus (le hash a déjà changé quand l'écran est prévenu) ; sous Tauri, `beforeunload` n'est pas fiable pour la fermeture de la fenêtre, qui n'est pas traitée ici (aucune interception native, voir l'ADR 0040 et l'issue #154 pour le même constat sur Cmd+Q).
- Tout autre écran qui voudra retenir une sortie réutilise `useLeaveGuard`. Un seul garde est actif à la fois : le dernier monté.
- Le garde ne couvre pas les liens qui ne sont pas des ancres `#/…` ; il n'y en a pas dans l'application.
- Une fusion relit les paramètres et remonte le formulaire sur la gouvernance relue : une modification faite pendant l'attente d'une réponse `merged` est alors écartée, sans question. Ce cas n'est pas traité ici (il existait avant l'ADR).

# Plan 0014 — Propositions (10.4)

## Objectif
Un validateur voit la file des propositions (en priorité celles de ses domaines), ouvre une proposition, lit le diff visuel côte à côte avec sa classification, la justification et les commentaires, puis approuve ou demande des changements ; la fusion devient possible quand le nombre de validations requises est atteint.

## Périmètre
**Dedans** : maître-détail 10.4 ; filtres ; badges de nature ; bandeau hors points déclarés ; diff deux colonnes ; justification ; fil de commentaires ; « Approuver (n / m) », « Demander des changements », « Fusionner » quand c'est prêt.
**Dehors** : notifications ; modification de la proposition (on repasse par l'éditeur, 0013).

## Références
Brief 4.1, 5, 8.2, 10.4 ; guide 3.4, 3.7, 4 (diff), 5 (10.4) ; `screens/10.4-propositions.html` ; plans 0003, 0006, 0012.

## Spécification
- **Liste** (380 px) : filtres Domaine (« Mes domaines » par défaut pour un validateur), Statut, Entité. Chaque élément affiche « KPI · entité », un badge de nature (Hors points déclarés / Point déclaré / Nouvelle version / From scratch), auteur · date relative et « Validations : obtenues / requises », avec la mention « canonique requis » le cas échéant.
- **Détail** : titre, métadonnées (auteur, version de base, domaine, branche Git en mono), actions. Bandeau orange si une surcharge sort des points déclarés : la phrase indique la conséquence et suggère d'ajouter un point de variation si la même surcharge revient (détection : même nœud surchargé hors point déclaré par au moins deux entités, information fournie par 0006).
- **Diff** : deux colonnes, canonique à gauche et proposition à droite, nœuds alignés par appariement (0003) et disposés par le composant de 0012. Grammaire : modifié = bordure 2 px `--atlas-bad` et étiquette « modifié » ; surchargé sur point déclaré = pointillé orange, « Normal » ; ajouté = teal ; retiré = rouge barré ; libellé de classification à droite de chaque nœud concerné. Sous le diff, la liste textuelle des écarts (lisible sans couleur).
- **Commentaires** : fil chronologique (`GitHost.list_comments`), champ de réponse, envoi.
- **Actions** : « Approuver (n / m) » est désactivé pour l'auteur et pour un compte sans le rôle requis, avec une infobulle qui dit pourquoi. « Demander des changements » exige un commentaire. « Fusionner » apparaît quand `ready_to_merge`.

## Critères d'acceptation
1. La file reflète les propositions du dépôt de démonstration, avec les bons badges et compteurs.
2. Un validateur Finance voit d'abord les propositions Finance.
3. La proposition DE de la maquette affiche le bandeau, n02 (filtre statut) « Divergence critique » et n03 (déduction des taxes) « Normal ».
4. Approuver incrémente le compteur ; le bouton est désactivé pour l'auteur.
5. Demander des changements sans commentaire est impossible.
6. Une proposition prête affiche « Fusionner » ; après fusion, elle quitte la file et la fiche montre la nouvelle version.
7. La liste textuelle des écarts reprend chaque écart du diff (accessibilité : le sens ne repose pas sur la couleur).

## Tests
- Composants : liste, badges, rendu du diff à partir d'un rapport 0003 commité.
- Bout en bout : cycle complet sur `LocalHost` avec deux comptes validateurs simulés.
- À la main : relire un diff from scratch, sur lequel l'appariement par score est le plus fragile.

## Dépendances
0006, 0012.

## Estimation
**L**. Incertitudes : lisibilité du diff côte à côte pour des graphes from scratch mal appariés ; synchronisation du défilement des deux colonnes.

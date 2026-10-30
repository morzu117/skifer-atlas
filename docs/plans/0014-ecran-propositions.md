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

## Mise en œuvre (30 octobre 2026)

- **Cœur** (`core/src/skifer_atlas/`) :
  - `proposals/view.py` :
    - `queue` : la file, les domaines où le compte valide (« Mes domaines »), les libellés, les entités et les membres ;
    - `viewer` : ce que le compte peut faire d'une proposition, et pourquoi pas ;
    - `graphs` : les deux graphes disposés, le rapport de diff 0003, les surcharges hors points déclarés et celles qui reviennent d'une entité à l'autre ;
  - `proposals/status.py` : `viewer` dans le détail ; une demande de changements sans commentaire est refusée (`comment_required`, 422) ;
  - `api/routes/proposals.py` : `GET …/proposals/queue?status=` et `GET …/proposals/{n}/graphs`, derrière le token de session ;
  - `sheet.py` : `resolved_graph`, devenu public, sert aussi au diff d'une proposition.
- **Interface** (`app/src/`) :
  - `screens/Proposals.tsx` :
    - la file, avec ses filtres Domaine / Statut / Entité dans l'adresse ;
    - le détail : en-tête, actions avec infobulle, formulaire de demande de changements, bandeau hors points déclarés ;
    - le diff deux colonnes avec son défilement lié, puis la liste des écarts, la justification et le fil de commentaires ;
  - `components/GraphView.tsx` : marque `overridden` et verdict à droite de chaque nœud (`notes`) ;
  - `format.ts` : badges de nature partagés avec la fenêtre de soumission ;
  - `screens/WorkspaceShell.tsx` : l'écran remplace l'attente ; le compteur de la navigation se relit après une revue ou une fusion ;
  - tokens ajoutés : `--atlas-queue-basis`, `--atlas-queue-w`, `--atlas-detail-basis`, `--atlas-control-h-filter`, `--atlas-diff-col-min`, `--atlas-avatar-xs`, `--atlas-tip-w`.
- **Démonstration** : `examples/propositions-nordis.py` ouvre les cinq propositions de la maquette sur le dépôt de `depot-nordis.sh` :
  - nordis-es v2, from scratch ;
  - Taux de service v3, prête à fusionner ;
  - Revenu net v5, 1 / 2 ;
  - nordis-fr v3, qui surcharge n02 hors des points déclarés ;
  - nordis-de v4, avec le commentaire de Claire M.

  Les choix que le plan ne fixait pas, ou dont on s'écarte, sont dans l'**ADR 0018** :
  - un appel pour la file et ses filtres, un pour les graphes ;
  - les raisons d'un bouton grisé viennent du serveur ;
  - la colonne de gauche reste la référence ;
  - « Normal » pour une surcharge sur point déclaré ;
  - colonnes empilées sous 440 px chacune ;
  - détection des surcharges récurrentes sur la branche principale et les propositions ouvertes ;
  - filtre Statut aux états de l'hébergeur ;
  - filtres de 36 px ;
  - e2e à trois comptes par `page.route`.
- **Tests** :
  - `core/tests/repo/test_proposals_view.py` (6 tests), sur le dépôt de démonstration et ses cinq propositions :
    - file de claire.m, Finance d'abord, Supply en dernier, avec natures, décomptes et mentions (critères 1 et 2) ;
    - raisons de l'auteure et d'un compte non habilité (critère 4) ;
    - graphes de la surcharge DE : n02 en `override_undeclared`, n03 en `override_declared`, n02 récurrent avec nordis-fr (critère 3) ;
    - nouvelle version et from scratch ;
    - `comment_required` (critère 5) ;
    - cycle complet : deux approbations, fusion par l'auteure, la file se vide, la fiche passe en v4 (critères 4 et 6).
  - Vitest, `npm test`, 100 tests. Nouveau : `screens/Proposals.test.tsx` (9 tests) :
    - badges, compteurs, « Mes domaines » puis « Tous » ;
    - filtre canonique ;
    - bandeau, verdicts n02 / n03, référence non marquée, liste de trois écarts (critères 3 et 7) ;
    - bouton grisé et infobulle pour l'auteure (critère 4) ;
    - approbation relue (critère 4) ;
    - commentaire exigé (critère 5) ;
    - réponse au fil ;
    - fusion et avis (critère 6) ;
    - `proposalMarks`.
  - Playwright, `npm run e2e`, `e2e/propositions.spec.ts` (2 tests), sur trois serveurs (anna.k, claire.m, marc.d) :
    - anna.k : la file, ses badges et ses compteurs ; sur DE, « Approuver (0 / 2) » grisé, avec la raison au survol (critères 1 et 4).
    - claire.m : « Mes domaines » sans Supply ; bandeau et suggestion ; n02 « Divergence critique » en rouge et n03 « Normal » en pointillé ; trois écarts en texte ; demande de changements bloquée sans commentaire ; approbation 1 / 2 ; marc.d approuve depuis son poste ; « Fusionner » ; la proposition quitte la file, la fiche de nordis-de passe en v4 (critères 2 à 7).

    axe-core passe sur la file et le détail. `e2e/demo.ts` amorce désormais les cinq propositions pour tous les scénarios.
- **Reste à faire** :
  - relire à la main un diff from scratch, comme le plan le demande ;
  - vérification à la main sous Tauri ;
  - notifications (hors périmètre).

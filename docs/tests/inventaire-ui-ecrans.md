# Inventaire des gestes — lot ui-ecrans (écrans 100, 104 à 108)

Chaque action qu'un utilisateur peut faire sur les écrans du lot, avec le résultat attendu d'après les documents (brief, guide de style, maquettes, plans, ADR), le test qui fait le vrai geste et son statut. Les règles du lot : l'oracle, ce sont les documents ; un écart reste rouge ; vrais gestes (clics, clavier, saisie), `page.route` réservé aux pannes simulées du serveur ou du réseau ; WebKit pour les gestes sensibles au moteur.

Statuts : **reporté** (décision du 13 novembre 2026), **vert** (nouveau test, passe), **rouge** (nouveau test, échoue à cause de l'application), **existant** (un test déjà présent fait le vrai geste : il est cité, pas dupliqué), **non testé** (avec la raison), **note** (contradiction des documents, choix retenu).

Tags de titre : `[S-UI-<écran>-<nn>]`. Fichiers : `app/e2e/ui-accueil.spec.ts`, `ui-cadre.spec.ts`, `ui-cadre.webkit.spec.ts`, `ui-propositions(.webkit).spec.ts`, `ui-comparaison(.webkit).spec.ts`, `ui-connexions(.webkit).spec.ts`, `ui-administration(.webkit).spec.ts` (gestes communs dans `ui-administration.gestes.ts` et `ui-cadre.gestes.ts`), `demo-lancement.spec.ts`.

Exécution : `cd app && /tmp/e2e-run.sh e2e/<fichier>.spec.ts`, et `/tmp/e2e-run.sh --project=webkit e2e/<fichier>.webkit.spec.ts`.

## Décomptes

Inventaire initial : 213 actions. Les corrections et le nouveau test S-UI-104-21 restent à vérifier par Playwright ; S-UI-100-10 et S-UI-107-11 sous WebKit sont reportés le 13 novembre 2026.

## Remarques transverses

- **Pièges de focus sous WebKit.** Le panneau latéral (`Drawer`) et la confirmation (`Confirmation`) ne ramènent le focus au début que s'il est sur le dernier élément focalisable, en général un bouton. Or Tab seul saute les boutons sous WebKit : le focus sort du dialogue (S-UI-100-10, S-UI-107-11).

- **WebKit et Tab.** Sous WebKit (Safari, WKWebView, donc la vue Tauri sous macOS), Tab seul ne s'arrête ni sur les liens ni sur les boutons, sauf si l'utilisateur a activé l'accès clavier complet de macOS. Les tests WebKit font Option+Tab. Le plan 0010 (critère 10) demande une navigation complète au clavier : sous Tauri, elle n'est donc garantie qu'avec Option+Tab. C'est un réglage du moteur, pas un défaut de l'app, mais il a une conséquence produit à trancher : lier `tabsToLinks`, ou documenter Option+Tab.
- **Bandeaux d'erreur sans action.** L'ADR 0013 (« États du serveur ») dit : « Une erreur d'API s'affiche dans un bandeau, avec le message traduit et une action ». Le plan 0010 (« États ») dit de même. Seuls l'accueil et le bandeau du serveur injoignable portent « Réessayer ». Les bandeaux d'erreur de la coque, des Propositions, de la Comparaison, des Connexions et de l'Administration n'ont pas d'action. Ce défaut fait cinq rouges : S-UI-104-13, S-UI-105-19, S-UI-106-09, S-UI-107-13 et S-UI-108-10.
- **Nom de l'utilisateur.** La maquette affiche « JH Julien H. » dans l'en-tête de l'accueil et dans la barre latérale. Le guide 3.1 précise « avatar initiales, nom, rôle ». L'app affiche le compte (`anna.k`, `julien.h`) : `Workspace` ne porte pas le nom du membre.

## 100 — Accueil, création, adhésion, rattachement, réinitialisation

| Id | Écran | Action de l'utilisateur | Résultat attendu (source : fichier, section) | Test (fichier) | Statut | Observé si rouge |
|---|---|---|---|---|---|---|
| S-UI-100-01 | 100 | « Créer un espace » puis envoi avec nom vide ; identifiant invalide ; nom changé après un identifiant saisi à la main | « Le nom est requis. » et l'erreur d'identifiant sous leur champ, rien n'est envoyé ; l'identifiant dérivé sans accents, puis figé une fois modifié (ADR 0013, Formulaires ; plan 0010) | ui-accueil.spec.ts | vert | |
| S-UI-100-02 | 100 | Créer un espace au clavier (saisie, Entrée dans un champ), revenir à l'accueil, recharger, cliquer la carte | Catalogue ouvert, titre focalisé ; carte « Référent d'annuaire », « Luxe · 2 entités · 0 domaine », initiales, après rechargement ; la carte rouvre le catalogue (guide 10.0 ; plan 0010, critère 3 ; ADR 0013) | ui-accueil.spec.ts | vert | |
| S-UI-100-03 | 100 | Panneaux « Créer » et « Rejoindre » : Tab et Maj+Tab répétés, Échap, « Fermer » | Le focus reste dans le panneau ; Échap et « Fermer » ferment sans rien envoyer ; le focus revient au bouton d'ouverture ; rien ne reste au réouverture (ADR 0013, Formulaires) | ui-accueil.spec.ts | vert | |
| S-UI-100-04 | 100 | « Cloner et ouvrir » avec une adresse vide, puis un dépôt introuvable (Entrée) | « L'adresse du dépôt est requise. » sans envoi ; « Le dépôt n'a pas pu être cloné » et sa consigne, sans la sortie de git ; panneau utilisable (plan 0010, Rejoindre) | ui-accueil.spec.ts | vert | |
| S-UI-100-05 | 100 | Créer un espace avec une adresse d'hébergeur refusée, puis « Ouvrir l'espace » | Espace créé, bandeau « Espace créé, dépôt distant non rattaché », groupe « Rattacher un dépôt distant » avec l'adresse préremplie ; « Ouvrir l'espace » mène au catalogue (plan 0033, Interface « Création », critère 5 ; ADR 0013) | ui-accueil.spec.ts | vert | |
| S-UI-100-06 | 100 | « Fermer » sur le message « espace absent du registre » | Le message disparaît, la liste reste (ADR 0013, Routage) | ui-accueil.spec.ts | vert | |
| S-UI-100-07 | 100 | Liste des espaces en erreur serveur, puis « Réessayer » ; lire la note du coffre | Bandeau traduit sans trace technique ; « Réessayer » relit la liste ; note fixe sur le coffre local (ADR 0013, États ; guide 10.0) | ui-accueil.spec.ts | vert | |
| S-UI-100-08 | 100 | Lire l'en-tête de l'accueil | Initiales et **nom** de l'utilisateur : « AK », « Anna K. » (maquette 10.0, en-tête « JH Julien H. » ; guide 10.0 « En-tête : logo, utilisateur » ; guide 3.1) | ui-accueil.spec.ts | **rouge** | En-tête « AK anna.k » : le compte au lieu du nom (`app/src/screens/Home.tsx:45` affiche `account` ; le type `Workspace` ne porte pas le nom du membre) |
| S-UI-100-10 | 100 | WebKit : panneau « Créer » (saisie, Tab, Échap), panneau « Rejoindre » (envoi vide, « Fermer ») | Focus gardé, identifiant dérivé, erreur sur le champ, focus rendu au bouton (règle 5 ; ADR 0013) | ui-cadre.webkit.spec.ts | **reporté** | Reporté le 13 novembre 2026 : navigation au clavier non prioritaire. Sous WebKit, Tab depuis le dernier champ du panneau « Créer » sort du dialogue : le piège ne boucle que si le focus est sur le dernier élément focalisable, un bouton que Tab saute sous WebKit (`app/src/components/Drawer.tsx:47-58`). Échap et « Rejoindre » ne sont pas atteints |
| — | 100 | Lire la grille : initiales, rôle, nom, secteur · entités · domaines, compteurs | Plan 0010, critère 1 ; maquette 10.0 | accueil.spec.ts S-0010-01 | existant | |
| — | 100 | Compteur orange des propositions en attente sur la carte | ADR 0013, Compteurs | accueil-revue.spec.ts S-0010-13 | existant | |
| — | 100 | Registre vide | Carte pointillée « Aucun espace pour l'instant » (guide 10.0 ; critère 2) | accueil.spec.ts S-0010-02 | existant | |
| — | 100 | Carte au clavier (Tab, Entrée) ; à la souris | Catalogue de l'espace, titre focalisé (guide 10.0 ; critère 10) | accueil.spec.ts S-0010-01, S-0010-05 ; hors-ligne.spec.ts | existant | |
| — | 100 | « + Créer un espace » pour un non-référent | Guide 10.0 : « référent uniquement, sinon masqué » ; ADR 0013 : toujours visible (pas d'espace courant à l'accueil) | accueil.spec.ts S-0010-03 | note | L'ADR, plus récente, l'emporte |
| — | 100 | Créer un espace, identifiant déjà pris | Erreur 409 sous le champ (critère 3) | accueil.spec.ts S-0010-03 | existant | |
| — | 100 | Échap et « Fermer » pendant l'envoi ou le clonage | Sans effet, puis l'espace s'ouvre (issue 146) | accueil.spec.ts S-0005-13 | existant | |
| — | 100 | Registre ou dépôt tenus par un autre processus | Message et panneau utilisable (ADR 0039) | accueil.spec.ts S-0005-12 | existant | |
| — | 100 | Rejoindre le dépôt de démonstration | Clone et ouvre, rôle lu dans la gouvernance (critère 4) | accueil.spec.ts S-0010-04 | existant | |
| — | 100 | Rejoindre un dépôt GitHub privé : connexion puis reprise | Plan 0025 | github.spec.ts S-0025-04 | existant | |
| — | 100 | Créer avec une adresse GitHub : connexion et rattachement dans le panneau | Plan 0033, critère 5 | rattachement.spec.ts S-0033-05 | existant | |
| — | 100 | Réinitialiser le rattachement dans le panneau de création ; Échap ne ferme que la confirmation | Plan 0034, critère 7 | reinitialisation.spec.ts S-0034-07 | existant | |
| — | 100 | Rattacher un dépôt vide depuis l'Administration, refus, compte GitHub, premier KPI | Plan 0033, critères 1 à 8 et 10 | rattachement.spec.ts S-0033-01 à 08, 10 | existant | |
| — | 100 | Réinitialiser un rattachement interrompu (confirmation, Annuler, Échap, réussite, refus, gel) | Plan 0034, critères 1 à 8 et 10 | reinitialisation.spec.ts S-0034-01 à 08, 10 | existant | |
| — | 100 | Espace absent du registre | Accueil avec un message (ADR 0013) | ouverture.spec.ts S-0005-09 | existant | |
| — | 100 | Adresse mal encodée | Accueil sans écran blanc | accueil.spec.ts S-0010-11 | existant | |
| — | 100 | Serveur arrêté, puis « Réessayer » | Bandeau critique, puis l'écran (critère 5) | accueil.spec.ts S-0010-05 | existant | |
| — | 100 | Polices locales réseau coupé ; axe-core | Critères 9 et 10 | accueil.spec.ts S-0010-02 | existant | |
| — | 100 | Démarrage « Démarrage du serveur local… » | Plan 0010, États | App.test.tsx (Vitest) | non testé en e2e | État transitoire avant que le serveur réponde ; couvert en Vitest |
| — | 100 | Rattacher ou réinitialiser sur un vrai compte GitHub | Plans 0033 (critère 9) et 0034 (critère 9) | — | non testé | Demande un compte et un dépôt réels (à la main) |
| — | 100 | Créer un espace par un non-référent | Guide 10.0 | — | non testé | Sans objet : tout créateur devient référent (ADR 0013) |

## 104 — Propositions

| Id | Écran | Action de l'utilisateur | Résultat attendu (source : fichier, section) | Test (fichier) | Statut | Observé si rouge |
|---|---|---|---|---|---|---|
| S-UI-104-01 | 104 | Filtre Domaine → « Supply chain », recharger, retour arrière | File réduite à Taux de service ; filtre gardé dans l'adresse ; le retour rend « Tous » et 5 éléments (plan 0014, Liste ; ADR 0018) | ui-propositions.spec.ts | vert | |
| S-UI-104-02 | 104 | Filtre Entité → nordis-de, puis « Canonique », puis « Toutes entités » | 1, puis 2, puis 5 éléments ; le détail suit (maquette 10.4 ; guide 10.4) | ui-propositions.spec.ts | vert | |
| S-UI-104-03 | 104 | Filtre Statut → Fusionnées, Fermées, Toutes, puis recharger | Fusionnées : badge « Fusionnée », aucune action ; Fermées : « Aucune proposition. » ; Toutes : ouvertes et fusionnées ; statut gardé (ADR 0018, Statut) | ui-propositions.spec.ts | vert | |
| S-UI-104-04 | 104 | Domaine « Marketing » (aucune proposition) | « Aucune proposition ne correspond à ces filtres. », détail « Sélectionner une proposition… » (plan 0014) | ui-propositions.spec.ts | vert | |
| S-UI-104-05 | 104 | Clic sur un élément, puis Tab et Entrée sur un autre ; recharger ; retour arrière | Élément sélectionné (`aria-current`), titre du détail, métadonnées (auteur, domaine, branche en mono), justification ; sélection gardée et rendue par le retour (guide 10.4 ; maquette) | ui-propositions.spec.ts | vert | |
| S-UI-104-06 | 104 | « Voir la fiche » dans les métadonnées du détail, puis retour arrière | Fiche de nordis-de, puis retour à la proposition (plan 0014 ; ADR 0018) | ui-propositions.spec.ts | vert | |
| S-UI-104-07 | 104 | anna.k sur n° 3 : focus clavier sur « Approuver », Entrée, clic ; clic sur « Demander des changements » | Infobulle « Votre approbation ne compterait pas ici… » visible au focus ; aucun envoi ; aucun formulaire (ADR 0018, `viewer`) | ui-propositions.spec.ts | vert | |
| S-UI-104-08 | 104 | marc.d approuve DE (1 / 2 → 2 / 2), recharge, fusionne | « prête à fusionner », « Fusionner » apparaît, « Demander des changements » disparaît ; l'approbation tient après rechargement ; après la fusion, l'élément quitte la file (plan 0014, critères 4 et 6) | ui-propositions.spec.ts | vert | |
| S-UI-104-09 | 104 | julien.h : survol de « Approuver » sur sa propre n° 3, approbation de DE, fusion de Taux de service | Raison « auteur » ; DE passe à 1 / 2 ; n° 2 fusionnée, visible dans « Fusionnées » (brief 5.1 ; ADR 0018) | ui-propositions.spec.ts | vert | |
| S-UI-104-10 | 104 | claire.m : « Mes domaines », puis « Tous les domaines », puis « Finance » | Supply masqué, puis visible (5 éléments), puis 4 éléments Finance (brief 10.4 ; plan 0014, critère 2) | ui-propositions.spec.ts | vert | |
| S-UI-104-11 | 104 | Clic sur « Détail des champs » d'un écart, deux fois | Les champs avant → après se déplient puis se replient (plan 0014, liste textuelle) | ui-propositions.spec.ts | vert | |
| S-UI-104-12 | 104 | Molette horizontale sur un graphe du diff, dans un sens puis dans l'autre | L'autre graphe défile pareil (ADR 0018, défilement lié) | ui-propositions.spec.ts | vert | |
| S-UI-104-13 | 104 | Ouvrir la file quand le serveur répond 500 | Bandeau au message traduit **avec une action** (« Réessayer ») (ADR 0013, États du serveur ; plan 0010, États) | ui-propositions.spec.ts | **rouge** | Bandeau « L'opération a échoué / Erreur 500. », sans aucun bouton |
| S-UI-104-14 | 104 | Ouvrir une proposition dont le détail répond 500 | Bandeau d'erreur dans le détail (ADR 0013, États du serveur) | ui-propositions.spec.ts | **rouge** | Ni alerte ni boutons d'action : l'écran reste muet |
| S-UI-104-15 | 104 | Serveur coupé, changer le Statut, puis « Réessayer » une fois le serveur revenu | Bandeau « Serveur local injoignable », file en chargement ; « Réessayer » rend la file des fusionnées (ADR 0013 ; ADR 0043) | ui-propositions.spec.ts | vert | |
| S-UI-104-16 | 104 | WebKit : les trois filtres, rechargement, retour arrière | Comme 01 à 03 (règle 5) | ui-propositions.webkit.spec.ts | vert | |
| S-UI-104-17 | 104 | WebKit : du titre à un élément de la file au clavier (Option+Tab), puis Entrée | Élément ouvert (plan 0010, critère 10) | ui-propositions.webkit.spec.ts | vert | |
| S-UI-104-18 | 104 | WebKit : bouton grisé atteint au clavier, Entrée, clic | Infobulle visible, aucun envoi (ADR 0018) | ui-propositions.webkit.spec.ts | vert | |
| S-UI-104-19 | 104 | WebKit : commentaire saisi, puis Option+Tab et Entrée ; demande de changements au clavier | Commentaire dans le fil, champ vidé ; demande envoyée avec son texte (plan 0014 ; maquette) | ui-propositions.webkit.spec.ts | vert | |
| S-UI-104-20 | 104 | WebKit : « Détail des champs » à Entrée ; molette sur un graphe | Déplié puis replié ; défilement lié | ui-propositions.webkit.spec.ts | vert | |
| — | 104 | Changer de Statut pendant le chargement, ou quand la requête échoue | « Chargement des propositions… », jamais l'ancienne file (plan 0014, critère 9) | propositions-testables.spec.ts S-0014-09 | existant | |
| — | 104 | Lire la file | Badges de nature, « Validations n / m », « canonique requis », « prête à fusionner » (critère 1) | propositions.spec.ts S-0014-01 | existant | |
| — | 104 | Ouvrir l'écran en validateur | « Mes domaines » par défaut (critère 2) | propositions.spec.ts S-0014-02 | existant | |
| — | 104 | Ouvrir la surcharge DE | Bandeau hors points déclarés et surcharge récurrente (critère 3) | propositions.spec.ts | existant | |
| — | 104 | Lire le diff | n02 « Divergence critique », n03 « Normal », liste de 3 écarts (critères 3 et 7) | propositions.spec.ts | existant | |
| — | 104 | Approuver (claire.m) | Le compteur passe à 1 / 2, file et fil relus (critère 4) | propositions.spec.ts | existant | |
| — | 104 | Auteure : survol de « Approuver » | `aria-disabled`, infobulle de l'auteur (critère 4) | propositions.spec.ts S-0014-01 | existant | |
| — | 104 | Demander des changements sans texte, puis « Annuler » | Erreur sur le champ, rien d'envoyé ; formulaire fermé (critère 5) | propositions.spec.ts | existant | |
| — | 104 | Envoyer une demande de changements, recharger | Entrée dans le fil, décompte inchangé, durable | propositions-revue.spec.ts S-0014-10 | existant | |
| — | 104 | Commentaire vide, puis commentaire envoyé, recharger | Refus sur le champ, puis entrée dans le fil, durable | propositions-revue.spec.ts S-0014-10 | existant | |
| — | 104 | Fusionner, puis « Voir la fiche » de l'avis | La proposition quitte la file, la fiche passe en v4 (critère 6) | propositions.spec.ts | existant | |
| — | 104 | Refus de fusion | merge_conflict, not_ready, merge_refused, not_open traduits (critère 8) | propositions-testables.spec.ts et propositions-revue.spec.ts S-0014-08 | existant | |
| — | 104 / 108 | Revue faite → compteur orange de la navigation | Le compteur baisse (ADR 0013) | accueil-revue.spec.ts S-0010-13 | existant | |
| — | 104 | WebKit : file, proposition et diff en lecture | Rendu sans écriture | parcours.webkit.spec.ts S-0026-06 | existant | |
| — | 104 | Accessibilité de la file et du détail | axe-core sans violation sérieuse | propositions.spec.ts | existant | |
| — | 104 | Seul compte habilité | Mention à l'écran et fusion (ADR 0008) | propositions-testables.spec.ts S-0006-12 | existant | |
| — | 104 | Cycle de revue à deux | Changements demandés, réponse, nouvelle approbation, fusion | bout-en-bout.spec.ts S-0035-02 | existant | |
| — | 104 | Filtrer par KPI et par auteur | Brief 10.4 : « filtrables par domaine, KPI, auteur, entité, statut » | — | non testé | Les documents se contredisent : le plan 0014 et la maquette ne retiennent que trois filtres. À trancher |
| — | 104 | Statut « Approuvées / Refusées » de la maquette | L'ADR 0018 les remplace par Ouvertes, Fusionnées, Fermées, Toutes | S-UI-104-03 | note | Testé selon l'ADR, plus récente que la maquette |
| — | 104 | Date relative « il y a 2 h » | Maquette | — | non testé | Affichage seul, dépend de l'horloge |
| — | 104 | Notifications | — | — | non testé | Hors périmètre (plan 0014) |
| — | 104 | Modifier une proposition | Passe par l'éditeur | — | non testé | Autre lot (éditeur) |
| — | 104 | Réponse tardive de l'ancien filtre (critère 9, seconde moitié) | Ne doit pas écraser la file courante | — | non testé | La course ne se reproduit qu'en retardant les réponses par `page.route`, exclu par la règle 2 ; Vitest conseillé |
| — | 104 | Refus head_changed, branch_protected, cannot_review_own, comment_required | Messages de l'ADR 0043 | rattachement.spec.ts S-0006-13 (branch_protected) | non testé | head_changed : pas de geste déterministe ; les deux derniers sont empêchés par l'écran (S-UI-104-07, S-0014-05) |
| — | 104 | État « Préparation du diff… » | Statut de chargement | — | non testé | Transitoire ; Vitest conseillé |

| S-UI-104-21 | 104 | Filtrer par KPI puis auteur, recharger et revenir en arrière | Filtres combinés conservés dans l’adresse (ADR 0057, 0018) | ui-propositions.spec.ts | à vérifier | Playwright non exécuté dans ce lot |

## 105 — Comparaison

| Id | Écran | Action de l'utilisateur | Résultat attendu (source : fichier, section) | Test (fichier) | Statut | Observé si rouge |
|---|---|---|---|---|---|---|
| S-UI-105-01 | 105 | Changer de KPI dans la liste du lancement | Les déclinaisons et scopes sont ceux du nouveau KPI ; l'adresse (`kpi=`) tient au rechargement ; le retour arrière revient au KPI précédent (plan 0015, Lancement ; ADR 0019) | ui-comparaison.spec.ts | vert | |
| S-UI-105-02 | 105 | Ouvrir le lancement avec une déclinaison en retard sur le canonique | Case grisée, non cochée, raison « Non comparable : Déclinaison de la v3… » liée à la case (ADR 0019, setup ; plan 0015, `unavailable`) | ui-comparaison.spec.ts | vert | |
| S-UI-105-03 | 105 | KPI sans scope déclaré | « Ce KPI ne déclare aucun scope de comparaison », pas de bandeau de surcharge (plan 0015) | ui-comparaison.spec.ts | vert | |
| S-UI-105-04 | 105 | Filtre Domaine de la matrice (Supply chain, Finance) | Seules les lignes du domaine ; `domain=` tient au rechargement ; retour arrière ; axe sans violation (guide 10.5 ; plan 0015) | ui-comparaison.spec.ts | vert | |
| S-UI-105-05 | 105 | Décocher nordis-es au clic puis lancer | La demande ne porte que de et fr ; le détail propose ces deux déclinaisons ; ES reste « non comparé » ; l'historique ne cite pas ES (maquette, guide 10.5 ; plan 0015) | ui-comparaison.spec.ts | vert | |
| S-UI-105-06 | 105 | Tout décocher puis Lancer, puis recocher | Bouton `aria-disabled`, « Cocher au moins une déclinaison. », aucune demande ; recocher rétablit le lancement (plan 0015) | ui-comparaison.spec.ts | vert | |
| S-UI-105-07 | 105 | Granularité « Mois fiscal » puis lancer | Détail « par Mois fiscal », colonnes Mois fiscal / Canonique / Déclinaison / Écart, sans Entité (guide 10.5, Détail ; plan 0015) | ui-comparaison.spec.ts | vert | |
| S-UI-105-08 | 105 | Curseur de tolérance au clavier (flèches, Début, Fin) et à la souris | Valeur, libellé et `aria-valuetext` suivent ; bornes 0 et 5 ; « (globale 1 % · KPI 1,5 %) » (maquette, guide 10.5) | ui-comparaison.spec.ts | vert | |
| S-UI-105-09 | 105 | Lancer après avoir réglé le curseur | Le détail porte la tolérance choisie (plan 0015) | ui-comparaison.spec.ts | vert | |
| S-UI-105-10 | 105 | Relancer quatre fois | Quatre comparaisons distinctes (guide 10.5, « Relancer ») | ui-comparaison.spec.ts | vert | |
| S-UI-105-11 | 105 | Lire le bandeau d'historique | Les trois dernières, la plus récente d'abord, et « Tout voir » (guide 10.5 ; plan 0015) | ui-comparaison.spec.ts | vert | |
| S-UI-105-12 | 105 | Cellule de la matrice atteinte à Tab, ouverte à Entrée | `variant=nordis-es`, `aria-current`, contour 2 px (guide 10.5, cellule sélectionnée) | ui-comparaison.spec.ts | vert | |
| S-UI-105-13 | 105 | Recharger la page sur un détail ouvert | Même détail, même cellule marquée (plan 0015, `?id=&variant=`) | ui-comparaison.spec.ts | vert | |
| S-UI-105-14 | 105 | Retour arrière après changement de cellule | Cellule et détail précédents (plan 0015) | ui-comparaison.spec.ts | vert | |
| S-UI-105-15 | 105 | Clic sur une entrée du bandeau d'historique | Rouvre cette comparaison (plan 0015, « chaque ligne rouvrant ses résultats ») | ui-comparaison.spec.ts | vert | |
| S-UI-105-16 | 105 | « Tout voir », filtres KPI, « Depuis le » (2999 puis effacé), Utilisateur, rechargement | Liste filtrée ; état vide ; filtres gardés au rechargement ; axe sans violation (plan 0015, Historique) | ui-comparaison.spec.ts | vert | |
| S-UI-105-17 | 105 | Ligne d'historique, retour arrière, « ← Retour à la comparaison » | Ouvre les résultats ; le retour revient à la liste ; le lien revient au lancement (plan 0015) | ui-comparaison.spec.ts | vert | |
| S-UI-105-18 | 105 | Lien « Mes connexions » du bandeau « Connexion requise » | Mène à Mes connexions, sans champ de token ; retour arrière (plan 0015, critère 12 ; ADR 0019) | ui-comparaison.spec.ts | vert | |
| S-UI-105-19 | 105 | Synthèse en erreur serveur (500), puis « Réessayer » | Bandeau traduit **et une action** (ADR 0013, États du serveur) | ui-comparaison.spec.ts | **rouge** | Bandeau « L'opération a échoué · Erreur interne du serveur. » sans bouton ; seul un rechargement relit la matrice |
| S-UI-105-20 | 105 | Hors ligne au clic sur Lancer, puis « Réessayer » | Bandeau « Serveur local injoignable », rien n'est lancé, l'écran revient (ADR 0013) | ui-comparaison.spec.ts | vert | |
| S-UI-105-21 | 105 | Choisir un KPI décliné dont la sortie passe par une jointure (Panier moyen décliné pour nordis-fr) | Ses déclinaisons, ou la raison pour laquelle elles ne se comparent pas (ADR 0019, setup ; plan 0015, Lancement) | ui-comparaison.spec.ts | **rouge** | « Serveur local injoignable » ; le panneau reste sur « Chargement du KPI… » ; Panier moyen étant le premier KPI, l'écran est bloqué dès l'ouverture |
| S-UI-105-22 | 105 | WebKit : cases à la barre d'espace, tout décocher puis Entrée | Bascule ; « Cocher au moins une déclinaison. » ; recocher rétablit ; axe sans violation | ui-comparaison.webkit.spec.ts | vert | |
| S-UI-105-23 | 105 | WebKit : curseur au clavier et à la souris | Comme 105-08 | ui-comparaison.webkit.spec.ts | vert | |
| S-UI-105-24 | 105 | WebKit : listes Granularité et Domaine, lancement à Entrée, cellule au clavier (Option+Tab) | Détail « par Mois fiscal », `aria-current` | ui-comparaison.webkit.spec.ts | vert | |
| S-UI-105-25 | 105 | Scope fy2026-t4 (période de calendrier), puis retour au premier scope | « Période : FY2026_Q4 » remplace Du / Au ; le retour les rend ; le détail ne porte que juillet à septembre 2026 (plan 0015, scope ; ADR 0019) | ui-comparaison.spec.ts | vert | |
| — | 105 | Lancer : barres de progression, matrice | 94 % / 6,1 % (DE), 75 % (ES) (critère 1) | comparaison.spec.ts S-0009-01, S-0022-01, S-0015-01 | existant | |
| — | 105 | Clic sur une cellule, ligne hors tolérance, « Nœud divergent » | Sept. 2026 hors tolérance, valeur exacte en `title`, lien vers la fiche (critères 2 et 6) | comparaison.spec.ts S-0015-02, S-0015-06 | existant | |
| — | 105 | Bandeau de bypass de cardinalité avant lancement | Cite le nœud, suit granularité et tolérance (critère 3) | comparaison-bypass.spec.ts S-0009-05, S-0015-03 | existant | |
| — | 105 | Raccourcir la période Du / Au ; couleurs des seuils | Mois exclus retirés ; seuils colorés | comparaison-resultats.spec.ts S-0015-01 | existant | |
| — | 105 | État vide : « non comparé », historique vide, domaine sans KPI | Messages affichés | comparaison-resultats.spec.ts S-0015-07 | existant | |
| — | 105 | « Tout voir », filtre Utilisateur | Liste filtrée (critère 7) | comparaison.spec.ts S-0015-07 | existant | |
| — | 105 | Tolérance à 5 % appliquée ; curseur à 8 | Calcul avec la tolérance choisie (critère 11) | comparaison-resultats.spec.ts, comparaison.spec.ts S-0015-11 | existant | |
| — | 105 | Annuler (simulé, puis sur une vraie exécution) | Statut « Annulé », requête annulée chez la plateforme (critère 5) | comparaison.spec.ts, comparaison-reelle.spec.ts S-0015-05, S-0009-10 | existant | |
| — | 105 | Double clic sur Lancer | Une seule demande (critère 8) | comparaison.spec.ts S-0015-08 | existant | |
| — | 105 | Comparaison déjà en cours | Refus traduit (ADR 0042) | comparaison.spec.ts, comparaison-reelle.spec.ts S-0009-13 | existant | |
| — | 105 | Suivi en échec, échec de l'annulation | Messages, nouveau lancement possible (critères 9 et 10) | comparaison.spec.ts S-0015-09, S-0015-10 | existant | |
| — | 105 | « Se connecter à… » (OAuth), double clic, « Recommencer la connexion » | Une autorisation, puis reprise du lancement (critères 4 et 13) | comparaison-auth.spec.ts, comparaison-reelle.spec.ts S-0015-04, S-0009-06, S-0015-13 | existant | |
| — | 105 | Accès perdu au lancement | Explication, lien de reconnexion (critère 12) | comparaison.spec.ts S-0015-12 | existant | |
| — | 105 | Cellules absentes, déclinaisons refusées | Valeurs explicites, refus nommés (plan 0022) | comparaison-cellules.spec.ts, comparaison-refus.spec.ts S-0009-03, S-0009-04, S-0022-02 à 05 | existant | |
| — | 105 | WebKit : lancement et détail ; parcours de bout en bout | Matrice, détail, historique | parcours.webkit.spec.ts S-0026-07 ; bout-en-bout.spec.ts S-0035-05, S-0035-06 | existant | |
| — | 105 | Survol d'un écart pour lire la valeur exacte | Infobulle native `title` (critère 6) | — | non testé | L'infobulle native n'est pas observable par Playwright ; seule la présence de `title` est vérifiée (S-0015-02) |
| — | 105 | Saisir « Du » postérieur à « Au » | — | — | non testé | Comportement non documenté |
| — | 105 | Comparaison par un lecteur | — | — | non testé | Droits non documentés (exécution « avec vos droits ») |
| — | 105 | Déclinaison YAML invalide | Le KPI apparaît dans la liste, le panneau dit « Ce KPI n'a pas de déclinaison. » | — | note | Incohérence mineure, sans source documentaire pour en faire un rouge |

## 106 — Connexions

| Id | Écran | Action de l'utilisateur | Résultat attendu (source : fichier, section) | Test (fichier) | Statut | Observé si rouge |
|---|---|---|---|---|---|---|
| S-UI-106-01 | 106 | Ouvrir Mes connexions ; se connecter (OAuth), recharger ; révoquer, recharger | Titre, sous-titre sur les tokens locaux ; « Connecté · session OAuth » sans rechargement et après ; « Jamais connecté » et « Se connecter » après révocation, y compris après rechargement (maquette et guide 10.6 ; plan 0016, critères 2 et 3 ; ADR 0020) | ui-connexions.spec.ts | vert | |
| S-UI-106-02 | 106 | Ouvrir la liste Plateforme ; choisir entité et plateforme ; modifier l'identifiant ; passer à Snowflake (SSO, paire de clés) | Seulement Databricks et Snowflake ; identifiant déduit (dbx-de…) puis figé ; champs Compte, Entrepôt, Rôle, Authentification (guide 10.6 ; plan 0016, critère 6 ; ADR 0020 ; plan 0018) | ui-connexions.spec.ts | vert | |
| S-UI-106-03 | 106 | Justification vide ou faite d'espaces | « Proposer le point d'accès » reste désactivé ; le panneau dit que la déclaration passe par une proposition (plan 0016 ; ADR 0020) | ui-connexions.spec.ts | vert | |
| S-UI-106-04 | 106 | « Tester la connexion » avant de s'authentifier | « Pas encore connecté » et sa consigne, sans code brut (ADR 0044) | ui-connexions.spec.ts | vert | |
| S-UI-106-05 | 106 | « Annuler la connexion » du panneau | Champs verrouillés pendant le flux, puis libérés ; saisie gardée ; relance possible (ADR 0044) | ui-connexions.spec.ts | vert | |
| S-UI-106-06 | 106 | Panneau Snowflake : SSO, test, puis paire de clés | Connecté, test OK, clé rangée, passphrase absente de la page (plan 0018) | ui-connexions.spec.ts | vert | |
| S-UI-106-07 | 106 | « Annuler » du repli token personnel ; « Annuler » du formulaire Snowflake d'une ligne | Le champ ou le formulaire se referme, rien n'est enregistré, « Jamais connecté » après rechargement (ADR 0020) | ui-connexions.spec.ts | vert | |
| S-UI-106-08 | 106 | Liste en erreur serveur (coffre indisponible) | Bandeau traduit, sans texte brut (ADR 0044) | ui-connexions.spec.ts | vert | |
| S-UI-106-09 | 106 | Liste en erreur d'API, puis « Réessayer » | Bandeau avec le message **et l'action** (plan 0010, États ; ADR 0013) | ui-connexions.spec.ts | **rouge** | Bandeau « Trousseau du système indisponible » sans bouton : il faut quitter l'écran ou recharger |
| S-UI-106-10 | 106 | Serveur local injoignable, puis « Réessayer » | Bandeau critique, puis la liste se recharge (ADR 0013) | ui-connexions.spec.ts | vert | |
| S-UI-106-11 | 106 | Plateforme autorisée mais pas prise en charge (BigQuery) | Option « BigQuery (bientôt) » grisée ; « Bientôt dans Atlas » sur la ligne (ADR 0020) | ui-connexions.spec.ts | vert | |
| S-UI-106-12 | 106 | WebKit : « Ajouter un point d'accès » au clavier, entité, plateforme, identifiant | Le focus va au panneau ; identifiant déduit puis figé (ADR 0020) | ui-connexions.webkit.spec.ts | vert | |
| S-UI-106-13 | 106 | WebKit : se connecter, révoquer à Entrée | Comme 106-01 | ui-connexions.webkit.spec.ts | vert | |
| S-UI-106-14 | 106 | WebKit : formulaire Snowflake d'une ligne, envoi par Entrée | Entrée ouvre le SSO (guide 6) | ui-connexions.webkit.spec.ts | vert | |
| S-UI-106-15 | 106 | WebKit : « Annuler la connexion » du panneau | Comme 106-05 | ui-connexions.webkit.spec.ts | vert | |
| S-UI-106-16 | 106 | Liste des points d'accès lente ; retaper un identifiant déjà pris | « Chargement du formulaire… » sans champ ni « Ajouter » actif ; puis identifiant libre (dbx-de) qui ne change plus ; dbx-fr retapé refusé, saisie gardée (ADR 0020) | ui-connexions.spec.ts | vert | |
| S-UI-106-17 | 106 | WebKit : liste des points d'accès lente | Comme 106-16 | ui-connexions.webkit.spec.ts | vert | |
| — | 106 | Tableau : plateforme, schéma, propriétaire, fraîcheur, mon accès | Plan 0016, critère 1 | connexions.spec.ts S-0016-01 | existant | |
| — | 106 | Double clic sur « Se connecter » ; « Annuler » d'une ligne pendant l'OAuth | Un seul flux ; flux arrêté, la page tardive ne connecte rien (critère 7 ; ADR 0044) | connexions-testables.spec.ts S-0016-07 | existant | |
| — | 106 | Autorisation laissée sans réponse | Délai dépassé au bout de 5 min, relance possible (ADR 0020) | connexions-etats.spec.ts S-0016-10 | existant | |
| — | 106 | Tester : succès, hôte injoignable, refus de la plateforme, port OAuth occupé, accès retiré | « Connexion OK · n ms », ou titre et consigne sans texte brut (critère 9 ; ADR 0044) | connexions.spec.ts S-0016-01 ; connexions-testables.spec.ts S-0008-03, S-0016-09 | existant | |
| — | 106 | Tester un accès expiré, puis « Reconnecter » | Explication, la ligne propose « Reconnecter » (critère 8) | connexions-testables.spec.ts S-0016-08, S-0018-07 | existant | |
| — | 106 | Repli « Utiliser un token personnel » après échec de l'OAuth | Champ masqué, vidé, jamais affiché (ADR 0020) | connexions-testables.spec.ts S-0008-05 | existant | |
| — | 106 | Ligne Snowflake : SSO, puis paire de clés (fichier et passphrase) | Connecté, passphrase vidée et absente du DOM (plan 0018) | connexions.spec.ts S-0018-02 ; connexions-testables.spec.ts S-0018-02, S-0018-07 | existant | |
| — | 106 | « Ajouter un point d'accès » ; Hôte, SQL warehouse, Schéma ; « S'authentifier avec OAuth » ; « Proposer le point d'accès » ; « Voir la proposition » ; « Oublier » un brouillon | Focus au panneau ; connecté ; « Proposition n° X ouverte » et son lien ; brouillon oublié (guide 10.6 ; ADR 0020) | connexions.spec.ts « nouveau point d'accès » ; rattachement.spec.ts S-0033-07 ; parcours.webkit.spec.ts S-0026-08 | existant | |
| — | 106 | Plateforme retirée par le référent | Absente du panneau, déclaration refusée (critère 6) | connexions-testables.spec.ts S-0008-07, S-0016-06 | existant | |
| — | 106 | Identifiant déjà déclaré | Refus qui renvoie à la liste (ADR 0020) | connexions-etats.spec.ts S-0016-12 | existant | |
| — | 106 | Se connecter ou se déconnecter de GitHub (dépôt de l'espace) | Device flow, déconnexion (plan 0025) | github.spec.ts S-0025-* | existant | |
| — | 106 | Droits : lecteur, aucune plateforme autorisée, contributeur | Lecteur sans panneau ni bouton ; « Configurer les plateformes » ; le contributeur propose (plan 0016 ; ADR 0020) | connexions-etats.spec.ts S-0016-11 ; connexions.spec.ts | existant | |
| — | 106 | Changer d'espace | La liste change, aucune connexion d'un autre espace (critère 4) | connexions.spec.ts S-0016-04 ; connexions-testables.spec.ts S-0008-02 | existant | |
| — | 106 | État vide | « ne déclare encore aucun point d'accès » | connexions.spec.ts S-0016-04 | existant | |
| — | 106 | Aucun token dans le DOM ni dans le stockage, aucun champ de token à la main | Plan 0016, critère 5 ; guide 10.6 | connexions.spec.ts S-0016-01 ; connexions-testables.spec.ts S-0008-05, S-0008-10, S-0018-07 | existant | |
| — | 106 | Accessibilité | axe sans violation sérieuse (guide 6) | connexions.spec.ts ; connexions-etats.spec.ts | existant | |
| — | 106 | « Choisir… » le fichier de clé (dialogue Tauri) | Sélecteur de fichier natif (plan 0016 ; ADR 0022) | — | non testé | Le bouton n'existe que sous Tauri (`canPickFile`) |
| — | 106 | État « Chargement des points d'accès… » | Plan 0010, États | — | non testé | Transitoire ; Vitest conseillé |
| — | 106 | « Connecté · expire dans n j » | Maquette 10.6 | — | non testé | L'échéance n'est connue que pour un token personnel daté ; le faux Databricks n'en fournit pas |
| — | 106 | BigQuery « Se connecter » de la maquette | ADR 0020 : « Bientôt dans Atlas » tant que la plateforme n'est pas prise en charge | S-UI-106-11 | note | Testé selon l'ADR |

## 107 — Administration

| Id | Écran | Action de l'utilisateur | Résultat attendu (source : fichier, section) | Test (fichier) | Statut | Observé si rouge |
|---|---|---|---|---|---|---|
| S-UI-107-01 | 107 | Modifier les validateurs, cocher BigQuery, ajouter un domaine et un membre, puis « Annuler » en bas | Tout revient à l'état relu ; rien d'enregistré après rechargement (guide 10.7 ; plan 0017) | ui-administration.spec.ts | vert | |
| S-UI-107-02 | 107 | « + Domaine » : libellé vide, identifiant déjà pris, identifiant modifié à la main, « Annuler » du formulaire | « Le libellé est requis. », « Un domaine porte déjà cet identifiant. », identifiant figé, « Appliquez ou annulez… », rien n'est ajouté (plan 0017 ; guide 10.7) | ui-administration.spec.ts | vert | |
| S-UI-107-03 | 107 | « + Domaine » Achats, référent et validateurs cochés au clavier, Entrée sur « Ajouter le domaine », enregistrer | « Référent Marc D. · 2 validateurs · 0 KPI », présent après rechargement (maquette et guide 10.7 ; plan 0017) | ui-administration.spec.ts ; ui-administration.webkit.spec.ts | vert (Chromium et WebKit) | |
| S-UI-107-04 | 107 | Désigner Claire M. référente de Marketing | Identifiant inchangé ; « Aucun référent » à 0, encore après enregistrement (brief 10.7 ; plan 0017) | ui-administration.spec.ts | vert | |
| S-UI-107-05 | 107 | Validateurs propres à Finance : 0 refusé, 3 accepté, puis surcharge retirée | « canonique 3 · déclinaisons 1 » enregistré, puis retiré, chaque fois après rechargement (plan 0017 ; ADR 0027) | ui-administration.spec.ts | vert | |
| S-UI-107-06 | 107 | Validateurs canoniques au clavier : flèches, plancher à 1, 0 saisi | « Au moins 1. », enregistrement désactivé, 1 après rechargement (plan 0017, critère 3) | ui-administration.spec.ts ; ui-administration.webkit.spec.ts | vert (Chromium et WebKit) | |
| S-UI-107-07 | 107 | Lire les plateformes autorisées | Mode d'authentification de chacune des 5 plateformes ; mention du coffre personnel (brief 10.7 ; maquette) | ui-administration.spec.ts | vert | |
| S-UI-107-08 | 107 | Plateformes cochées et décochées à la barre d'espace, enregistrées | Focus gardé sur la case ; BigQuery coché et Snowflake décoché après rechargement (plan 0017) | ui-administration.spec.ts ; ui-administration.webkit.spec.ts | vert (Chromium et WebKit) | |
| S-UI-107-09 | 107 | Modifier un membre : « Annuler » du formulaire, « + Ajouter un rôle », « Retirer le rôle 2 », nom, entité, rôle Validateur sur Ventes | Ligne « Anna Keller / nordis-fr / Validateur / Ventes », après rechargement (plan 0023 ; ADR 0021) | ui-administration.spec.ts | vert | |
| S-UI-107-10 | 107 | Lire le tableau des membres et le dépôt rattaché | En-têtes Nom / Entité / Rôle / Domaines ; adresse et branche main en lecture seule, sans « Rattacher » (ADR 0021 ; maquette 10.7) | ui-administration.spec.ts | vert | |
| S-UI-107-11 | 107 | Confirmation de sortie au clavier : focus initial, Tab, Maj+Tab, Échap, Entrée | Focus sur « Annuler » ; Tab reste entre les deux boutons ; Échap reste et rend le focus au lien ; Entrée quitte, brouillon abandonné (ADR 0043 ; plan 0034, « Clavier et focus ») | ui-administration.spec.ts ; ui-administration.webkit.spec.ts | vert Chromium, **reporté WebKit** | Reporté le 13 novembre 2026 : navigation au clavier non prioritaire. Sous WebKit, Tab depuis « Annuler » part sur BODY, puis sur les champs « Validateurs requis » derrière le dialogue |
| S-UI-107-12 | 107 | Quitter par le sélecteur d'espace avec un brouillon | « Annuler » rend le focus au sélecteur, brouillon gardé ; « Quitter sans enregistrer » ouvre l'accueil (ADR 0043) | ui-administration.spec.ts | vert | |
| S-UI-107-13 | 107 | Ouvrir l'Administration quand le chargement échoue (500), puis « Réessayer » | Bandeau avec le message **et l'action** (plan 0010, États ; ADR 0013 ; guide 3.7) | ui-administration.spec.ts | **rouge** | Bandeau « Erreur interne du serveur. » sans bouton, formulaire absent ; seul le rechargement en sort |
| S-UI-107-14 | 107 | Enregistrer serveur injoignable, puis « Réessayer » | Brouillon conservé, bouton actif, puis fusion ; BigQuery coché après rechargement (guide 3.7 ; plan 0010) | ui-administration.spec.ts | vert | |
| S-UI-107-15 | 107 | « Synchroniser » serveur injoignable, puis de nouveau | Alerte dans la région du dépôt sans texte brut ; bouton réactivé ; la seconde réussit (guide 3.7 ; plan 0010) | ui-administration.spec.ts | vert | |
| — | 107 | Référent seul : bandeau, domaine sans référent, enregistrement fusionné | Plan 0017, critères 2, 3, 6, 8 | administration.spec.ts S-0017-02/03/06/08 | existant | |
| — | 107 | Contributrice, référente de domaine | Ni lien ni écran ni API (critère 1 ; ADR 0021) | administration.spec.ts S-0017-01 ; administration-etats.spec.ts S-0017-13 | existant | |
| — | 107 | Renommer un domaine | Seul le libellé change (critère 5) | administration.spec.ts S-0017-04/05 | existant | |
| — | 107 | Deux référents : BigQuery coché, enregistrement en proposition | Plan 0017, critère 8 | administration.spec.ts S-0017-08 | existant | |
| — | 107 | Inviter un membre : compte mal formé, doublon, ajout | Plan 0017 | administration-etats.spec.ts S-0017-12 | existant | |
| — | 107 | Retirer un domaine ou un membre ; rôles multiples ; refus motivés | Plan 0023, critères 1 à 4 ; ADR 0027 | administration.spec.ts S-0023-01 à 04 ; administration-etats.spec.ts S-0023-05 | existant | |
| — | 107 | « Synchroniser » | Date mise à jour, index reconstruit (critère 7) | administration.spec.ts S-0017-07, S-0020-* | existant | |
| — | 107 | Enregistrer sur une base périmée | stale_base, « Relire les paramètres » (ADR 0021) | administration-etats.spec.ts S-0017-11 | existant | |
| — | 107 | Quitter avec ou sans brouillon par la navigation ; saisie non appliquée | Confirmation, choix respecté ; aucune question sans brouillon (critères 9 et 10) | administration.spec.ts S-0017-09, S-0017-10 | existant | |
| — | 107 | Rattacher un dépôt depuis l'Administration ; réinitialiser | Plans 0033 et 0034 | rattachement.spec.ts ; reinitialisation.spec.ts | existant | |
| — | 107 | Parcours transverse | Plan 0035 | bout-en-bout.spec.ts S-0035-01 | existant | |
| — | 107 | Libellé du bouton d'enregistrement | Guide 10.7 « Enregistrer les paramètres » ; plan 0017 et guide 3.2 « Enregistrer et créer la proposition » / « Enregistrer et fusionner » | S-0017-08 | note | Le plan, plus précis, l'emporte |
| — | 107 | URL du dépôt modifiable (maquette) | ADR 0021 : lecture seule | S-UI-107-10 | note | Testé selon l'ADR |
| — | 107 | Rattacher ou réinitialiser sur un vrai GitHub | Plans 0033 et 0034, critère 9 | — | non testé | Compte et dépôt réels (à la main) |
| — | 107 | Échap dans les formulaires de domaine ou de membre | — | — | non testé | Aucun comportement documenté : ce ne sont pas des dialogues |
| — | 107 | Retour arrière du navigateur avec un brouillon | ADR 0043 : limite acceptée | — | non testé | Hors périmètre par décision |
| — | 107 | Fermer la fenêtre Tauri avec un brouillon | ADR 0043, issue 154 | — | non testé | Pas d'interception native ; impossible en Playwright |
| — | 107 | État « Chargement des paramètres… » | Plan 0010, États | — | non testé | Il faudrait retarder une réponse (exclu par la règle 2) ; Vitest conseillé |

## 108 — Cadre commun

| Id | Écran | Action de l'utilisateur | Résultat attendu (source : fichier, section) | Test (fichier) | Statut | Observé si rouge |
|---|---|---|---|---|---|---|
| S-UI-108-01 | 108 | Clic sur chaque élément de la barre latérale (référent) ; rechargement sur Connexions | Adresse de la vue, titre H1 focalisé, l'élément seul marqué courant ; le rechargement garde l'écran (guide 3.1 ; ADR 0013, Routage et Focus) | ui-cadre.spec.ts | vert | |
| S-UI-108-02 | 108 | Ouvrir une fiche depuis le catalogue, puis « Catalogue » | « Catalogue » reste l'élément courant sur la fiche (guide 3.1) | ui-cadre.spec.ts | vert | |
| S-UI-108-03 | 108 | Retour arrière et avance du navigateur entre trois écrans ; sélecteur d'espace puis retour arrière | Chaque écran revient, titre focalisé ; l'accueil puis l'écran quitté (ADR 0013, Routage) | ui-cadre.spec.ts | vert | |
| S-UI-108-04 | 108 | Sélecteur d'espace → accueil → créer et ouvrir un autre espace | Le nom de l'espace change, Administration apparaît selon le rôle, aucun KPI de l'autre espace (guide 1, principe 5 ; brief 5.3 et 10.0 ; plan 0010, critère 6) | ui-cadre.spec.ts | vert | |
| S-UI-108-05 | 108 | Ouvrir un espace dont le dépôt distant est injoignable, puis changer d'écran deux fois | Signal discret ; lecture sur la copie locale ; le signal ne revient pas à chaque changement d'écran (ADR 0049) | ui-cadre.spec.ts | **rouge** | Le signal disparaît sur Propositions, mais revient au retour sur Catalogue : il est rattaché à la vue où il est apparu (`app/src/screens/WorkspaceShell.tsx:185`, `notice.key === syncKey`) |
| S-UI-108-06 | 108 | Lire le bas de la barre latérale | Initiales, **nom** et rôle : « JH », « Julien H. », « Référent d'annuaire » (guide 3.1 ; maquettes 10.4 à 10.7) | ui-cadre.spec.ts | **rouge** | Barre latérale « JH julien.h Référent d'annuaire » : le compte au lieu du nom (`app/src/screens/WorkspaceShell.tsx:293` affiche `ws.account`) |
| S-UI-108-07 | 108 | Fenêtre à 960 × 640 : ouvrir chaque écran | Rien ne déborde de la page en largeur (guide 6 : fenêtre minimale, tableaux qui défilent dans leur conteneur) | ui-cadre.spec.ts | vert | |
| S-UI-108-08 | 108 | WebKit : clic sur chaque élément de la barre latérale | Comme 108-01 (règle 5) | ui-cadre.webkit.spec.ts | vert | |
| S-UI-108-09 | 108 | WebKit : retour arrière et avance | Comme 108-03 | ui-cadre.webkit.spec.ts | vert | |
| S-UI-108-10 | 108 | Ouvrir un espace dont la lecture répond 500, puis « Réessayer » | Bandeau traduit **avec une action** ; l'écran s'ouvre (ADR 0013, États ; plan 0010, États) | ui-cadre.spec.ts | **rouge** | Bandeau « L'opération a échoué » sans aucun bouton : il faut recharger la page (`app/src/screens/WorkspaceShell.tsx:241-245` et `:306-310`, branche `load.kind === "error"` sans action) |
| — | 108 | Navigation au clavier : sélecteur, navigation, titre focalisé à chaque vue | Plan 0010, critère 10 ; ADR 0013, Focus | accueil.spec.ts S-0010-01 | existant | |
| — | 108 | « Administration » absente pour un non-référent ; adresse tapée renvoyée au catalogue | Plan 0010, critère 7 ; ADR 0021 | accueil.spec.ts S-0010-07 ; administration.spec.ts S-0017-01 ; administration-etats.spec.ts S-0017-13 | existant | |
| — | 108 | Compteur orange de « Propositions » | ADR 0013, Compteurs | accueil-revue.spec.ts S-0010-13 | existant | |
| — | 108 | Serveur injoignable depuis un écran, puis « Réessayer » | Bandeau critique, puis l'écran (plan 0010, critère 5) | accueil.spec.ts S-0010-05 ; S-UI-104-15 ; S-UI-105-20 ; S-UI-106-10 | existant | |
| — | 108 | Hors ligne | Lecture, catalogue, graphe compilé ; envoi refusé puis renvoyé | hors-ligne.spec.ts S-0019-04 ; bout-en-bout.spec.ts S-0035-08 | existant | |
| — | 108 | Synchronisation occupée après tous ses essais | Bandeau, puis effacé au succès (ADR 0049) | synchronisation-auto.spec.ts S-0049-01 | existant | |
| — | 108 | Fusion faite par une collègue, puis changement d'écran | Catalogue et fiche relus (ADR 0049) | bout-en-bout.spec.ts S-0035-10 | existant | |
| — | 108 | Garde de sortie (onglet de la coque, sélecteur) | ADR 0043 | administration.spec.ts S-0017-09/10 ; S-UI-107-11, S-UI-107-12 | existant | |
| — | 108 | Bannière « Rattachement interrompu » de tout écran | Plan 0034, critère 10 | reinitialisation.spec.ts S-0034-10 | existant | |
| — | 108 | Bascule entre deux espaces sous WebKit | Plan 0026 | parcours.webkit.spec.ts S-0026-01 | existant | |
| — | 108 | Raccourcis globaux | Aucun raccourci global n'est documenté hors de l'éditeur (autre lot) | — | non testé | Pas d'oracle |
| — | 108 | Cmd+Q, « Quitter » du Dock | Fermeture par la fenêtre (issue 154) | fermeture-tauri.spec.ts | existant | |
| — | 108 | Vue inconnue tapée dans l'adresse | Catalogue (ADR 0013) | — | non testé | Pas de barre d'adresse sous Tauri : geste impossible pour l'utilisateur |
| — | 108 | État « Chargement de l'espace… » | Plan 0010, États | WorkspaceShell.test.tsx (Vitest) | non testé en e2e | Transitoire |
| — | 108 | Tab seul sous WebKit | Plan 0010, critère 10 | — | note | Voir « Remarques transverses » : Option+Tab sous WebKit |

## Script de démonstration

| Id | Écran | Action de l'utilisateur | Résultat attendu (source : fichier, section) | Test (fichier) | Statut | Observé si rouge |
|---|---|---|---|---|---|---|
| S-UI-DEMO-01 | — | `DEMO_SANS_APP=1 examples/demo/lancer-demo.sh <dossier temporaire>` | Code de sortie 0, « Préparation terminée », espace Groupe Nordis rejoint dans le dossier (`examples/demo/README.md`, Préparer ; en-tête du script) | demo-lancement.spec.ts | **rouge** | Code 1 : `examples/propositions-nordis.py:63` rejoint le dépôt local, refusé par `core/src/skifer_atlas/repo/git.py:166` (« Adresse de dépôt invalide : utiliser HTTPS ou SSH. ») ; `examples/demo/lancer-demo.sh` ne pose pas `ATLAS_ALLOW_LOCAL_GIT=1`. L'attente de `/health` sans token vient après, non atteinte |

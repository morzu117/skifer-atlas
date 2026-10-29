# Skifer Atlas — Guide de style et spécification des écrans

Version 1 — 29 octobre 2026. Destiné aux intégrateurs. Les maquettes de référence sont dans `screens/` (un HTML par écran, navigables entre eux), les tokens dans `tokens.css`. Chaque écran renvoie à la section 10 de `../brief.md`, qui reste la source de vérité fonctionnelle.

---

## 1. Principes

1. **Un outil, pas une vitrine.** Densité d'information élevée, tableaux et formulaires compacts, pas de décoration. Le modèle est un outil de DAG (Databricks Jobs, Dataiku), pas un site marketing.
2. **Le YAML est le pivot, le canevas n'est qu'une vue.** Tout ce qui est édité visuellement a un équivalent YAML strict ; on ne montre jamais une option qui n'existe pas dans le vocabulaire fermé.
3. **Rien ne se cache.** Un bypass de contrôle, une surcharge hors points déclarés, une variante from scratch sont toujours signalés, dans le graphe, dans la proposition et dans la comparaison.
4. **Les écarts ont une couleur et une seule.** Teal = normal, orange = à examiner, rouge = critique. Ces couleurs diffèrent aussi en luminosité, jamais la teinte seule ne porte le sens, et un libellé accompagne toujours la pastille.
5. **Contextualisé par l'espace.** Le sélecteur d'espace est visible en permanence ; tout contenu affiché appartient à l'espace courant.

---

## 2. Tokens

Voir `tokens.css`. Résumé :

| Rôle | Token | Valeur |
|---|---|---|
| Fond d'application | `--atlas-ground` | `#F3F7F6` |
| Panneaux, cartes | `--atlas-panel` | `#FFFFFF` |
| Bordures | `--atlas-line` / `--atlas-line-soft` | `#D6E3E0` / `#E6EEEC` |
| Texte principal | `--atlas-ink` | `#14302F` |
| Texte secondaire | `--atlas-muted` | `#5B7470` |
| Marque (sidebar, boutons primaires) | `--atlas-brand` | `#1C4F4D` |
| Navigation active, succès | `--atlas-mid` | `#2E8C83` |
| Accent sur fond sombre | `--atlas-mint` | `#9FE1CF` |
| Fond de badge, sélection | `--atlas-pale` | `#E3F5F0` |
| À examiner | `--atlas-warn` | `#C2641E` |
| Critique | `--atlas-bad` | `#B13B3B` |

Contrastes vérifiés : `--atlas-muted` sur blanc 4.6:1, `--atlas-pale` sur `--atlas-brand` 9.8:1, `--atlas-warn` sur blanc 4.6:1, `--atlas-bad` sur blanc 6.4:1. Ne pas éclaircir ces couleurs.

**Typographie** : Inter (400, 500, 600, 700) pour l'interface ; JetBrains Mono (400, 500) pour tout ce qui est identifiant, expression, chemin, schéma, YAML, SQL. Taille de base 14 px ; 13 px dans les tableaux et l'éditeur ; 12 px pour les métadonnées ; 11 px minimum (libellés de nœuds, badges), jamais en dessous. Les polices sont chargées localement dans l'app (pas de Google Fonts en production, l'app peut tourner hors ligne).

**Espacement** : base 4 px. Padding des cartes 16 à 22 px, gap entre cartes 16 à 20 px, padding de page 28 px × 32 px.

**Rayons** : 6 px (nœuds, champs compacts), 8 px (boutons, champs), 12 px (cartes, panneaux), pilule pour les badges.

---

## 3. Composants

### 3.1 Coque applicative

- **Barre latérale** `232 px`, fond `--atlas-brand`, texte `--atlas-pale`. De haut en bas : logo + « Skifer / Atlas », sélecteur d'espace, navigation, utilisateur courant en bas (avatar initiales sur `--atlas-mint`, nom, rôle).
- **Sélecteur d'espace** : bloc `--atlas-deep` bordé `--atlas-mid`, libellé « ESPACE » en 10 px capitales espacées, nom de l'espace en 14 px semi-gras, chevron haut/bas. Clic → page d'accueil des espaces (10.0). Hauteur 44 px.
- **Navigation** : Catalogue, Propositions (compteur orange des propositions en attente pour l'utilisateur), Comparaison, Connexions, Administration (visible seulement pour le référent). Élément actif : fond `--atlas-mid`, texte blanc, semi-gras. Icônes 18 px, trait 2 px.
- **Zone principale** : `flex: 999 1 560px`, padding 28 × 32 px, titre H1 24 px gras, actions principales alignées à droite du titre.
- **Écrans sans barre latérale** : l'accueil des espaces (10.0, en-tête simple) et l'éditeur (10.3, barre d'outils dédiée, retour vers la fiche).

### 3.2 Boutons

| Type | Style | Hauteur |
|---|---|---|
| Primaire | fond `--atlas-brand`, texte blanc, 600 | 44 px |
| Secondaire | bordure et texte `--atlas-brand`, fond blanc | 44 px |
| Neutre | bordure `--atlas-line`, texte `--atlas-ink` | 44 px (36 px en contexte dense) |
| Avertissement | bordure et texte `--atlas-warn` | 44 px |
| Destructif | texte `--atlas-bad`, bordure `--atlas-line` | 36 px |
| Barre d'outils | 32 × 32 px, icône 16 px, actif : fond `--atlas-pale` bordure `--atlas-brand` | 32 px |

Un bouton qui crée quelque chose commence par « + ». Les boutons d'action qui déclenchent une proposition disent ce qu'ils font : « Enregistrer et créer la proposition », « Soumettre la proposition », jamais un simple « OK ».

### 3.3 Champs

Input et select : 40 px (32 px dans l'éditeur), bordure `--atlas-line`, rayon 8 px (6 px dans l'éditeur), libellé 13 px `--atlas-muted` au-dessus. Les champs techniques (clés, expressions, hôtes, schémas) sont en JetBrains Mono. Un champ obligatoire porte « requis » ou `*` en `--atlas-bad`. Les groupes de choix exclusifs (contrôle de cardinalité) sont des radios, pas des cases à cocher.

### 3.4 Badges et pastilles

- **Type** : KPI = fond `--atlas-brand` texte blanc ; Concept = fond `--atlas-pale` texte `--atlas-brand`. 12 px 600, rayon 6 px.
- **Domaine** : fond `--atlas-pale`, texte `--atlas-brand`.
- **Rôle** : référent = fond `--atlas-brand` ; validateur = fond `--atlas-pale` ; contributeur / lecteur = fond `--atlas-ground` bordure `--atlas-line`. Pilule.
- **Mode de déclinaison** : « Surcharge · n » = pale ; « From scratch · candidate » = fond `--atlas-warn-bg`, bordure et texte `--atlas-warn`.
- **Point de variation** : étiquette « VARIATION » blanche sur l'en-tête du nœud, ou bordure pointillée orange 2 px sur une carte en lecture.
- **Convergence** (catalogue) : pastille 10 px + libellé. Teal « Convergé », orange « n candidate(s) », rouge « n divergences », gris `--atlas-line` « Jamais comparé ».

### 3.5 Tableaux

Fond blanc, bordure `--atlas-line`, rayon 12 px, en-têtes 12 px capitales espacées `--atlas-muted`, cellules 14 px (13 px en contexte dense), padding 14 × 16 px, séparateurs `--atlas-line-soft`. Ligne sélectionnée : fond `--atlas-pale` (plus bordure gauche 3 px `--atlas-brand` dans les listes maître-détail). Un tableau large est dans un conteneur `overflow-x: auto`, jamais tronqué.

### 3.6 Cartes et panneaux

Fond blanc, bordure `--atlas-line`, rayon 12 px, padding 16 à 22 px, titre de section en 12 px capitales espacées `--atlas-muted` 600. Pas d'ombre sauf sur les nœuds du canevas (`--atlas-shadow-node`).

### 3.7 Bandeaux d'alerte

Icône triangle 20 px + titre 600 + texte. À examiner : fond `--atlas-warn-bg` bordure `--atlas-warn`. Critique : fond `--atlas-bad-bg` bordure `--atlas-bad`. Information : fond `--atlas-pale`. Toujours une phrase qui dit quoi faire (« La validation de niveau canonique s'applique »).

### 3.8 Onglets

Texte 14 px, onglet actif 600 `--atlas-brand` souligné 3 px (2 px dans les panneaux de l'éditeur), inactif `--atlas-muted`. Compteur en pilule `--atlas-pale` quand l'onglet liste des éléments.

---

## 4. Représentation des graphes

Trois rendus d'un même graphe, du plus simple au plus riche. Ils partagent le code couleur des familles de nœuds.

| Famille | Nœuds | Couleur d'en-tête |
|---|---|---|
| Entrées | Source | `--atlas-node-source` |
| Entrées | Référence à un KPI | `--atlas-node-ref` |
| Lignes | Filtre, Dédoublonnage, Calcul de colonne, Opération temporelle | `--atlas-node-rows` |
| Combinaison | Jointure, Union | `--atlas-node-combine` |
| Résultat | Agrégation, Opération entre métriques | `--atlas-node-result` |

**Nœud en édition (10.3)** : 184 px de large (200 px pour une jointure, qui a deux ports d'entrée nommés « gauche » / « droite »), en-tête coloré avec le type en 10 px capitales, l'étiquette « VARIATION » si le nœud est un point de variation déclaré, et l'identifiant stable (`n04`) à droite. Corps : expression en JetBrains Mono 12 px 600, puis une ligne de métadonnées en 11 px `--atlas-muted` (nulls, cardinalité, fuseau…). Ports : cercles 12 px, bordure 2 px `--atlas-node-source`, fond blanc, centrés sur les bords. Nœud sélectionné : bordure 2 px `--atlas-mid` + halo 3 px `--atlas-pale`. Avertissement : ligne orange avec icône dans le corps du nœud.

**Arêtes** : orthogonales, 2 px `--atlas-node-source`, flèche pleine 7 × 10 px en bout. Avec React Flow : `type: "smoothstep"`, `markerEnd: ArrowClosed`. Trame du canevas 24 px, mini-carte en bas à droite.

**Nœud en lecture (10.2, 10.4)** : carte 150 px, bordure `--atlas-line`, type en 10 px capitales, libellé 13 px 600, métadonnée 11 px. Point de variation : bordure pointillée orange 2 px, fond `--atlas-warn-bg`. Résultat : bordure `--atlas-brand`, fond `--atlas-pale`.

**Diff (10.4)** : deux colonnes, canonique à gauche, proposition à droite, nœuds alignés par identifiant stable. Nœud modifié : bordure 2 px `--atlas-bad`, fond `--atlas-bad-bg`, étiquette « modifié » et classification à droite (« Divergence critique », « Normal », « À examiner »). Nœud surchargé sur un point déclaré : bordure pointillée orange, classification « Normal ». Ajouté / retiré : à définir avec la même grammaire (teal / rouge).

---

## 5. Écrans

Pour chaque écran : fichier de référence, zones, états, interactions attendues. Les données des maquettes sont fictives (client « Groupe Nordis », entités FR / DE / ES, KPI « Revenu net »).

### 10.0 Accueil des espaces — `screens/10.0-accueil-espaces.html`

- Pas de barre latérale. En-tête `--atlas-brand` : logo, utilisateur.
- Titre, phrase d'explication, bouton « + Créer un espace » (référent uniquement, sinon masqué).
- Grille de cartes (3 colonnes à 1040 px, `auto-fill minmax(280px)`) : initiales, badge de rôle, nom, secteur · n entités · n domaines, compteurs KPI / concepts / propositions en attente (orange si > 0).
- État vide : carte pointillée « Aucun espace pour l'instant ».
- Note de bas de page sur le coffre local (texte fixe).
- Clic sur une carte → Catalogue de cet espace.

### 10.1 Catalogue — `screens/10.1-catalogue.html`

- Recherche (couvre les synonymes), filtres Domaine / Propriétaire / Statut / Type en selects 44 px.
- Tableau : Nom (lien), Type, Domaine, Version, Déclinaisons, Convergence.
- Panneau d'aperçu à droite (`max-width: 340px`) sur sélection d'une ligne : nom, domaine · version · propriétaire, description, points de variation, déclinaisons, référencé par, dernière comparaison, bouton « Ouvrir la fiche ».
- « + Nouveau concept ou KPI » (contributeurs) → éditeur vide.
- À moins de 900 px de large, le panneau passe sous le tableau.

### 10.2 Fiche KPI — `screens/10.2-fiche-kpi.html`

- Fil d'Ariane « ‹ Catalogue ». En-tête : nom, badges Type / Domaine / version et date de validation, ligne propriétaire · validateurs requis · synonymes. Actions : « Lancer une comparaison » (secondaire), « Proposer une modification » (primaire, → éditeur sur une nouvelle version).
- Onglets : Définition, Déclinaisons (n), Versions (n), Dépendances, Implémentations, Scope et comparaisons.
- Onglet Définition : graphe canonique en lecture (section 4), légende, puis trois cartes : Sémantique déclarée, Déclinaisons (nom + badge de mode), Dépendances tous domaines (référence / référencé par, impact d'une nouvelle version en orange).
- Les autres onglets ne sont pas maquettés ; ils reprennent les composants tableau et diff.
- *Statut : à retravailler, en attente de retour.*

### 10.3 Éditeur de graphe — `screens/10.3-editeur-graphe.html`

- **En-tête** `--atlas-brand` : retour vers la fiche, « v5 · brouillon », métadonnées (schéma, nombre de nœuds et d'arêtes, dernier enregistrement local), « Éditer en YAML » (secondaire, bascule plein écran sur le YAML avec la même validation), « Soumettre la proposition » (fond `--atlas-mint`).
- **Barre d'outils** 32 px : sélection, pan, ajout d'arête, annuler / rétablir, disposition automatique, aligner, valider le graphe, aperçu SQL par plateforme ; zoom −, %, +, ajuster à droite.
- **Palette** 196 px : recherche, familles Entrées / Lignes / Combinaison / Résultat, chaque nœud glissable (carré de couleur 14 px + libellé). Rien d'autre n'est proposé.
- **Canevas** : trame 24 px, nœuds et arêtes selon la section 4, mini-carte 150 × 70 px en bas à droite.
- **Panneau de propriétés** 296 px, onglets Propriétés / Entrées / YAML du nœud. Les champs dépendent du type de nœud (tableau ci-dessous). Actions en bas : Dupliquer, Supprimer.
- **Panneau bas** : onglets Problèmes (n) / Colonnes en sortie du nœud sélectionné / SQL compilé ; à droite, l'état permanent « Schéma valide · Sans cycle · Compilable Databricks, Snowflake ». Chaque problème : sévérité (AVERT. orange, ERREUR rouge, INFO pale), identifiant du nœud en mono, message, « Aller au nœud ».

Champs obligatoires par type de nœud (panneau de propriétés) :

| Nœud | Champs |
|---|---|
| Source | plateforme, schéma, table, propriétaire (requis), pour chaque colonne temporelle : format et fuseau d'origine |
| Filtre | expression, « nulls : gardés / exclus » (requis) |
| Jointure | type, clés (couples choisis dans les colonnes amont), cardinalité attendue (requis), contrôle requis / bypass (radio), point de variation |
| Union | ordre des entrées, correspondance des colonnes |
| Calcul de colonne | nom, expression |
| Dédoublonnage | clés, règle de choix de la ligne gardée |
| Agrégation | fonction, mesures, granularité (dimensions) |
| Opération temporelle | fonction, calendrier (civil / fiscal), fuseau d'évaluation, point de variation |
| Référence à un KPI | KPI (recherche sur tout l'espace, tous domaines), version |
| Opération entre métriques | expression entre métriques agrégées, ordre calcul / agrégation explicite |

Tout nœud porte un libellé et une note facultative (« pourquoi ce nœud »).

### 10.4 Propositions — `screens/10.4-propositions.html`

- Maître-détail : liste 380 px à gauche (filtres Domaine / Statut / Entité en selects 36 px), détail à droite.
- Élément de liste : KPI · entité, badge de nature (« Hors points déclarés » orange plein, « Point déclaré » pale, « Nouvelle version » pale, « From scratch » orange bordé), ligne auteur · date, « Validations : obtenues / requises ». Élément sélectionné : fond pale + bordure gauche 3 px.
- Détail : titre, métadonnées (auteur, version de base, domaine, branche Git en mono), actions « Demander des changements » (avertissement) et « Approuver (n / m) » (primaire).
- Bandeau orange si la surcharge sort des points déclarés, avec la conséquence (validation canonique).
- Diff deux colonnes (section 4), puis Justification de l'auteur et fil de Commentaires avec champ de réponse.

### 10.5 Comparaison — `screens/10.5-comparaison.html`

- Panneau de lancement 340 px : KPI, déclinaisons (cases à cocher avec la plateforme), période, granularité, tolérance (slider, valeurs globale et KPI affichées), bandeau orange si un bypass de cardinalité est présent, progression par plateforme (barre teal), bouton « Relancer ».
- Synthèse : matrice KPI × déclinaison, cellules colorées (`--atlas-pale` / `--atlas-warn-cell` / `--atlas-bad-cell`, « — » gris si non comparé), contenu « % validation » gras + « écart max » 11 px ; cellule sélectionnée : contour 2 px `--atlas-warn` ou de la couleur de la cellule. Filtre Domaine en haut à droite.
- Détail : tableau par dimension (Mois, Canonique, Déclinaison, Écart), ligne hors tolérance sur fond `--atlas-warn-bg` avec écart en `--atlas-bad`, lien « Nœud divergent : … » vers la fiche.
- Historique : bandeau d'une ligne avec les trois dernières comparaisons et « Tout voir ».

### 10.6 Connexions — `screens/10.6-connexions.html`

- Titre « Mes connexions », sous-titre rappelant que les tokens sont locaux.
- Tableau : Plateforme (nom + entité · mode d'auth), Schéma (mono), Propriétaire, Fraîcheur, Mon accès (pastille + libellé : Connecté · expire dans n j / session SSO ; Token expiré ; Jamais connecté), actions (Tester / Révoquer ; Reconnecter ; Se connecter).
- Panneau 340 px « Nouveau point d'accès » : plateforme (limitée aux plateformes autorisées), hôte, schéma, entité, « S'authentifier avec OAuth » (primaire, lance le flux natif), « Tester la connexion ».
- Jamais de champ pour saisir un token à la main.

### 10.7 Administration — `screens/10.7-administration.html`

- Réservée au référent. Grille 2 colonnes de sections : Domaines métier (liste avec référent · validateurs · n KPI, « + Domaine », alerte orange si un domaine n'a pas de référent), Validateurs requis (deux champs numériques min 1, surcharges par domaine), Utilisateurs et rôles (tableau Nom / Entité / Rôle / Domaines, « + Inviter »), Dépôt Git (URL mono, branche, dernière synchronisation) et Plateformes autorisées (cases à cocher avec le mode d'auth).
- Boutons Annuler / Enregistrer les paramètres en bas à droite.
- Aucune information de token nulle part.

---

## 6. Accessibilité et règles d'intégration

- Toute action est un `<button>` ou un `<a href>`, jamais un `div` cliquable. Les boutons icône seuls ont un `aria-label`. Les SVG décoratifs sont `aria-hidden`.
- Cibles de 44 px pour les actions principales ; 32 px admis dans la barre d'outils de l'éditeur et les tableaux denses.
- Contrastes 4.5:1 sur tous les textes, y compris les 11 px.
- Le sens n'est jamais porté par la couleur seule : pastille + libellé, badge + texte.
- Les tableaux larges défilent horizontalement dans leur conteneur ; rien n'est tronqué.
- Les identifiants stables des nœuds (`n01`…) sont affichés partout où un nœud est nommé : c'est la clé qui relie le canevas, le YAML, le diff et le détail de comparaison.
- Les polices sont embarquées dans l'application.
- La fenêtre minimale est 960 × 640 ; les maquettes sont faites à 1280 × 820.

---

## 7. Ce qui n'est pas encore maquetté

- Onglets Déclinaisons, Versions, Implémentations, Scope de la fiche KPI.
- Vue YAML plein écran de l'éditeur.
- Formulaires de création d'espace, d'invitation d'utilisateur, de création de domaine.
- États de chargement et d'erreur réseau (le serveur local est injoignable, une plateforme refuse l'authentification).
- Historique complet des comparaisons.

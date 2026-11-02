# Démo : Atlas pour un démarrage à froid (10 minutes)

**Le message.** Au départ, le chiffre existe partout et sa définition nulle part : chaque entité a son SQL, dans son notebook, et personne ne peut dire lequel fait foi ni pourquoi les chiffres diffèrent en comité. Atlas part de ce SQL existant, en fait une définition lisible et versionnée, la compare entre entités au nœud près, et fait passer chaque modification par une revue.

## Préparer (la veille)

Depuis la racine du dépôt, sur un Mac de développement (uv, Node, Rust, comme dans le README racine) :

```sh
examples/demo/lancer-demo.sh            # dossier ~/atlas-demo, compte julien.h
```

Le script crée l'espace Groupe Nordis dans `~/atlas-demo`, avec l'historique de Revenu net, cinq propositions et trois points d'accès, puis ouvre l'app (Tauri, mode dev). Le premier lancement compile la partie Rust et prend plusieurs minutes : il faut le faire la veille. Chaque lancement recrée le dossier, si bien que la démo repart toujours du même état. Pour arrêter, il suffit de fermer la fenêtre. Avec `DEMO_SANS_APP=1`, le script s'arrête après la préparation (c'est ce que vérifie `core/tests/test_demo.py`).

Rien ne touche aux vraies données :
- les comparaisons tournent sur les données de test (`core/tests/fixtures/compare/revenu-net`) ;
- le coffre reste en mémoire ;
- les propositions vivent dans un dépôt Git local, `~/atlas-demo/distant.git`, à la place de GitHub.

Garder un second terminal ouvert à la racine du dépôt pour l'ouverture (étape 1).

## Déroulé

| Temps | Écran | Ce qu'on montre | Ce qu'on dit |
|---|---|---|---|
| 0:00 | — | Le contexte | « Trois filiales, un même KPI, le Revenu net. Chacune a son SQL ; au comité, les chiffres ne collent pas, et personne ne sait dire pourquoi. » |
| 0:45 | Terminal | Étape 1 : deux SQL deviennent deux définitions | « On ne part pas d'une page blanche : on part du SQL qui tourne déjà. » |
| 2:00 | Catalogue | Étape 2 : un seul endroit | « Voici ce que devient l'existant une fois rangé. » |
| 3:00 | Fiche Revenu net | Étape 3 : la définition lisible | « Ce que le chiffre veut dire, enfin écrit. » |
| 4:30 | Comparaison | Étape 4 : les écarts chiffrés, et leur cause | « Pas seulement *combien* ça diffère, mais *où* dans le calcul. » |
| 6:30 | Propositions, éditeur | Étape 5 : changer la définition passe par une revue | « Une modification est une proposition, relue par les bons validateurs. » |
| 8:30 | Administration | Étape 6 : qui décide quoi | « La gouvernance tient sur un écran, et elle aussi est versionnée. » |
| 9:15 | — | Ce qu'il faut pour démarrer | Voir la conclusion. |

### 1. Du SQL éparpillé à une définition (terminal)

```sh
cd examples/extraction
atlas() { uv run --quiet --project ../../core atlas "$@"; }
DEMO=~/atlas-demo                        # le dossier passé à lancer-demo.sh, s'il diffère
atlas extract revenu_net_databricks.sql --dialect databricks --out "$DEMO/brouillons"
atlas extract revenu_net_snowflake.sql --dialect snowflake --out "$DEMO/brouillons"
atlas diff "$DEMO/brouillons/revenu-net-databricks.yaml" "$DEMO/brouillons/revenu-net-snowflake.yaml" --relation free
```

- Ouvrir `revenu_net_databricks.sql` un instant : un `CREATE TABLE` banal, comme il en existe des dizaines.
- L'extraction en fait un brouillon YAML (`$DEMO/brouillons/`). Ce que le SQL ne dit pas vaut `TODO` : propriétaire, domaine, calendrier, fuseau. C'est exactement la liste des questions à poser.
- Le diff des deux implémentations trouve un écart **critique** : la France ne garde que les factures `validée`, l'autre filiale garde aussi les factures `émise`. Le diff ignore en revanche les fonctions de date, différentes d'un dialecte à l'autre mais de même sens.

### 2. Catalogue

- Les concepts (Commande, Client actif…) et les KPI, avec leur domaine, leur version et leurs déclinaisons.
- Taper « ca net » dans la recherche : Revenu net est trouvé par son synonyme. Chacun le cherche avec ses mots.
- Revenu net, trois déclinaisons, « Jamais comparé » : on va le comparer.

### 3. Fiche Revenu net

- **Définition** : le graphe se lit de gauche à droite : sources, filtre « Factures validées », calcul, jointure au calendrier comptable, mois fiscal, agrégation. Les cadres en pointillés marquent les points de variation, c'est-à-dire ce que chaque entité a le droit d'adapter.
- En haut : propriétaire, validateurs requis, synonymes. En bas : la sémantique (calendrier fiscal, fuseau, devise) et les dépendances (« Une nouvelle version touchera 2 documents »).
- **Implémentations** → « Extraire et comparer au canonique » : le SQL de la France, lu tel quel, comparé à la définition commune. Le résultat donne 10 écarts, et le SQL lui-même code la TVA en dur (`/ 1.2`). C'est le moment fort pour un démarrage à froid : on mesure tout de suite la distance entre l'existant et la cible.
- **Versions** : v1 à v4, qui a changé quoi et quand. Ce qui vivait dans la tête des gens est maintenant dans l'historique.

### 4. Comparaison

- « Lancer la comparaison » avec les trois déclinaisons cochées. Le bandeau orange prévient avant même le lancement : l'Allemagne a modifié une étape qu'elle n'avait pas le droit d'adapter.
- Matrice : France 100 %, Allemagne 94 % (écart maximal 6,1 %), Espagne 75 %.
- Cliquer sur l'Allemagne. Septembre est à +6,1 %, hors tolérance, et Atlas désigne le **nœud divergent n02, Factures validées**.
- Cliquer sur le nœud : les deux graphes côte à côte, n02 entouré. L'Allemagne compte les commandes **expédiées** avant leur validation comptable. On sait d'où vient l'écart.
- En passant : « Exécutée avec vos droits · résultats agrégés uniquement ». Les données restent dans l'entrepôt ; seuls des totaux reviennent.

### 5. Propositions, éditeur

- **Propositions** : la file, avec pour chacune sa nature (« Hors points déclarés », « Nouvelle version », « From scratch ») et le décompte des validations.
- Ouvrir « Revenu net · nordis-de ». Atlas suggère lui-même la convergence : la France et l'Allemagne modifient toutes deux n02, donc il faudrait peut-être en faire un point de variation officiel.
- Retour à la fiche → « Proposer une modification » : l'éditeur, avec la validation en direct en bas (« Schéma valide · Sans cycle · Compilable Databricks, Snowflake ») et l'onglet « SQL compilé ». La définition commune produit le SQL de chaque plateforme.
- Sous le capot, une proposition est une branche Git et une pull request : la revue se fait avec les outils qu'on connaît déjà.

### 6. Administration

- Domaines, référents, nombre de validateurs requis. Marketing n'a « Aucun référent », en orange : c'est le trou de gouvernance typique d'un démarrage, et il saute aux yeux.
- Ces règles vivent elles aussi dans le dépôt (`governance.yaml`) et changent par proposition.

### Conclusion : ce qu'il faut pour démarrer

- Un dépôt Git vide. Atlas y range tout et n'a pas d'autre serveur.
- Le SQL qui tourne déjà, sur Databricks ou Snowflake : l'extraction fournit le premier brouillon de chaque KPI.
- Un référent par domaine pour répondre aux `TODO` et valider.
- Ensuite, on compare : les écarts disent où converger d'abord.

## Questions probables

- **Nos données sortent-elles ?** Non. Les requêtes tournent dans l'entrepôt, avec les droits de la personne connectée, et seuls des agrégats reviennent sur son poste. Les jetons restent dans le trousseau de chaque utilisateur.
- **Faut-il tout modéliser avant de commencer ?** Non. On commence par un KPI qui fâche, on extrait ses implémentations, on compare.
- **Et si une entité calcule volontairement autrement ?** C'est une déclinaison « from scratch », justifiée et suivie. Ses écarts ne comptent pas comme des divergences.
- **Quel format ?** Le YAML Skifer, lisible et diffable, déjà utilisé par le moteur Skifer.

## Ce qui est simulé

- Les chiffres de la comparaison viennent des données de test, pas d'un entrepôt. Les points d'accès de Mes connexions pointent vers des hôtes fictifs : « Se connecter » échouera, mieux vaut ne pas l'ouvrir.
- Les propositions et les revues sont dans un dépôt Git local, sans GitHub. Le compte est fixé au lancement (`DEMO_COMPTE=claire.m examples/demo/lancer-demo.sh` pour la référente Finance).

## Si ça coince

- « Le port 1420 est pris » : une autre app Atlas ou les tests e2e tournent. Les fermer, puis relancer.
- Fenêtre blanche au premier lancement : attendre la fin de la compilation Rust dans le terminal.
- Pour revenir à l'état de départ, par exemple après une fusion pendant une répétition, il suffit de relancer le script.

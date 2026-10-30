# ADR 0009 — Propositions : version proposée, rôles, CODEOWNERS, jeton Git

Date : 2026-10-30 · Statut : **acceptée** (mise en œuvre du plan 0006)

## Contexte

Le plan 0006 fixe le circuit : proposition, décompte, fusion, tag. En le mettant en œuvre, plusieurs points se sont révélés non tranchés, ou tranchés autrement que ne le dit le plan :

- le moment où `data_product.version` est incrémenté ;
- la lecture des rôles, qui peuvent être donnés à deux endroits de `governance.yaml` ;
- l'effet d'une demande de changements ;
- la forme de `CODEOWNERS` et la détection d'une modification manuelle ;
- la façon de remettre le jeton de l'hébergeur à Git ;
- l'identité de l'utilisateur sans hébergeur réel.

## Décision

- **La version est fixée à la création.**
  - Le commit proposé porte déjà `data_product.version` = version courante + 1.
  - Les validateurs approuvent donc exactement le contenu qui sera fusionné.
  - Un incrément à la fusion aurait demandé un commit de plus après les approbations, et ce commit les aurait invalidées.
  - La fusion se contente de poser le tag `doc/<id>/v<n>` sur le commit de fusion.
- **La base se vérifie deux fois.**
  - À la création, `base_version` doit être la version courante. Un nouveau document a `base_version: null`.
  - À la fusion, la version courante doit toujours être `base_version`. Pour la gouvernance, l'empreinte SHA-256 du `governance.yaml` de base doit être inchangée (`base_governance` dans le bloc).
  - Sinon, l'erreur est `stale_base`.
- **Les rôles sont une union.**
  - Un compte est habilité sur un domaine s'il figure dans `referents` ou `validators` du domaine, ou s'il a le rôle `referent` ou `validateur` sur ce domaine (`members[].roles[].domains`).
  - Un rôle sans `domains` vaut pour tout l'espace.
  - Le référent d'espace est un membre qui a le rôle `referent` sans `domains`. Lui seul propose et approuve une modification de la gouvernance.
- **Une demande de changements bloque.**
  - Seule la dernière revue de chaque compte compte. Une approbation ne compte que si elle porte sur la tête de la branche.
  - Une demande de changements d'un compte habilité empêche la fusion, même si le nombre requis est atteint, jusqu'à ce que ce compte approuve à son tour.
- **`CODEOWNERS` est fait de lignes par fichier, avec une empreinte.**
  - Les dossiers `concepts/`, `kpis/` et `variants/` reviennent par défaut à tous les habilités. Viennent ensuite une ligne par document de domaine et une ligne `/variants/<kpi>/` par KPI.
  - `governance.yaml` et `.github/CODEOWNERS` reviennent aux référents d'espace.
  - Avec GitHub, la dernière ligne qui correspond l'emporte : cet ordre donne au domaine le dernier mot.
  - Le fichier n'est régénéré que dans une proposition de gouvernance. Il est tenu pour retouché à la main quand l'empreinte de son en-tête (`# atlas-checksum: sha256:…`) ne correspond plus à son contenu.
  - Un document créé après la dernière proposition de gouvernance tombe sous la règle de son dossier jusqu'à la suivante.
- **Le jeton passe par un assistant d'identification en ligne de commande, non par `GIT_ASKPASS`.**
  - `run_git` ajoute `-c credential.helper=` puis un assistant en ligne. Le premier vide les assistants du poste ; le second répond `x-access-token` et `$ATLAS_GIT_TOKEN`.
  - La variable n'existe que dans l'environnement du sous-processus. Aucun script n'est écrit sur le disque, et le jeton ne figure ni dans l'URL, ni dans `.git/config`, ni dans les messages d'erreur : il y est masqué par `***`.
  - `GIT_ASKPASS` aurait demandé un exécutable, ce qui se prête mal au paquet PyInstaller.
  - D'ici le coffre (plan 0008), le jeton vient de `ATLAS_GITHUB_TOKEN`. Il ne sert qu'aux adresses `https://github.com/…`, puisqu'en SSH la clé est celle de l'agent du poste.
- **L'identité vient de l'hébergeur.**
  - Avec GitHub, c'est le compte du jeton (`GET /user`).
  - Avec `LocalHost`, c'est `ATLAS_ACCOUNT`, à défaut le nom Git de l'utilisateur ramené à un identifiant. Les tests et les démonstrations changent ainsi de membre sans changer de dépôt.
  - Le registre local garde le compte (`account`) et le rôle lus au dernier `sync`.
- **Les erreurs de fusion GitHub sont distinguées.**
  - GitHub répond 405 quand il refuse une fusion. Atlas a déjà vérifié le décompte : hors conflit (« not mergeable »), ce refus vient d'une règle de branche, et l'erreur est `branch_protected`. Atlas ne tente aucun contournement.
  - Un jeton refusé donne `host_auth_failed` en 502, et non en 401. Le 401 reste réservé au token de session de l'API locale, que l'interface traite autrement.

## Conséquences

- Deux propositions concurrentes sur un même document visent la même version. La première fusionnée l'emporte, la seconde reçoit `stale_base` et doit être reproposée.
- Retoucher une proposition se fait pour l'instant en poussant un commit sur sa branche, hors d'Atlas. Le décompte repart alors de zéro. L'écran des propositions (plan 0014) dira s'il faut une route de révision.
- Une pull request fusionnée directement sur GitHub n'est pas taguée. Rattraper ces fusions au `sync` reste à faire, comme le notait l'estimation du plan 0006.
- Le plan 0017 (critère 4) doit lire « le diff ne porte que sur `governance.yaml` et `CODEOWNERS` ».

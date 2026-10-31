# ADR 0023 — Packaging du sidecar et build release

Date : 2026-10-31 · Statut : **acceptée** (mise en œuvre du plan 0019)

## Contexte

Le plan 0019 doit produire, en CI, un installateur signé pour macOS arm64, macOS x64 et Windows x64. Chaque installateur embarque le serveur Python figé par PyInstaller (ADR 0001). Les plans 0001 à 0018 ont accumulé des imports à la demande, que PyInstaller ne voit pas :
- les dialectes sqlglot ;
- le connecteur Snowflake ;
- les backends keyring ;
- le moteur `skifer`.

Le binaire figé ne doit pas les découvrir manquants chez l'utilisateur.

Points à trancher :
- la forme de la configuration PyInstaller ;
- comment prouver que le binaire est complet ;
- l'arrêt du serveur avec l'app ;
- la source unique de la version ;
- la signature sans secret dans le dépôt ;
- la preuve du fonctionnement hors ligne ;
- le seuil de taille.

## Décision

- **Un fichier spec commité, `core/skifer-atlas-server.spec`**, remplace les options en ligne de commande.
  - `collect_all` pour duckdb, sqlglot et `snowflake.connector`.
  - `copy_metadata` pour keyring, snowflake-connector-python, skifer et skifer-atlas, qui lisent leur version par `importlib.metadata`.
  - Imports cachés explicites :
    - les backends keyring par `collect_submodules` (macOS, Windows, SecretService) ;
    - `skifer.core.op_catalog` et `skifer.analyzer.frontends` ;
    - les modules d'uvicorn choisis par nom ;
    - `skifer_atlas.selftest`.
  - Exclusions : pyspark, mlflow, matplotlib, tkinter, IPython, pytest, hypothesis et PyInstaller lui-même.
  - Le nom du binaire (`skifer-atlas-server-<triple>`) vient de `ATLAS_SIDECAR_NAME`, posé par `scripts/build-sidecar.sh`.
  - `.gitignore` ignore `*.spec` sauf ce fichier.
  - Le plan citait `databricks.sql` : le connecteur Databricks passe par l'API REST `sql/statements` (ADR 0011) et n'a pas cette dépendance.
- **`GET /api/_selftest`, protégée par le token de session** (`core/src/skifer_atlas/selftest.py`).
  - Elle importe chaque module de `DYNAMIC_MODULES` (l'inventaire ci-dessus) et le backend keyring de l'OS.
  - Elle extrait une requête de fixture depuis Databricks et Snowflake, la compile vers chaque dialecte, puis l'exécute sous DuckDB sur trois lignes.
  - Elle vérifie aussi `zoneinfo` (tzdata sous Windows).
  - Elle rend `{ok, version, frozen, platform, modules, checks}`.
  - La présence de git est rapportée sans compter dans `ok` : git est un prérequis du poste, il n'est pas embarqué.
  - Un module ajouté plus tard à la demande s'ajoute à `DYNAMIC_MODULES`, et le test du binaire le vérifie sur chaque plateforme.
- **Le serveur suit l'app qui l'a lancé** (`core/src/skifer_atlas/lifeline.py`).
  - Le problème : un binaire PyInstaller `--onefile` tourne en deux processus, un chargeur puis l'interpréteur. `child.kill()` de Tauri ne tue que le chargeur, et l'interpréteur continuait de servir le port (reproduit).
  - Le remède :
    - l'app passe son identifiant de processus dans `ATLAS_PARENT_PID` ;
    - un fil du serveur vérifie chaque seconde que ce processus vit : `os.kill(pid, 0)` sous Unix, `OpenProcess` et `WaitForSingleObject` sous Windows ;
    - quand le processus disparaît, le serveur demande l'arrêt d'uvicorn et arme une échéance de 5 s (`os._exit`), pour qu'une requête longue ne le retienne pas.
  - Le remède couvre aussi l'app tuée net (`kill -9`, plantage).
  - Le message d'arrêt s'écrit après la demande d'arrêt. Si la sortie n'a plus de lecteur, les sorties sont redirigées vers `os.devnull` : une `BrokenPipeError` empêchait l'arrêt.
  - Tauri relaie désormais la sortie du serveur sur la sienne (`[serveur] …`) au lieu de la jeter. Sinon ses tubes se fermaient et toute écriture du serveur échouait.
- **Une seule version, celle de `skifer_atlas.__version__`.**
  - `core/pyproject.toml` la lit (version dynamique de hatch, `[tool.hatch.version]`).
  - `/health` la rend.
  - `tauri.conf.json` lit celle de `app/package.json` (`"version": "../package.json"`).
  - `scripts/version.py`, bibliothèque standard seulement :
    - vérifie l'égalité dans `__init__.py`, `package.json`, `package-lock.json`, `Cargo.toml` et `Cargo.lock` ;
    - `version.py x.y.z` porte une nouvelle version partout.
  - La CI vérifie aussi qu'un tag `vX.Y.Z` correspond à cette version.
- **Signature par les secrets de CI seulement.**
  - `tauri.release.conf.json` :
    - macOS : runtime renforcé, `entitlements.plist` (bibliothèques non signées par Apple et mémoire exécutable, nécessaires à l'interpréteur PyInstaller et aux extensions natives), macOS 11 minimum ;
    - Windows : horodatage SHA-256.
  - macOS : la CI n'exporte que les variables Tauri non vides (`APPLE_CERTIFICATE`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`…). Tauri signe alors le sidecar et l'app, puis fait notariser l'installateur.
  - Windows : le pfx est importé dans le magasin de l'utilisateur, et son empreinte est passée par `--config` (`certificateThumbprint`).
  - Sans secret (PR, fork), l'installateur est construit non signé avec un avertissement. Sur un tag, l'absence de signature fait échouer le job.
  - Quand la signature est présente, elle est vérifiée : `codesign --verify --deep --strict`, `spctl`, `stapler validate` ; `Get-AuthenticodeSignature`.
- **CI GitHub Actions, `.github/workflows/release.yml`.**
  - Matrice :
    - `macos-15` (aarch64-apple-darwin, dmg) ;
    - `macos-15-intel` (x86_64-apple-darwin, dmg) ;
    - `windows-latest` (x86_64-pc-windows-msvc, nsis).
  - Déclencheurs : tags `v*`, PR vers main touchant `core/`, `app/`, `scripts/` ou le workflow, lancement à la main.
  - Étapes :
    - version ;
    - sidecar ;
    - tests du binaire (`pytest -m sidecar`) ;
    - installateur ;
    - rapport de taille ;
    - test de fumée de l'app (macOS) ;
    - signature ;
    - artefacts.
  - Chaque runner construit pour sa propre architecture : pas de compilation croisée du binaire PyInstaller.
- **Hors ligne, prouvé de deux façons.**
  - Le binaire, sous `sandbox-exec` (macOS) qui interdit toute sortie réseau hors de la boucle locale :
    - rejoint le dépôt de démonstration local (dépôt nu sur le disque) ;
    - lit le catalogue ;
    - compile Revenu net vers Databricks et Snowflake.
  - `app/src/offline.test.ts` vérifie que l'interface ne charge aucune ressource distante (pas d'URL distante dans `index.html`, le CSS ou le code) et que les polices déclarées sont embarquées.
- **Taille : rapport à chaque build** (`scripts/size-report.py`, résumé du job).
  - Échec au-delà de 250 Mo par installateur, alerte au-delà de 200 Mo pour le sidecar.
  - Mesure locale (macOS arm64) : sidecar 52 Mo, dmg 58,9 Mo, `.app` 67 Mo.
  - Démarrage du binaire : 1,3 s. App release jusqu'à `/health` : 2 s (limite 10 s).
- **Tests** :
  - `core/tests/test_release.py` (8 tests) :
    - version unique et bump sur des copies ;
    - `_selftest` à 401 sans token ou avec un mauvais token, puis tous les contrôles à « ok » ;
    - module manquant signalé ;
    - lifeline ;
    - `ATLAS_PARENT_PID` ;
    - serveur Python arrêté à la disparition de son parent, avec et sans lecteur de sa sortie.
  - `core/tests/test_sidecar.py`, marqué `sidecar`, sur le binaire construit (5 tests) :
    - fumée et `_selftest` ;
    - refus de démarrer sans token ;
    - hors ligne ;
    - arrêt quand le chargeur puis l'app sont tués ;
    - Snowflake (plan 0018).
  - `scripts/smoke-app.sh` (macOS), sur l'app release :
    - démarrage en moins de 10 s ;
    - aucun processus serveur après Cmd-Q ;
    - aucun processus serveur après un `kill -9` de l'app.
  - `app/src/offline.test.ts` (3 tests).

## Conséquences

- Tout nouvel import à la demande côté Python s'ajoute :
  - au spec (import caché ou `collect_all`) ;
  - et à `selftest.DYNAMIC_MODULES`.

  Sinon la CI ne le voit pas.
- Les certificats ne sont pas encore obtenus. La signature, la notarisation et l'acceptation par Gatekeeper et SmartScreen restent à vérifier au premier tag avec les secrets en place (critère 1).
- Git doit être installé sur le poste. L'app le signale par `_selftest` et par les erreurs des opérations de dépôt.
- Le test de fumée de l'app ne tourne que sous macOS. Sous Windows, l'arrêt avec l'app est couvert par le test du binaire (chargeur puis parent tués).
- Linux, la mise à jour automatique et le canal de distribution restent hors périmètre.

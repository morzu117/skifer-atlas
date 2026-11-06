# ADR 0041 — Sonde de démarrage authentifiée, routes fermées et CSP

Date : 2026-11-06 · Statut : **acceptée** (suivi de la revue globale, issue #151 ; prolonge l'ADR 0001 et le plan 0019)

## Contexte

La revue globale a relevé quatre failles sur la frontière entre la coque Tauri, le sidecar Python et l'interface :

1. **Sonde usurpable (P2).** `free_port` libère le port avant le lancement du sidecar. Un autre processus local peut le prendre et répondre 200 sur `/health`. La sonde de `lib.rs` l'accepte, même si le vrai serveur n'a pas pu écouter ; l'interface lui envoie ensuite le token de session à chaque requête.
2. **Routes sans token (P3).** FastAPI sert `/docs`, `/redoc` et `/openapi.json` sans token, et `/health` donne la version.
3. **CSP désactivée (P3).** `"csp": null` : un script injecté pourrait lire le token par `get_server_info` et le joindre n'importe où.
4. **Repli sans token mis en cache (P3).** Si `get_server_info` échoue une fois sous Tauri, `{ token: "" }` est retenu : toutes les requêtes reçoivent 401 jusqu'au redémarrage.

## Décision

### Preuve d'identité : un HMAC du token sur un nonce, pas un `Bearer`

Envoyer `Authorization: Bearer <token>` à une route protégée aurait été le correctif le plus simple, mais il ne protège pas : **un imposteur qui répond 200 à tout accepte aussi la requête, et il reçoit le token dans la sonde elle-même**. Une sonde qui prouve l'identité ne doit donc jamais transmettre le secret.

- **Route : `GET /alive?nonce=<hex>`**, la seule route ouverte. Le nonce est un UUID v4 en hexadécimal (16 à 128 caractères `[0-9a-f]`, sinon 422). La réponse est `{"proof": HMAC-SHA256(token, "skifer-atlas-alive:" || nonce)}` en hexadécimal. Le préfixe de contexte empêche qu'une preuve serve ailleurs.
- **Sans token configuré** (mode dev explicite, `ATLAS_DEV_NO_TOKEN=1`) : 401. Il n'y a rien à prouver, et la coque ne lance jamais le serveur sans token.
- **Ce que la route ne donne pas.** Elle ne révèle ni le token, ni la version, ni un état. Un processus local peut lui demander autant de preuves qu'il veut : un HMAC-SHA256 avec un token de 122 bits d'aléa ne se retourne pas. Une preuve ne se rejoue pas : le nonce change à chaque essai de la sonde.
- **Côté Rust (`lib.rs`)**, `wait_alive` envoie un nonce neuf à chaque essai et n'accepte qu'un 200 dont le corps contient la preuve attendue, comparée en temps constant. Les fonctions sont pures et testées (`alive_proof`, `alive_response_is_valid`). Le HMAC est écrit à la main au-dessus de `sha2` (déjà dans l'arbre des dépendances de Tauri) plutôt que par la caisse `hmac`, absente du verrou : trente lignes, vérifiées par les vecteurs de la RFC 4231 (cas 1, 2 et 6, ce dernier avec une clé plus longue qu'un bloc), et par un vecteur partagé avec `core/tests/test_api.py`.
- **Le token n'est transmis qu'à l'interface**, par la commande Tauri `get_server_info`, après la preuve. Les requêtes de l'interface (`Authorization: Bearer`) ne partent qu'après `setup`, donc vers un serveur reconnu.

Limite assumée : la preuve vaut au moment de la sonde. Elle ferme la fenêtre de course entre `free_port` et l'écoute du serveur, la seule où le port est à prendre. Si le serveur meurt en cours de session et qu'un autre programme reprend son port, l'interface lui enverrait son token à la requête suivante. Le cas exige que le serveur quitte seul (il ne le fait que si l'app disparaît) puis qu'un programme local gagne la course au port ; il n'est pas traité ici. Le traiter demanderait de redemander une preuve avant chaque requête, ou de relancer le serveur depuis la coque.

### Le processus enfant est surveillé

`spawn_server` rend, avec le `CommandChild`, un état de sortie alimenté par l'événement `Terminated` du plugin shell. `wait_alive` le lit à chaque essai :

- **Serveur arrêté pendant la sonde** (port pris, dépendance absente) : échec immédiat, sans attendre les 30 s. Une réponse valide n'est même pas crue si le processus a quitté.
- **Nouvel essai sur un autre port**, jusqu'à 3 essais (`START_ATTEMPTS`). L'adresse et le token ne sont connus qu'une fois la preuve reçue : `ServerInfo` est donc un état `Mutex<ServerInfo>` rempli par `setup`, et la fenêtre ne s'ouvre qu'ensuite. Le token reste le même d'un essai à l'autre : le serveur qui a échoué ne l'a donné à personne.
- **Message final** : « Le serveur local s'est arrêté au démarrage (code N) sur le port P, peut-être déjà pris par un autre programme. Abandon après 3 essais. » Une preuve qui n'arrive pas en 30 s donne « n'a pas prouvé son identité ». Les essais sont journalisés sur la sortie de l'app.

### `/health` est protégé ; `/alive` le remplace pour la sonde

`/health` exige maintenant le token et garde `{"status","version"}`. Raison : la version n'a pas à être publique, et l'interface, seule à s'en servir, envoie déjà le token (`api.health()` passe par `request`, qui ajoute l'en-tête ; `useServer` affiche la version). Rien ne change côté `app/src/server.ts` : sous Tauri, `serverInfo` donne le token ; en dev, le serveur est lancé avec `ATLAS_DEV_NO_TOKEN=1` et `require_token` laisse passer. Les serveurs e2e (Playwright) sont en mode dev : `/health` y répond 200 comme avant, et Playwright l'accepte même en 401.

`scripts/smoke-app.sh` et la CI n'ont pas le token (il ne vit que dans l'environnement du sidecar) et ne peuvent donc pas vérifier la preuve eux-mêmes. Attendre seulement que `/alive` réponde réussirait avec un sidecar qui renvoie une preuve bien formée mais fausse, alors que l'app ne s'ouvrirait jamais. **Contrat de démarrage** : une fois la preuve acceptée, et seulement alors, `lib.rs` écrit sur la sortie de l'app la ligne `[atlas] serveur vérifié, port N` (`ready_message`, sans token ni preuve). Le script lit cette ligne dans le journal qu'il capture déjà, et le délai `SMOKE_LIMIT_SECONDS` se mesure jusqu'à elle. Une ligne sur la sortie plutôt qu'un fichier marqueur : aucune variable d'environnement ni dossier de test à prévoir, et la sortie est déjà redirigée par le script. Après la ligne, le script vérifie que `/alive` rend une preuve de forme valide, qu'un processus sidecar existe, et que `/health` répond 401 sans token. Si l'app se ferme avant la ligne, il échoue. Le cas négatif (preuve fausse mais bien formée : la sonde n'est jamais « prête ») est un test Rust ; le script, lui, ne l'exerce pas.

### Documentation de l'API fermée

`FastAPI(docs_url=None, redoc_url=None, openapi_url=None)` : `/docs`, `/redoc`, `/openapi.json` et `/docs/oauth2-redirect` répondent 404, avec ou sans token. Ils ne sont servis qu'en mode dev explicite (`ATLAS_DEV_NO_TOKEN=1`) **et** sans token configuré, la seule configuration où l'API entière est déjà ouverte. Aucun usage dans l'app, les scripts, la CI ni les tests (vérifié par recherche dans le dépôt).

### CSP de la fenêtre

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;
font-src 'self'; connect-src 'self' ipc: http://ipc.localhost http://127.0.0.1:*;
object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'
```

- **`script-src 'self'`**, sans `unsafe-inline` ni `unsafe-eval` : le `index.html` de Vite n'a aucun script inline. C'est la directive qui empêche l'exfiltration par un script injecté.
- **`connect-src`** : `http://127.0.0.1:*` pour le sidecar (le port change à chaque lancement), `ipc:` pour le canal de Tauri sous macOS et Linux, `http://ipc.localhost` pour celui de Windows ; `'self'` pour l'origine de l'app. Aucune autre adresse : l'interface ne joint jamais un hôte distant, c'est le serveur Python qui parle aux plateformes.
- **`style-src 'unsafe-inline'`** : nécessaire, par deux emplois réels. CodeMirror (éditeur YAML) injecte des éléments `<style>` à l'exécution ; React et React Flow posent des attributs `style` (positions des nœuds, barre de progression). C'est la seule directive desserrée, et elle ne permet pas d'exécuter du code. Une CSP à nonce demanderait de configurer CodeMirror et ne couvrirait pas les attributs `style`.
- **`img-src data:`** : CodeMirror et React Flow utilisent des `data:image/svg+xml` (icônes de pliage et de lint). Le logo et les polices sont des fichiers de l'app (`font-src 'self'`, pas de `data:`). Aucune image distante.
- **Pas de `frame-src`, `object-src`, `form-action`, `base-uri`** : l'app n'en utilise pas ; `none` ferme ces voies.
- **Adresses externes.** `app/src/external.ts` ouvre les adresses OAuth par le plugin shell (`open`), qui passe par le système et non par le webview : la CSP ne les concerne pas. Aucun `<a href>` externe n'est suivi dans la fenêtre.
- **Nonces de Tauri.** Tauri ajoute des nonces et des hachages à `script-src` et `style-src` pour les balises inline qu'il trouve dans le HTML servi. Le HTML de Vite n'en a pas, donc rien n'est ajouté et `'unsafe-inline'` de `style-src` reste actif.
- **`devCsp`** : Tauri applique `csp` aussi en développement. `devCsp` ajoute l'origine de Vite (`http://localhost:1420`, `ws://localhost:1420` pour le rechargement à chaud) et `'unsafe-inline'` pour les scripts, dont l'amorce de React Refresh a besoin. Elle ne sert qu'à `tauri dev`.
- **Garde** : `app/src/csp.test.ts` lit `tauri.conf.json` et vérifie la forme (pas de source distante, pas de script inline, `connect-src` limité).

**Ce qui a été vérifié, et ce qui ne l'a pas été.**
- Vérifié : `npm run build`, puis les parcours e2e Chromium (accueil, catalogue, éditeur, fiche, graphe volumineux, hors ligne) contre `vite preview` qui sert `dist/` avec la CSP ci-dessus en en-tête et un `report-uri` : aucune violation consignée. Vite en développement n'envoie aucun en-tête CSP ; la suite e2e normale ne l'exerce donc pas.
- **Non vérifié, faute de la vraie fenêtre Tauri** : l'application de la CSP par WKWebView (macOS), WebView2 (Windows) et WebKitGTK ; l'ajout par Tauri de `ipc:` et `http://ipc.localhost` à sa propre politique ; l'origine réelle `tauri://localhost` (le `'self'` du test est `http://localhost`) ; le comportement de `style-src` avec les nonces de Tauri ; `tauri dev` avec `devCsp`. À vérifier à la main au prochain essai de l'app, sur les trois plateformes, console du webview ouverte : aucune ligne « Refused to … because it violates the following Content Security Policy ». Même remarque pour la sonde : son enchaînement avec un vrai sidecar (nouvel essai de port, message d'erreur de la fenêtre) n'est exercé que par les tests unitaires de `lib.rs` (faux serveurs locaux) et par `smoke-app.sh` en CI de release.

### Repli sans token, et adresse mal encodée

- **`serverInfo`** : hors Tauri (pas de `window.__TAURI_INTERNALS__`, vérifié par `isTauri()`, déjà la règle de `external.ts`), le repli `{ baseUrl: 8765 par défaut ou VITE_ATLAS_API, token: "" }` est conservé et retenu. Sous Tauri, `invoke("get_server_info")` est réessayé 3 fois (150 ms entre deux) ; un échec, ou un token vide, ne laisse **rien en mémoire** et lève `ServerInfoError` (sous-classe d'`UnreachableError`). La requête ne part donc jamais sans token, la coque affiche son bandeau « Serveur local injoignable » avec le texte « L'application n'a pas pu lire l'adresse et le token du serveur local. Relancez Skifer Atlas. », et « Réessayer » interroge de nouveau l'application.
- **`router.parse`** : un `decodeURIComponent` invalide (`#/w/%E0%A4%A/catalogue`) repli sur l'accueil au lieu de lever `URIError` au rendu. Les paramètres après `?` passent par `URLSearchParams`, qui ne lève pas.

## Conséquences

- Un autre programme qui prend le port du serveur n'est plus pris pour lui, ne reçoit pas le token, et l'app échoue vite avec un message clair, ou redémarre le serveur sur un autre port.
- Le schéma de l'API et la version ne sont plus lisibles sans token.
- Un script injecté dans la fenêtre ne peut ni charger un script d'ailleurs, ni joindre un hôte autre que le serveur local. Il peut encore appeler ce serveur avec le token (la CSP n'est qu'une défense en profondeur ; l'absence d'injection reste la première).
- Une nouvelle dépendance Rust directe, `sha2` (déjà présente dans le verrou).
- Toute future ressource externe de l'interface (CDN, police, image, frame) doit être déclarée dans la CSP, et `app/src/csp.test.ts` rappellera de la justifier.
- Aucun import dynamique n'est ajouté : le sidecar PyInstaller est inchangé.

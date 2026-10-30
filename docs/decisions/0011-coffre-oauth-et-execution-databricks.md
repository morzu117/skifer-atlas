# ADR 0011 — Coffre, OAuth et exécution Databricks

Date : 2026-10-30 · Statut : **acceptée** (mise en œuvre du plan 0008)

## Contexte

L'ADR 0001 range les identifiants des plateformes dans le trousseau de l'OS, par `keyring`. Le plan 0008 précise le coffre, le flux OAuth U2M de Databricks, le registre des points d'accès et l'exécution d'une requête agrégée. Sur plusieurs points, la mise en œuvre l'a tranché autrement :

- la bibliothèque d'exécution ;
- le port de redirection OAuth ;
- la forme du registre et la façon de le modifier ;
- la forme du résultat ;
- l'expiration d'un token personnel ;
- le contrôle des plateformes autorisées.

## Décision

- **Coffre.**
  - Service `skifer-atlas`, compte `<espace>/<point d'accès>`, valeur JSON `{kind, access_token, refresh_token, expires_at, client_id, rejected}`.
  - Le backend est instancié explicitement selon le système : Keychain sous macOS, Credential Locker sous Windows, Secret Service sous Linux. La découverte de `keyring` n'est jamais utilisée, et un backend inutilisable donne `vault_unavailable`, sans repli sur un fichier.
  - Un trousseau ne s'énumère pas de façon portable. « Mes connexions » interroge donc le coffre pour chaque point d'accès déclaré dans l'espace.
  - `ATLAS_VAULT=memory` remplace le trousseau par un coffre en mémoire du processus, pour les tests et les démonstrations.
  - `rejected` marque un accès refusé par la plateforme, quand le rafraîchissement a été refusé ou qu'un 401 persiste après un rafraîchissement. L'état devient `expired` sans appel réseau, jusqu'à la reconnexion.
- **API REST d'exécution plutôt que `databricks-sql-connector`.**
  - Les requêtes passent par l'API *Statement Execution* (`/api/2.0/sql/statements`), en `INLINE` et `JSON_ARRAY`, avec `row_limit = max_rows + 1`.
  - Un résultat de plus de `max_rows` lignes, ou marqué `truncated`, donne `result_too_large`, sans lire les blocs suivants, et la requête est annulée.
  - Délai et annulation passent par `…/statements/{id}/cancel`.
  - Les valeurs reçues en texte sont typées d'après le manifeste : entier, décimal, flottant, booléen, date, horodatage.
  - Pas de dépendance (ni `thrift`, ni `pyarrow`, ni `lz4`), un binaire figé plus simple, et le même client HTTP que l'OAuth.
  - Le résultat est un `QueryResult(columns, types, rows)` plutôt qu'une table Arrow. Le plan 0009 le chargera dans DuckDB.
- **OAuth U2M.**
  - Les points de terminaison se découvrent sur `{host}/oidc/.well-known/oauth-authorization-server`.
  - Le flux utilise PKCE S256 et les portées `all-apis offline_access`.
  - Le client par défaut, `databricks-cli`, n'accepte qu'une redirection enregistrée : `http://localhost:8020`. Le port est donc fixe et non libre, contrairement au plan.
  - Le rappel est écouté sur `127.0.0.1:8020`, cinq minutes au plus. Un port occupé donne `oauth_port_busy`.
  - `oauth_client_id` et `oauth_redirect_port` se règlent par point d'accès, pour l'application OAuth propre à un client.
  - Le serveur de rappel ne journalise rien. Les tokens vont directement au coffre, sans cache du SDK : le SDK n'est pas utilisé.
  - Un token à moins de 60 s de son expiration est rafraîchi avant usage. Un 401 déclenche un rafraîchissement, puis un seul nouvel essai.
- **Token personnel.**
  - `PUT …/token` range `kind: pat` au coffre. Aucune route ne le renvoie.
  - Databricks ne donne pas l'expiration d'un token à son porteur. Elle n'est connue que si l'utilisateur la fournit (`expires_at`).
- **Registre des points d'accès.**
  - `access_points.yaml` à la racine du dépôt de l'espace, sous la forme `{schema_version: 1, access_points: [...]}` plutôt qu'une liste nue, comme les autres fichiers versionnés d'Atlas. Aucun secret n'y figure.
  - Déclarer ou modifier un point d'accès passe toujours par une proposition, de nature `access_points`. Elle est validée par un référent d'espace, comme la gouvernance, et la fusion vérifie que le fichier n'a pas changé depuis la proposition.
  - Un référent unique fusionne seul (ADR 0008).
  - Le fichier est attribué aux référents d'espace dans CODEOWNERS.
- **Plateformes autorisées.**
  - `allowed_platforms` est contrôlé à la déclaration, par `invalid_access_point` avec le diagnostic `platform_not_allowed`.
  - À la lecture, le registre reste lisible : la liste signale `allowed: false`.
  - Autoriser, tester ou interroger un point dont la plateforme n'est plus autorisée donne `platform_not_allowed`.

## Conséquences

- Une seule application peut écouter le port 8020 à un moment donné. Si le CLI Databricks y fait déjà sa propre connexion, Atlas répond `oauth_port_busy`.
- `INLINE` borne le résultat à 25 Mio côté Databricks. Pour des agrégats, ce n'est pas une limite pratique. Sinon, il faudrait passer en `EXTERNAL_LINKS`.
- Le binaire figé embarque les backends de `keyring` (`--collect-submodules keyring.backends --copy-metadata keyring`). Sous Linux, sans Secret Service actif, la connexion est refusée (`vault_unavailable`).
- Les plans 0016 (écran) et 0018 (Snowflake) réutilisent le coffre, le registre et l'interface `Connector`.

# ADR 0020 — Écran Mes connexions

Date : 2026-10-31 · Statut : **acceptée** (mise en œuvre du plan 0016)

## Contexte

Le plan 0016 fait de l'écran 10.6 le lieu où chacun gère ses accès aux plateformes. On y voit les points d'accès de l'espace courant et l'état de son propre accès. On s'y connecte par le flux natif, on y teste et on y révoque ses tokens, sans jamais en saisir ni en voir un.

Le plan 0008 a fourni le coffre, l'OAuth Databricks et les routes `…/connections`. Plusieurs points restent ouverts :
- se connecter à un point d'accès qui n'est pas encore déclaré ;
- ce que le panneau sait des plateformes ;
- les plateformes que l'app ne sait pas encore joindre ;
- la place du repli par token personnel.

## Décision

- **Brouillon de point d'accès.** Le panneau « Nouveau point d'accès » connecte et teste un point d'accès avant de le proposer. Pour cela, trois routes prennent le point d'accès dans le corps (`{"access_point": {…}}`, rien d'autre) :
  - `POST …/access-point-draft/authorize` ;
  - `POST …/access-point-draft/status` ;
  - `POST …/access-point-draft/test`.

  Elles ont leur propre préfixe : sous `…/connections/{ap}`, un identifiant `draft` serait ambigu. Le brouillon est validé comme une déclaration :
  - `invalid_access_point`, avec les diagnostics ;
  - `platform_not_allowed` ;
  - `access_point_exists` (409) si l'identifiant est déjà au registre ;
  - `platform_not_supported` pour une plateforme que l'app ne sait pas joindre.

  Rien n'est écrit dans le dépôt. Le token obtenu est rangé dans le coffre sous `<espace>/<identifiant>` : il sert dès que la proposition est fusionnée, sans se reconnecter. Si la proposition n'aboutit jamais, il reste dans le coffre jusqu'à ce qu'on le révoque.
- **Déclaration** : toujours une proposition sur `access_points.yaml` (ADR 0011), avec la justification saisie dans le panneau. Un référent d'espace seul la fusionne seul (ADR 0008). Le panneau affiche « Proposition n° X ouverte » et un lien vers elle.
- **`GET …/connections/platforms`** rend les plateformes autorisées par la gouvernance, et elles seules : `{id, label, supported}`. Le panneau ne propose rien d'autre (critère 6). Une plateforme autorisée mais pas encore prise en charge est grisée, avec « (bientôt) ».
- **Liste enrichie.** Chaque point d'accès de `GET …/connections` porte en plus :
  - `owner_name`, le nom du propriétaire lu dans la gouvernance ;
  - `supported`.

  Les points Snowflake s'affichent avec « Bientôt dans Atlas » à la place des actions, jusqu'au plan 0018. Une plateforme retirée par le référent affiche « Plateforme retirée par le référent ».
- **Mon accès** : une pastille et un libellé.
  - « Connecté », avec en dessous « expire dans n j » si l'expiration est connue, sinon « session OAuth » ou « token personnel ». Le guide dit « session SSO » ; Atlas ne connaît que l'OAuth de la plateforme.
  - « Session expirée » pour l'OAuth, « Token expiré » pour un token personnel.
  - « Jamais connecté ».

  Les actions suivent l'état :
  - Tester et Révoquer quand on est connecté ;
  - Reconnecter (primaire) quand l'accès a expiré ;
  - Se connecter sinon.

  Leurs noms accessibles nomment la plateforme et le point d'accès, par exemple « Tester Databricks · dbx-fr ».
- **OAuth** : l'adresse d'autorisation s'ouvre dans le navigateur du système. L'écran relit ensuite `…/status`, chaque seconde (`OAUTH_POLL_MS`), jusqu'à ce que le flux soit `connected`, `failed` ou `expired`. Au-delà de 5 minutes (`OAUTH_TIMEOUT_MS`), il abandonne avec un message. L'ouverture passe par le plugin `shell` déjà autorisé (ADR 0019), et non par `tauri-plugin-opener` comme le disait le plan : une seule permission suffit.
- **Repli par token personnel** (décision Q10) : le lien « Utiliser un token personnel » n'apparaît qu'après un échec de l'OAuth, et seulement sur une ligne Databricks déclarée. Il ouvre un champ masqué (`autocomplete="off"`), vidé avant même l'envoi au coffre. Le panneau de brouillon n'a pas de repli : on déclare un point d'accès par l'OAuth.
- **Paire de clés Snowflake** (sélecteur de fichier, passphrase) : reportée au plan 0018, avec le connecteur.
- **Panneau toujours visible** pour qui n'est pas lecteur, à droite du tableau, comme sur la maquette. « Ajouter un point d'accès » y amène le focus. Par défaut, le panneau propose la première plateforme prise en charge et la première entité qui n'a pas encore de point d'accès sur cette plateforme. L'identifiant est déduit des deux (`dbx-de`) et reste modifiable. Un lecteur ne voit pas le panneau.
- **Démonstration** :
  - `examples/points-acces-nordis.py <distant.git> <hôte Databricks>` déclare, en Julien H., trois points d'accès, comme sur la maquette : dbx-fr sur l'hôte donné, snow-de et snow-es ;
  - `core/tests/connections/fake_databricks.py <port>` lance seul le faux Databricks des tests.

  Les tests de bout en bout s'en servent : faux Databricks sur le port 8796, retour OAuth sur 127.0.0.1:8020.
- **Correction de la comparaison.** Le bandeau « Connexion requise » (ADR 0019) lisait un état d'erreur que le serveur ne rend pas. Il reconnaît désormais un flux `failed` ou `expired`, et affiche « Connexion échouée ».

## Conséquences

- Un token obtenu pour un brouillon jamais fusionné reste dans le coffre. Il est inoffensif (aucun point d'accès ne le désigne), mais l'écran ne le montre pas. Il disparaît si l'on révoque le point d'accès une fois déclaré, ou si l'on vide le trousseau.
- Le tableau défile horizontalement sous 1440 px de large, comme le prévoit le guide : rien n'est tronqué.
- L'OAuth réel sur Databricks et l'ouverture du navigateur sous Tauri n'ont pas été vérifiés à la main. Les tests passent par le faux Databricks et une fenêtre du navigateur.

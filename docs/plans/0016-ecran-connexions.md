# Plan 0016 — Connexions personnelles (10.6)

## Objectif
Chaque utilisateur voit les points d'accès de l'espace courant avec l'état de son propre accès, s'authentifie par le flux natif, teste et révoque ses tokens, sans jamais saisir ni voir un token.

## Périmètre
**Dedans** : écran 10.6 branché sur 0008 (puis 0018) ; panneau « Nouveau point d'accès » ; flux OAuth ouvert dans le navigateur système ; tester, révoquer, reconnecter.
**Dehors** : liste des plateformes autorisées (0017) ; plateformes autres que Databricks et Snowflake (affichées « bientôt » si autorisées).

## Références
Brief 7.1, 7.2, 10.6 ; guide 5 (10.6) ; `screens/10.6-connexions.html` ; plans 0008, 0018.

## Spécification
- Titre « Mes connexions », sous-titre sur les tokens locaux. Tableau : Plateforme (nom + entité · mode d'auth), Schéma (mono), Propriétaire, Fraîcheur, Mon accès (pastille + libellé : « Connecté · expire dans n j », « Connecté · session SSO », « Token expiré », « Jamais connecté »), actions (Tester / Révoquer ; Reconnecter ; Se connecter).
- Panneau 340 px : plateforme (limitée aux plateformes autorisées), hôte, schéma, entité, « S'authentifier avec OAuth » (primaire), « Tester la connexion ». La déclaration du point d'accès passe par une proposition si l'utilisateur n'est pas référent (0008) ; le panneau le dit.
- OAuth : l'UI reçoit `authorize_url` et l'ouvre par `tauri-plugin-opener`, puis interroge `…/status` jusqu'à `connected` ou expiration (5 min), avec un message.
- Pas de champ de saisie de token, sauf le repli Databricks par token personnel (décision Q10) : un lien « Utiliser un token personnel » apparaît seulement si l'OAuth échoue, et ouvre un champ masqué à usage unique, envoyé directement au coffre. Pour Snowflake par paire de clés, un sélecteur de fichier (Tauri `dialog`), et la passphrase envoyée une seule fois au coffre (analyse Q10).

## Critères d'acceptation
1. Le tableau reflète les points d'accès de l'espace courant et l'état du coffre de l'utilisateur.
2. « Se connecter » ouvre le navigateur ; après le rappel OAuth, l'état passe à « Connecté » sans rechargement.
3. « Révoquer » supprime l'entrée du coffre ; l'état passe à « Jamais connecté ».
4. Changer d'espace change la liste ; aucune connexion d'un autre espace n'apparaît.
5. Aucun élément du DOM ne contient de token (test Playwright qui cherche les valeurs du faux serveur OAuth).
6. Une plateforme non autorisée n'apparaît pas dans le panneau.

## Tests
- Composants : tableau et états.
- Bout en bout : faux serveur OAuth (repris de 0008) ; contrôle d'absence de secret dans le DOM et le stockage du webview.
- À la main : OAuth réel sur Databricks.

## Dépendances
0008, 0010.

## Estimation
**S**. Incertitude : ouverture du navigateur et retour à l'app selon l'OS.

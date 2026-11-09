# ADR 0044 — Jetons masqués dans les erreurs, et erreurs de connexion expliquées

Date : 6 novembre 2026

## Contexte

Revue globale (issue 148), bloc connecteurs et coffre. Une plateforme peut recopier dans son message d'erreur le jeton qu'on vient de lui envoyer ; `message_of` se contentait de tronquer à 300 caractères, de sorte que le jeton traversait l'API locale, l'écran de test et les flux OAuth. Côté écran, un second clic sur « Se connecter » relançait l'OAuth, et huit codes émis par les routes de connexion n'avaient pas de texte français.

## Décision

**Masquage.** `skifer_atlas/masking.py` remplace par `***` chaque secret connu d'un texte, tel quel ou encodé pour une URL ; `run_git` l'utilise aussi. Le masquage précède toute troncature, pour qu'un jeton coupé par la limite de longueur ne passe pas. Les appelants fournissent les secrets qu'ils ont envoyés :
- Databricks : le jeton d'accès, dans les erreurs HTTP et dans l'erreur d'une requête terminée en échec ;
- échange du code OAuth : le code et le vérificateur PKCE ;
- Snowflake : les jetons de session et le jeton maître, y compris renouvelés ;
- GitHub : le jeton de l'API et le `device_code`.

Le corps JSON est masqué valeur par valeur avant d'être sérialisé. Un message ou une requête persistés (historique des comparaisons, état d'un flux) partent de ce texte déjà masqué.

**Garde de lancement.** Une référence synchrone empêche le second clic de relancer l'autorisation (écran Mes connexions et bandeau « Connexion requise ») ; les boutons sont désactivés pendant le lancement seulement. Une page d'autorisation abandonnée ne bloque pas l'écran. « Annuler » (Mes connexions, y compris le brouillon du panneau) appelle `POST …/authorize/cancel`, protégée par le token de session comme toute route : le serveur ferme l'écoute, marque le flux échoué (« Connexion annulée. ») et, le flux étant tenu par un verrou pendant l'enregistrement, un retour tardif du navigateur reçoit un 410 et n'enregistre rien (de même pour un flux remplacé ou expiré, et pour une session SSO Snowflake qui se termine après l'annulation : elle est refermée). La route dit seulement si un flux en attente a été arrêté (`cancelled`) ; l'état affiché vient du coffre : après toute annulation réussie, l'écran relit l'accès et montre connecté s'il y est (le retour du navigateur a pu aboutir pendant l'annulation, que celle-ci attend), repos sinon. L'annulation et les démarrages sur un même port se font sous le même verrou : un nouveau flux ne voit jamais le port à moitié libéré. Dans le panneau « Nouveau point d'accès », les champs sont verrouillés dès le lancement et le temps de la connexion (le serveur autorise le point tel qu'il était au lancement) ; « Annuler la connexion » les libère. « Recommencer la connexion » (comparaison) relance : `Flows.start` abandonne l'ancien flux de la même façon, sans `oauth_port_busy`.

**Jetons lus à l'instant (Snowflake).** Le connecteur masque aussi les jetons de session et maître que la connexion porte au moment de l'erreur : le pilote a pu les renouveler avant que `renewed` ne les retienne. Le masquage couvre aussi les clés d'un corps JSON.

**Messages.** Chaque code a un titre et une consigne dans `app/src/messages.ts`, sans recopier le texte du serveur. `not_connected` et `access_expired` portent `action: "reconnect"` : sur Mes connexions, le test relit la liste et la ligne propose « Reconnecter » ; sur la comparaison, un lien mène à Mes connexions et l'aperçu est relu pour rendre le bandeau « Connexion requise ». Le texte propre au rattachement d'un dépôt (`host_unreachable`) reste prioritaire dans son formulaire.

**Limites acceptées sur le chemin d'annulation.** Les verrous se prennent toujours dans l'ordre registre des flux, flux, `_draft_lock`, et « Oublier » ne vise que les flux existants à son début. Restent des courses de quelques millisecondes (un démarrage contre une annulation, une page d'autorisation qui aboutit pile à l'annulation) sans perte ni fuite de données : le pire effet est de devoir relancer la connexion. Autre limite acceptée : si le délai de cinq minutes expire pendant l'échange du code, une annulation peut rendre la main avant la fin de cet échange ; l'accès, que l'utilisateur a autorisé dans son navigateur, arrive alors dans son propre coffre, et se révoque depuis Mes connexions.

## Conséquences

Le message d'une plateforme peut être moins précis qu'avant pour les codes traduits : la cause figure dans le titre, le détail brut reste dans la réponse de l'API (masquée). Les codes dont le message serveur dit déjà la cause et la suite (`platform_forbidden`, `platform_not_found`, `oauth_unavailable`, `oauth_failed`, erreurs de clé Snowflake) gardent ce message. Un secret absent de la liste des appelants n'est pas masqué : tout nouveau connecteur doit passer ses jetons à `message_of` ou à `mask_secrets`.

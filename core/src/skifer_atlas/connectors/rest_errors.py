"""Codes REST : statut HTTP local et texte conservé, jamais un texte fournisseur."""

REST_ERRORS = {
    "invalid_rest_access_points": (422, "Registre REST invalide."),
    "invalid_rest_datasets": (422, "Jeux de données REST invalides."),
    "rest_dataset_missing": (422, "Table sans jeu de données sur ce point REST."),
    "rest_dataset_mismatch": (422, "Colonnes REST incompatibles avec la source."),
    "rest_period_required": (422, "Une période est requise pour ce jeu REST."),
    "rest_scope_required": (422, "Un périmètre non vide est requis avant tout appel REST."),
    "rest_perimeter_unsupported": (422, "Opérateur de périmètre REST non pris en charge."),
    "rest_perimeter_conflict": (422, "Périmètres distincts pour une même table REST."),
    "budget_exceeded": (429, "Budget REST atteint."),
    "rate_limited": (429, "Limite d'appels du fournisseur REST atteinte."),
    "rest_payment_required": (502, "Appel REST hors forfait."),
    "rest_forbidden": (502, "Appel REST interdit."),
    "rest_error_body": (502, "Corps d'erreur REST reçu."),
    "rest_timeout": (504, "Délai de l'appel REST dépassé."),
    "rest_http_error": (502, "Échec de l'appel REST."),
    "rest_server_error": (502, "Échec du serveur REST."),
    "rest_bad_response": (502, "Réponse REST illisible."),
    "rest_response_too_large": (502, "Réponse REST trop volumineuse."),
    "rest_too_many_pages": (502, "Nombre maximal de pages REST atteint."),
    "rest_next_url_refused": (502, "Adresse de pagination REST refusée."),
}

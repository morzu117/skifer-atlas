"""Masquage des jetons connus dans un texte, avant de le restituer ou de le conserver.

Une plateforme qui recopie dans une erreur le jeton qu'on lui a envoyé le renverrait à
l'API locale, à l'écran ou au journal d'une comparaison. Le masquage précède donc toute
troncature : un jeton coupé en deux par la limite de longueur ne se reconnaîtrait plus.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

MASK = "***"


def mask_secrets(text: str, *secrets: str | None) -> str:
    """`text` où chaque secret connu (tel quel ou encodé pour une URL) devient `***`.
    Un secret vide est ignoré : il masquerait chaque caractère."""
    found = {variant for secret in secrets if secret for variant in (secret, quote(secret, safe=""))}
    for variant in sorted(found, key=len, reverse=True):
        text = text.replace(variant, MASK)
    return text


def mask_body(body: Any, *secrets: str | None) -> Any:
    """Le corps JSON décodé d'une réponse, avec le masquage appliqué à chaque texte :
    l'écriture `str(dict)` échappe des caractères et ne retrouverait pas un jeton."""
    if isinstance(body, str):
        return mask_secrets(body, *secrets)
    if isinstance(body, dict):
        # Les clés aussi : un jeton peut être renvoyé comme nom de champ.
        return {mask_body(key, *secrets): mask_body(value, *secrets) for key, value in body.items()}
    if isinstance(body, list):
        return [mask_body(value, *secrets) for value in body]
    return body

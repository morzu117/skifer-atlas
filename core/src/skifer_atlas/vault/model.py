"""Ce que le coffre range pour un point d'accès (plan 0008).

Une `Credential` ne s'affiche jamais : sa représentation masque les secrets, et seul
`describe` sort du coffre, sans aucun jeton.

| genre     | `access_token`              | `refresh_token` | plateforme            |
|-----------|-----------------------------|-----------------|-----------------------|
| `oauth`   | jeton d'accès               | de rafraîchissement | Databricks        |
| `pat`     | token personnel             | —               | Databricks            |
| `sso`     | jeton de session            | jeton maître    | Snowflake (plan 0018) |
| `keypair` | passphrase de la clé privée | —               | Snowflake (plan 0018) |

Une session SSO que le connecteur n'a pas pu exporter vit en mémoire seulement : son
entrée ne porte alors aucun jeton (`access_token` vide).
"""

from __future__ import annotations

import json
import time
from dataclasses import asdict, dataclass, field
from typing import Literal

Kind = Literal["oauth", "pat", "sso", "keypair"]
REFRESH_MARGIN = 60  # secondes : on rafraîchit un jeton qui expire dans moins d'une minute


@dataclass
class Credential:
    kind: Kind
    access_token: str = field(repr=False)
    refresh_token: str | None = field(default=None, repr=False)
    expires_at: float | None = None  # epoch ; None si la plateforme ne le dit pas
    client_id: str | None = None  # client OAuth qui a émis le jeton
    rejected: bool = False  # la plateforme a refusé ce jeton, ou son rafraîchissement

    def to_json(self) -> str:
        return json.dumps(asdict(self), sort_keys=True)

    @classmethod
    def from_json(cls, text: str) -> Credential:
        data = json.loads(text)
        return cls(**{k: data.get(k) for k in cls.__dataclass_fields__ if k in data})

    def expired(self, now: float | None = None, margin: float = 0) -> bool:
        return self.expires_at is not None and self.expires_at - margin <= (now or time.time())

    def needs_refresh(self, now: float | None = None) -> bool:
        return self.kind == "oauth" and self.expired(now, REFRESH_MARGIN)

    def state(self, now: float | None = None) -> str:
        """`connected` ou `expired` : sans réseau, d'après ce que le coffre sait."""
        if self.rejected:
            return "expired"
        if self.expired(now) and not (self.kind == "oauth" and self.refresh_token):
            return "expired"
        return "connected"

    def describe(self, now: float | None = None) -> dict:
        """Ce que l'API peut dire d'un accès : jamais de jeton."""
        days = None
        if self.kind == "pat" and self.expires_at is not None:
            days = max(0, int((self.expires_at - (now or time.time())) // 86400))
        return {"kind": self.kind, "my_access": self.state(now), "expires_in_days": days}

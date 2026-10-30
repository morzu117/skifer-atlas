"""Calendriers versionnés `calendars/<key>.yaml` du moteur Skifer (plan 0007).

Une période nommée a des bornes incluses. Le grain d'un calendrier se déduit de la durée
de ses périodes (mois fiscal de 28 à 35 jours, trimestre de 84 à 98…) : un découpage
`period` à ce grain affecte chaque date à la période qui la contient ; à un grain plus
fin, il tronque au calendrier civil, ce qui suppose des périodes alignées sur ce grain.
Le calendrier `civil` n'a pas de fichier.
"""

from __future__ import annotations

import itertools
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import yaml

from .errors import compile_error

CIVIL = "civil"
GRAINS = ("day", "week", "month", "quarter", "year")
_LENGTHS = {"day": (1, 1), "week": (7, 7), "month": (28, 35), "quarter": (84, 98),
            "year": (364, 371)}


@dataclass(frozen=True)
class Period:
    name: str
    start: date
    end: date


@dataclass(frozen=True)
class Calendar:
    key: str
    version: str
    periods: tuple[Period, ...]

    @property
    def grain(self) -> str | None:
        """Grain commun à toutes les périodes, ou None s'il n'y en a pas."""
        for grain, (low, high) in _LENGTHS.items():
            if all(low <= (p.end - p.start).days + 1 <= high for p in self.periods):
                return grain
        return None

    def period(self, name: str) -> Period | None:
        return next((p for p in self.periods if p.name == name), None)


def _date(value: object, where: str) -> date:
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value))
    except ValueError:
        raise compile_error("invalid_calendar", f"{where} : date « {value} » invalide, "
                            "AAAA-MM-JJ attendu.") from None


def parse_calendar(text: str, where: str = "calendrier") -> Calendar:
    try:
        raw = yaml.safe_load(text)
    except yaml.YAMLError:
        raise compile_error("invalid_calendar", f"{where} : YAML illisible.") from None
    if not isinstance(raw, dict) or not isinstance(raw.get("periods"), list) or not raw["periods"]:
        raise compile_error("invalid_calendar", f"{where} : `key`, `version` et `periods` "
                            "sont requis.")
    periods = []
    for item in raw["periods"]:
        if not isinstance(item, dict) or not item.get("name"):
            raise compile_error("invalid_calendar", f"{where} : période sans nom.")
        start, end = _date(item.get("start"), where), _date(item.get("end"), where)
        if end < start:
            raise compile_error("invalid_calendar",
                                f"{where} : la période {item['name']} finit avant de commencer.")
        periods.append(Period(str(item["name"]), start, end))
    periods.sort(key=lambda p: p.start)
    for before, after in itertools.pairwise(periods):
        if after.start <= before.end:
            raise compile_error("invalid_calendar", f"{where} : les périodes {before.name} et "
                                f"{after.name} se chevauchent.")
    return Calendar(str(raw.get("key", "")), str(raw.get("version", "")), tuple(periods))


def load_calendars(folder: Path) -> dict[str, Calendar]:
    """Calendriers d'un dossier `calendars/`, par clé."""
    found: dict[str, Calendar] = {}
    for path in sorted(folder.glob("*.yaml")) if folder.is_dir() else []:
        calendar = parse_calendar(path.read_text(encoding="utf-8"), path.name)
        found[calendar.key or path.stem] = calendar
    return found


def aligned(calendar: Calendar, grain: str) -> bool:
    """Vrai si chaque période commence et finit sur des bornes civiles de ce grain."""
    def starts(day: date) -> bool:
        if grain == "day":
            return True
        if grain == "week":
            return day.weekday() == 0
        if grain == "month":
            return day.day == 1
        if grain == "quarter":
            return day.day == 1 and day.month in (1, 4, 7, 10)
        return day.day == 1 and day.month == 1

    return all(starts(p.start) and starts(date.fromordinal(p.end.toordinal() + 1))
               for p in calendar.periods)

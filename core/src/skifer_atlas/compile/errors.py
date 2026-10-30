"""Erreurs de compilation (plan 0007).

`CompileError` : le document ne se compile dans aucun dialecte (graphe en erreur, valeur
à compléter, calendrier absent, scope impossible). `NotCompilable` : un nœud n'a pas de
traduction fidèle dans un dialecte précis ; les autres dialectes restent possibles.
"""

from __future__ import annotations

from ..model.errors import Issue


class CompileError(Exception):
    def __init__(self, issues: list[Issue]):
        self.issues = issues
        super().__init__("; ".join(f"[{i.code}] {i.message}" for i in issues))


def compile_error(code: str, message: str, node_id: str | None = None,
                  path: str = "") -> CompileError:
    return CompileError([Issue(path, node_id, code, message)])


class NotCompilable(Exception):
    def __init__(self, dialect: str, node_id: str | None, reason: str):
        self.dialect = dialect
        self.node_id = node_id
        self.reason = reason
        where = f" ({node_id})" if node_id else ""
        super().__init__(f"Non compilable en {dialect}{where} : {reason}")

    def to_dict(self) -> dict:
        return {"status": "not_compilable", "node_id": self.node_id, "reason": self.reason}

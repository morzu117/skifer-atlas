"""Coffre de secrets personnel (plan 0008)."""

from .keyring_vault import GITHUB_ENTRY, SERVICE, MemoryKeyring, Vault, system_keyring
from .model import Credential

__all__ = ["GITHUB_ENTRY", "SERVICE", "Credential", "MemoryKeyring", "Vault", "system_keyring"]

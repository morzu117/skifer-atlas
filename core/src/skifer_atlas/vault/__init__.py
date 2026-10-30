"""Coffre de secrets personnel (plan 0008)."""

from .keyring_vault import SERVICE, MemoryKeyring, Vault, system_keyring
from .model import Credential

__all__ = ["SERVICE", "Credential", "MemoryKeyring", "Vault", "system_keyring"]

"""
sync_log.py — Import sync log management and content fingerprinting.

The sync log records which notes have been imported and their content
hashes, allowing subsequent runs to skip unchanged notes.
"""

import hashlib
import json
import re
from pathlib import Path

SYNC_LOG_FILE = "obsidian-sync-log.json"


def load_sync_log(recipe_dir: Path) -> dict:
    log_path = recipe_dir / SYNC_LOG_FILE
    if log_path.exists():
        try:
            return json.loads(log_path.read_text())
        except Exception:
            pass
    return {"vault_path": "", "last_run": "", "notes": {}}


def save_sync_log(recipe_dir: Path, log: dict):
    log_path = recipe_dir / SYNC_LOG_FILE
    log_path.write_text(json.dumps(log, indent=2))


def content_hash(body: str) -> str:
    """First 16 hex chars of SHA-256 — used for change detection in the sync log."""
    return hashlib.sha256(body.encode()).hexdigest()[:16]


def content_fingerprint(text: str) -> str:
    """Full SHA-256 fingerprint of whitespace- and case-normalised content for DB-level dedup."""
    normalized = re.sub(r'\s+', ' ', text.strip().lower())
    return hashlib.sha256(normalized.encode()).hexdigest()

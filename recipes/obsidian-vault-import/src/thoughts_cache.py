"""
thoughts_cache.py — Parse-phase cache: save and load thoughts between pipeline phases.

Allows large vault imports to checkpoint after the expensive parse+chunk
step so the Supabase load phase can be re-run independently if the
connection fails hours into an upload.

Usage:
    # After parsing/chunking:
    save_parse_cache(cache_path, vault_root, all_thoughts, filtered_notes, skip_reasons)

    # Before uploading:
    all_thoughts, filtered_notes, vault_root, skip_reasons = load_parse_cache(cache_path)
"""

import json
from datetime import datetime, timezone
from pathlib import Path

PARSE_CACHE_FILE = "obsidian-parse-cache.json"


def save_parse_cache(
    path: Path,
    vault_root: Path,
    all_thoughts: list[dict],
    filtered_notes: list[dict],
    skip_reasons: dict[str, int],
) -> None:
    """Write parsed thoughts to a JSON cache file.

    filtered_notes is stored as a lightweight list of {path, _hash} dicts —
    enough for the load phase to update the sync log without vault access.
    """
    slim_notes = [{"path": n["path"], "_hash": n["_hash"]} for n in filtered_notes]
    payload = {
        "vault_path": str(vault_root),
        "generated_at": datetime.now(tz=timezone.utc).isoformat(),
        "notes_processed": len(filtered_notes),
        "skip_reasons": skip_reasons,
        "filtered_notes": slim_notes,
        "thoughts": all_thoughts,
    }
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False))


def load_parse_cache(
    path: Path,
) -> tuple[list[dict], list[dict], Path, dict[str, int]]:
    """Load a parse cache file produced by save_parse_cache.

    Returns (all_thoughts, filtered_notes, vault_root, skip_reasons).
    filtered_notes contains only {path, _hash} — sufficient for the load phase.
    """
    data = json.loads(path.read_text())
    all_thoughts: list[dict] = data["thoughts"]
    filtered_notes: list[dict] = data["filtered_notes"]
    vault_root = Path(data["vault_path"])
    skip_reasons: dict[str, int] = data.get("skip_reasons", {})
    return all_thoughts, filtered_notes, vault_root, skip_reasons

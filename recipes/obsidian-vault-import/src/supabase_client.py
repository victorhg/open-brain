"""
supabase_client.py — Supabase REST API client for thought insertion.

Handles upsert with fingerprint-based duplicate detection, exponential
back-off for transient failures, and rate-limit awareness.
"""

import time

try:
    import requests
except ImportError:
    import sys
    print("Missing dependency: requests")
    print("Run: pip install -r requirements.txt")
    sys.exit(1)

import config


def insert_thought(content: str, embedding: list[float] | None, metadata: dict,
                   supabase_url: str, supabase_key: str,
                   created_at: str | None = None,
                   fingerprint: str | None = None) -> str:
    """Insert a thought into the Supabase thoughts table.

    Returns 'inserted', 'duplicate', or 'failed'.

    When fingerprint is provided and the table has a unique index on
    content_fingerprint, duplicates are silently skipped via upsert.
    """
    payload: dict = {
        "content": content,
        "metadata": metadata,
    }
    if embedding:
        payload["embedding"] = embedding
    if created_at:
        payload["created_at"] = created_at
    if fingerprint:
        payload["content_fingerprint"] = fingerprint

    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    if fingerprint:
        headers["Prefer"] = "return=minimal,resolution=merge-duplicates"

    for attempt in range(config.MAX_RETRIES):
        try:
            resp = requests.post(
                f"{supabase_url}/rest/v1/thoughts",
                headers=headers,
                json=payload,
                timeout=15,
            )
            resp.raise_for_status()
            return "inserted"
        except requests.RequestException as e:
            status = getattr(e.response, 'status_code', None) if hasattr(e, 'response') else None
            if status == 409:
                return "duplicate"
            if attempt < config.MAX_RETRIES - 1 and status in (429, 500, 502, 503, 504):
                wait = config.RETRY_BACKOFF * (2 ** attempt)
                if status == 429:
                    print(f"  Supabase rate limit hit. Retrying in {wait}s "
                          f"(attempt {attempt + 1}/{config.MAX_RETRIES})", flush=True)
                time.sleep(wait)
                continue
            if status == 429:
                print(f"  Insert failed: Supabase rate limit exceeded after "
                      f"{config.MAX_RETRIES} retries. Use --limit to reduce batch size.",
                      flush=True)
            else:
                print(f"  Insert failed: {e}", flush=True)
            return "failed"
    return "failed"

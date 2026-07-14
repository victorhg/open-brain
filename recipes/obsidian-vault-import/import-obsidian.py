#!/usr/bin/env python3
"""
import-obsidian.py — Import an Obsidian vault into Open Brain as searchable thoughts.

Parses markdown files with frontmatter, chunks long notes into atomic thoughts,
generates embeddings via the local LLM, and inserts into Supabase.

── Standard usage ────────────────────────────────────────────────────────────

  # Full pipeline in one shot
  python import-obsidian.py /path/to/vault

  # Preview without inserting anything
  python import-obsidian.py /path/to/vault --dry-run

  # Common options
  python import-obsidian.py /path/to/vault --limit 20 --verbose
  python import-obsidian.py /path/to/vault --no-llm          # heading splits only

── Two-phase mode (recommended for large vaults) ─────────────────────────────

  For vaults with 1,000+ notes, LLM chunking alone can take hours. Supabase
  connection errors that appear late in the upload would force a full restart.
  Two-phase mode checkpoints the parsed output to disk so only the upload step
  needs to be re-run on failure.

  # Phase 1 — parse + chunk only; no Supabase credentials required
  python import-obsidian.py /path/to/vault --parse-only

  # Phase 2 — embed + insert from the saved cache; no vault access required
  python import-obsidian.py --load-from obsidian-parse-cache.json

  # Dry-run either phase without writing anything
  python import-obsidian.py /path/to/vault --parse-only --dry-run
  python import-obsidian.py --load-from obsidian-parse-cache.json --dry-run

── Other utilities ───────────────────────────────────────────────────────────

  python import-obsidian.py --test-llm          # verify LLM + embedding endpoints
  python import-obsidian.py --test-embeddings    # verify embedding endpoint and dimension match
  python import-obsidian.py /path/to/vault --report  # write import-report.md

── Module layout (src/) ──────────────────────────────────────────────────────

  config.py          — constants and mutable LLM config globals
  security.py        — secret detection patterns and scan_for_secrets()
  llm_client.py      — LLM / embedding API calls with retry and fence-stripping
  obsidian_parser.py — vault traversal, note parsing, date extraction
  chunker.py         — heading-based and LLM-assisted chunking
  supabase_client.py — Supabase thought insertion with fingerprint dedup
  sync_log.py        — import sync log and content fingerprinting
  reporter.py        — markdown summary report generation
  thoughts_cache.py  — parse-phase cache (save / load between phases)

Parsing logic adapted from the OpenBrainBeta MCP server (vaultprime_build.py),
battle-tested on 4,600+ Obsidian notes.
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# Make src/ modules importable without installing a package
sys.path.insert(0, str(Path(__file__).parent / "src"))

try:
    import requests
except ImportError:
    print("Missing dependency: requests")
    print("Run: pip install -r requirements.txt")
    sys.exit(1)

import config
from chunker import chunk_note
from llm_client import _local_request, generate_embedding
from obsidian_parser import (
    _jsonify_frontmatter,
    extract_date,
    iter_notes,
    parse_note,
    word_count,
)
from reporter import write_report
from security import scan_for_secrets
from supabase_client import insert_thought
from sync_log import content_fingerprint, content_hash, load_sync_log, save_sync_log
from thoughts_cache import PARSE_CACHE_FILE, load_parse_cache, save_parse_cache


def _load_env(script_dir: Path):
    """Load .env from the project root (three levels up from the recipe dir)."""
    env_file = script_dir.parent.parent / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                key, _, value = line.partition('=')
                value = value.strip().strip('"').strip("'")
                os.environ.setdefault(key.strip(), value)


def _configure_provider(args) -> None:
    """Resolve the local LLM provider and mutate config module globals.

    Requires LOCAL_LLM_BASE_URL to be set in .env.
    """
    local_url = os.environ.get("LOCAL_LLM_BASE_URL", "").rstrip('/')
    if not local_url:
        print("ERROR: No local LLM configured. Set LOCAL_LLM_BASE_URL in .env.",
              file=sys.stderr)
        sys.exit(1)
    print("INFO: Using Local LLM configuration.")
    config.BASE_LLM_URL = local_url
    config.EMBEDDING_MODEL = os.environ.get("LOCAL_EMBEDDING_MODEL", "")
    config.LLM_MODEL = os.environ.get("LOCAL_CHAT_MODEL", "")
    config.LLM_API_KEY = os.environ.get("LOCAL_LLM_API", "")


def _run_test_llm() -> None:
    """Test LLM and embedding connectivity, then exit."""
    print("Testing LLM and Embedding connections...")
    print(f"  Base URL:        {config.BASE_LLM_URL}")
    print(f"  Chat Model:      {config.LLM_MODEL}")
    print(f"  Embedding Model: {config.EMBEDDING_MODEL}")
    print(f"  API Key Present: {bool(config.LLM_API_KEY)}")

    if not config.LLM_API_KEY:
        print("\nFATAL: LLM_API_KEY is not set.", file=sys.stderr)
        sys.exit(1)

    try:
        print("  Testing Chat Completion...", end=" ", flush=True)
        _local_request("chat/completions", {
            "model": config.LLM_MODEL,
            "messages": [{"role": "user", "content": "hi"}],
            "max_tokens": 5,
        })
        print("SUCCESS")
    except Exception as e:
        print(f"FAILED: {e}")

    try:
        print("  Testing Embeddings...", end=" ", flush=True)
        _local_request("embeddings", {"model": config.EMBEDDING_MODEL, "input": "test"})
        print("SUCCESS")
    except Exception as e:
        print(f"FAILED: {e}")

    sys.exit(0)


def _run_test_embeddings() -> None:
    """Test the embedding endpoint, assert the returned dimension matches config, then exit."""
    print("Testing Embedding connection...")
    print(f"  Base URL:          {config.BASE_LLM_URL}")
    print(f"  Embedding Model:   {config.EMBEDDING_MODEL}")
    print(f"  Expected dims:     {config.EMBEDDING_DIMENSIONS}")
    print(f"  API Key Present:   {bool(config.LLM_API_KEY)}")
    print()

    embedding = generate_embedding("test embedding", config.LLM_API_KEY)
    if not embedding:
        print("FAILED: embedding request returned None.", file=sys.stderr)
        print("  Check BASE_LLM_URL, EMBEDDING_MODEL, and API key in .env", file=sys.stderr)
        sys.exit(1)

    actual_dims = len(embedding)
    if actual_dims == config.EMBEDDING_DIMENSIONS:
        print(f"SUCCESS: received {actual_dims}-dimensional vector — matches EMBEDDING_DIMENSIONS.")
        sys.exit(0)
    else:
        print(f"FAILED: dimension mismatch.", file=sys.stderr)
        print(f"  Model returned:    {actual_dims} dims", file=sys.stderr)
        print(f"  Config expects:    {config.EMBEDDING_DIMENSIONS} dims", file=sys.stderr)
        print(f"  Fix: set EMBEDDING_DIMENSIONS={actual_dims} in .env", file=sys.stderr)
        sys.exit(1)


def _preflight(supabase_url: str, supabase_key: str, no_embed: bool) -> None:
    """Validate Supabase connectivity and embedding generation before any real work."""
    print("Preflight check...", flush=True)

    try:
        resp = requests.get(
            f"{supabase_url}/rest/v1/thoughts?limit=1",
            headers={
                "apikey": supabase_key,
                "Authorization": f"Bearer {supabase_key}",
            },
            timeout=10,
        )
        if resp.status_code == 404:
            print("Error: 'thoughts' table not found at this Supabase URL.", file=sys.stderr)
            print(f"  URL: {supabase_url}/rest/v1/thoughts", file=sys.stderr)
            sys.exit(1)
        resp.raise_for_status()
    except requests.RequestException as e:
        print(f"Error: could not reach Supabase: {e}", file=sys.stderr)
        print("  Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env", file=sys.stderr)
        sys.exit(1)

    if not no_embed:
        test_embedding = generate_embedding("preflight check", config.LLM_API_KEY)
        if not test_embedding:
            print("Error: embedding preflight failed.", file=sys.stderr)
            print("  Check your configuration in .env and ensure the LLM server is running.",
                  file=sys.stderr)
            sys.exit(1)
        if len(test_embedding) != config.EMBEDDING_DIMENSIONS:
            print("Error: embedding dimension mismatch.", file=sys.stderr)
            print(f"  Model produces {len(test_embedding)}-dimensional vectors.", file=sys.stderr)
            print(f"  Database expects {config.EMBEDDING_DIMENSIONS} dimensions.", file=sys.stderr)
            print(f"  Fix: set EMBEDDING_DIMENSIONS={len(test_embedding)} in .env if you recreated the DB index.",
                  file=sys.stderr)
            sys.exit(1)

    print("  Supabase and LLM connections verified.", flush=True)
    print()


def _validate_vault(args) -> Path:
    """Validate vault_path arg and return the resolved Path."""
    if not args.vault_path:
        print("Error: vault_path is required.", file=sys.stderr)
        sys.exit(1)
    vault_root = Path(args.vault_path).expanduser().resolve()
    if not vault_root.is_dir():
        print(f"Error: vault not found at {vault_root}", file=sys.stderr)
        sys.exit(1)
    if not (vault_root / ".obsidian").is_dir():
        print(f"Warning: {vault_root} doesn't have a .obsidian/ folder — "
              "are you sure this is an Obsidian vault?", file=sys.stderr)
    return vault_root


def _validate_load_credentials(args) -> tuple[str, str]:
    """Validate Supabase credentials and LLM key; return (supabase_url, supabase_key)."""
    supabase_url = os.environ.get("SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not supabase_key:
        print("Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required", file=sys.stderr)
        print("Set them in .env or as environment variables", file=sys.stderr)
        sys.exit(1)
    if not config.LLM_API_KEY and not (
        config.BASE_LLM_URL.startswith("http://127.0.0.1")
        or config.BASE_LLM_URL.startswith("http://localhost")
    ):
        print("Error: No LLM API Key or Local LLM configuration found.", file=sys.stderr)
        sys.exit(1)
    return supabase_url, supabase_key


def _parse_filter_args(args) -> tuple[set[str], float]:
    """Return (skip_folders, after_ts) derived from CLI args."""
    skip_folders: set[str] = set()
    if args.skip_folders:
        skip_folders = {f.strip() for f in args.skip_folders.split(",") if f.strip()}

    after_ts = 0.0
    if args.after:
        try:
            after_ts = datetime.strptime(args.after, "%Y-%m-%d").replace(
                tzinfo=timezone.utc).timestamp()
        except ValueError:
            print(f"Error: invalid date format '{args.after}', use YYYY-MM-DD", file=sys.stderr)
            sys.exit(1)

    return skip_folders, after_ts


# ── Argument parsing ───────────────────────────────────────────────────────────

def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Import an Obsidian vault into Open Brain as searchable thoughts."
    )
    parser.add_argument("vault_path", nargs='?',
                        help="Path to the Obsidian vault root directory")
    parser.add_argument("--dry-run", action="store_true",
                        help="Preview what would be imported without inserting")
    parser.add_argument("--limit", type=int, default=0,
                        help="Process only the first N notes (0 = all)")
    parser.add_argument("--min-words", type=int, default=config.DEFAULT_MIN_WORDS,
                        help=f"Skip notes with fewer than N words (default: {config.DEFAULT_MIN_WORDS})")
    parser.add_argument("--skip-folders", type=str, default="",
                        help="Comma-separated additional folder names to skip")
    parser.add_argument("--after", type=str, default="",
                        help="Only import notes modified after this date (YYYY-MM-DD)")
    parser.add_argument("--no-llm", action="store_true",
                        help="Disable LLM chunking (heading splits only, no API cost)")
    parser.add_argument("--no-embed", action="store_true",
                        help="Skip embedding generation (insert thoughts without vectors)")
    parser.add_argument("--no-secret-scan", action="store_true",
                        help="Disable secret detection (not recommended)")
    parser.add_argument("--verbose", action="store_true",
                        help="Show detailed progress")
    parser.add_argument("--test-llm", action="store_true",
                        help="Test the configured LLM and Embedding connections and exit")
    parser.add_argument("--test-embeddings", action="store_true",
                        help="Test the embedding endpoint and assert the returned dimension matches EMBEDDING_DIMENSIONS, then exit")
    parser.add_argument("--report", action="store_true",
                        help="Generate a markdown summary report")
    # Two-phase operation
    parser.add_argument("--parse-only", action="store_true",
                        help="Parse+chunk the vault and save a cache file; upload later with --load-from")
    parser.add_argument("--output-json", metavar="PATH",
                        help="Parse+chunk the vault and output as raw JSON to PATH instead of using the cache format.")
    parser.add_argument("--load-from", metavar="PATH",
                        help="Skip parsing; load a cache file and upload thoughts to Supabase")
    return parser



# ── Phase functions ───────────────────────────────────────────────────────────

def _run_parse_phase(
    args,
    vault_root,
    skip_folders: set,
    after_ts: float,
    sync_log: dict,
    use_llm: bool,
) -> tuple:
    """Stages 1-4: walk vault, parse, filter, chunk into thoughts.

    Returns (all_thoughts, filtered_notes, skip_reasons).
    """
    # Stage 1+2: Walk + Parse
    print("Scanning vault...")
    notes = []
    parse_errors = 0

    for full_path, rel_path, folder, title in iter_notes(vault_root, skip_folders):
        try:
            meta, body, wikilinks, inline_tags = parse_note(full_path)
        except Exception as e:
            parse_errors += 1
            if parse_errors <= 5:
                print(f"  Parse error: {rel_path}: {e}")
            continue

        raw_tags = meta.get('tags', [])
        if isinstance(raw_tags, str):
            raw_tags = [raw_tags]
        tags = [str(t) for t in (raw_tags or [])]
        all_tags = list(dict.fromkeys(tags + inline_tags))

        try:
            mtime = full_path.stat().st_mtime
        except Exception:
            mtime = 0.0

        notes.append({
            'title': title,
            'path': rel_path,
            'folder': folder,
            'body': body,
            'tags': all_tags,
            'wikilinks': wikilinks,
            'meta': meta,
            'mtime': mtime,
            'full_path': full_path,
        })

    print(f"  Found {len(notes)} notes ({parse_errors} parse errors)")

    # Stage 3: Filter
    filtered = []
    skip_reasons = {"short": 0, "duplicate": 0, "date_filter": 0, "template": 0}

    for note in notes:
        if word_count(note['body']) < args.min_words:
            skip_reasons["short"] += 1
            continue

        c_hash = content_hash(note['body'])
        existing = sync_log.get("notes", {}).get(note['path'])
        if existing and existing.get("content_hash") == c_hash:
            skip_reasons["duplicate"] += 1
            continue

        if after_ts and note['mtime'] < after_ts:
            skip_reasons["date_filter"] += 1
            continue

        if "templates" in note['folder'].lower():
            skip_reasons["template"] += 1
            continue

        note['_hash'] = c_hash
        filtered.append(note)

    if args.limit and args.limit > 0:
        filtered = filtered[:args.limit]

    print(f"  After filtering: {len(filtered)} notes to import")
    for reason, count in skip_reasons.items():
        if count:
            print(f"    Skipped ({reason}): {count}")
    print()

    if not filtered:
        return [], [], skip_reasons

    # Stage 4: Chunk
    print("Chunking notes into thoughts...")
    all_thoughts = []

    for i, note in enumerate(filtered):
        chunks = chunk_note(note, use_llm, config.LLM_API_KEY, verbose=args.verbose)
        note_date = extract_date(note['meta'], note['full_path'])

        for chunk in chunks:
            section_part = f" > {chunk['section']}" if chunk['section'] else ""
            content = (
                f"[Obsidian: {note['title']} | {note['folder']}{section_part}]"
                f" {chunk['content']}"
            )
            thought = {
                'content': content,
                'fingerprint': content_fingerprint(content),
                'source_reference': {
                    'importer': 'obsidian-vault-import',
                    'source_type': 'obsidian',
                    'note_path': note['path'],
                    'script': 'import-obsidian.py',
                },
                'metadata': {
                    'source': 'obsidian-import',
                    'title': note['title'],
                    'folder': note['folder'],
                    'tags': note['tags'],
                    'date': note_date,
                    'wikilinks': note['wikilinks'],
                    # Preserve full YAML frontmatter verbatim for downstream queries.
                    'frontmatter': _jsonify_frontmatter(note['meta']),
                },
                'note_path': note['path'],
                'note_hash': note['_hash'],
                'created_at': f"{note_date}T00:00:00Z",
            }
            if chunk['section']:
                thought['metadata']['section'] = chunk['section']
            all_thoughts.append(thought)

        if args.verbose and (i + 1) % 10 == 0:
            print(f"  Chunked {i + 1}/{len(filtered)} notes "
                  f"({len(all_thoughts)} thoughts so far)")

    print(f"  Generated {len(all_thoughts)} thoughts from {len(filtered)} notes")
    print(f"  Avg {len(all_thoughts) / max(len(filtered), 1):.1f} thoughts per note")
    print()

    return all_thoughts, filtered, skip_reasons


def _print_parse_summary(all_thoughts, filtered, skip_reasons, args,
                          vault_root=None, recipe_dir=None):
    """Print a dry-run summary for the parse phase."""
    dry_secrets = 0
    if not args.no_secret_scan:
        for t in all_thoughts:
            secret_match = scan_for_secrets(t['content'])
            if secret_match:
                dry_secrets += 1
                title = t['metadata'].get('title', '?')
                section = t['metadata'].get('section', '')
                location = f"{title} > {section}" if section else title
                print(f"  SECRET DETECTED: {location} — {secret_match}")
    print()
    print("=== DRY RUN COMPLETE ===")
    print(f"Would generate {len(all_thoughts)} thoughts from {len(filtered)} notes")
    if any(t.get('was_llm_chunked') for t in all_thoughts):
        llm_count = sum(1 for t in all_thoughts if t.get('was_llm_chunked'))
        print(f"  (Note: LLM chunking was used for {llm_count} thoughts)")
    if dry_secrets:
        print(f"Would skip {dry_secrets} thoughts containing potential secrets")
    if args.verbose:
        print("\nSample thoughts:")
        for t in all_thoughts[:5]:
            preview = t['content'][:120] + "..." if len(t['content']) > 120 else t['content']
            print(f"  [{t['metadata']['folder']}] {preview}")
    if args.report and vault_root and recipe_dir:
        write_report(all_thoughts, filtered, vault_root, recipe_dir, skip_reasons, dry_run=True)


def _run_load_phase(args, all_thoughts, filtered, vault_root, recipe_dir,
                    sync_log, skip_reasons, supabase_url, supabase_key):
    """Stage 5: generate embeddings, insert into Supabase, update sync log."""
    print("Inserting thoughts (no embeddings)..." if args.no_embed
          else "Embedding and inserting thoughts...")

    inserted = duplicates = embed_failures = insert_failures = consecutive_failures = 0
    secrets_skipped = 0
    successful_paths = {}

    for i, thought in enumerate(all_thoughts):
        if not args.no_secret_scan:
            secret_match = scan_for_secrets(thought['content'])
            if secret_match:
                secrets_skipped += 1
                title = thought['metadata'].get('title', '?')
                section = thought['metadata'].get('section', '')
                location = f"{title} > {section}" if section else title
                print(f"  SKIPPED (secret detected): {location} — {secret_match}", flush=True)
                continue

        embedding = None
        if not args.no_embed:
            embedding = generate_embedding(thought['content'], config.LLM_API_KEY)
            if not embedding:
                embed_failures += 1
            else:
                time.sleep(0.15)

        result = insert_thought(
            content=thought['content'],
            embedding=embedding,
            metadata=thought['metadata'],
            supabase_url=supabase_url,
            supabase_key=supabase_key,
            created_at=thought.get('created_at'),
            fingerprint=thought.get('fingerprint'),
            source_reference=thought.get('source_reference'),
        )

        if result in ("inserted", "duplicate"):
            if result == "inserted":
                inserted += 1
            else:
                duplicates += 1
            consecutive_failures = 0
            if thought['note_path'] not in successful_paths:
                successful_paths[thought['note_path']] = datetime.now(tz=timezone.utc).isoformat()
        else:
            insert_failures += 1
            consecutive_failures += 1
            if consecutive_failures >= 10:
                print(f"\n  Aborting: {consecutive_failures} consecutive insert failures.",
                      file=sys.stderr, flush=True)
                print("  Check your Supabase connection and try again.", file=sys.stderr)
                break

        if (i + 1) % 10 == 0 or i == len(all_thoughts) - 1:
            parts = [f"inserted: {inserted}"]
            if duplicates:
                parts.append(f"skipped: {duplicates}")
            if insert_failures:
                parts.append(f"failed: {insert_failures}")
            print(f"  Progress: {i + 1}/{len(all_thoughts)} ({', '.join(parts)})", flush=True)

        if (i + 1) % 50 == 0:
            time.sleep(1)

    print()
    print("=== IMPORT COMPLETE ===")
    print(f"  Thoughts inserted:  {inserted}")
    if duplicates:
        print(f"  Duplicates skipped: {duplicates}")
    if secrets_skipped:
        print(f"  Secrets skipped:    {secrets_skipped}")
    if embed_failures:
        print(f"  Embed failures:     {embed_failures}")
    if insert_failures:
        print(f"  Insert failures:    {insert_failures}")

    # Update sync log
    sync_log["vault_path"] = str(vault_root)
    sync_log["last_run"] = datetime.now(tz=timezone.utc).isoformat()

    notes_log = sync_log.setdefault("notes", {})
    for note in filtered:
        if note['path'] not in successful_paths:
            continue
        note_thoughts = [t for t in all_thoughts if t['note_path'] == note['path']]
        notes_log[note['path']] = {
            "content_hash": note['_hash'],
            "thoughts_created": len(note_thoughts),
            "imported_at": successful_paths[note['path']],
        }

    save_sync_log(recipe_dir, sync_log)
    print(f"  Sync log saved ({len(notes_log)} notes tracked)")

    if args.report:
        write_report(all_thoughts, filtered, vault_root, recipe_dir, skip_reasons,
                     dry_run=False, inserted=inserted, failures=insert_failures)


# ── Main entry point ──────────────────────────────────────────────────────────

def main():
    sys.stdout.reconfigure(line_buffering=True)
    args = _build_parser().parse_args()
    recipe_dir = Path(__file__).parent

    _load_env(recipe_dir)
    _configure_provider(args)

    if args.test_llm:
        _run_test_llm()

    if args.test_embeddings:
        _run_test_embeddings()

    if args.parse_only and args.load_from:
        print("Error: --parse-only and --load-from are mutually exclusive.", file=sys.stderr)
        sys.exit(1)

    # ── Mode: --parse-only ────────────────────────────────────────────────────
    if args.parse_only or args.output_json:
        vault_root = _validate_vault(args)
        use_llm = not args.no_llm and (bool(config.LLM_API_KEY) or bool(config.BASE_LLM_URL))
        skip_folders, after_ts = _parse_filter_args(args)
        sync_log = load_sync_log(recipe_dir)

        print(f"Vault:    {vault_root}")
        if args.output_json:
            print(f"Mode:     OUTPUT JSON → {args.output_json}")
        else:
            dry_note = "  (dry run — cache will not be saved)" if args.dry_run else ""
            print(f"Mode:     PARSE ONLY{dry_note}")
        print(f"Chunking: {'hybrid (headings + LLM fallback)' if use_llm else 'headings only (--no-llm)'}")
        print()

        all_thoughts, filtered, skip_reasons = _run_parse_phase(
            args, vault_root, skip_folders, after_ts, sync_log, use_llm)

        if not filtered:
            print("Nothing to parse.")
            return

        if args.output_json:
            with open(args.output_json, 'w') as f:
                json.dump(all_thoughts, f, indent=2)
            print(f"  Successfully wrote {len(all_thoughts)} thoughts to {args.output_json}")
            return

        if args.dry_run:
            _print_parse_summary(all_thoughts, filtered, skip_reasons, args,
                                  vault_root, recipe_dir)
            return

        cache_path = recipe_dir / PARSE_CACHE_FILE
        save_parse_cache(cache_path, vault_root, all_thoughts, filtered, skip_reasons)
        print(f"  Parse cache saved → {cache_path}")
        print(f'  Upload with:  python import-obsidian.py --load-from "{cache_path}"')
        return

    # ── Mode: --load-from ─────────────────────────────────────────────────────
    if args.load_from:
        cache_path = Path(args.load_from).expanduser().resolve()
        if not cache_path.exists():
            print(f"Error: cache file not found: {cache_path}", file=sys.stderr)
            sys.exit(1)

        all_thoughts, filtered, vault_root, skip_reasons = load_parse_cache(cache_path)
        sync_log = load_sync_log(recipe_dir)

        print(f"Cache:    {cache_path.name}  ({len(all_thoughts)} thoughts, {len(filtered)} notes)")
        print(f"Vault:    {vault_root}")
        print(f"Mode:     {'DRY RUN' if args.dry_run else 'LIVE IMPORT'}")
        print()

        if args.dry_run:
            _print_parse_summary(all_thoughts, filtered, skip_reasons, args,
                                  vault_root, recipe_dir)
            return

        supabase_url, supabase_key = _validate_load_credentials(args)
        _preflight(supabase_url, supabase_key, args.no_embed)
        _run_load_phase(args, all_thoughts, filtered, vault_root, recipe_dir,
                        sync_log, skip_reasons, supabase_url, supabase_key)
        return

    # ── Mode: full pipeline (default) ─────────────────────────────────────────
    vault_root = _validate_vault(args)
    supabase_url = supabase_key = None

    if not args.dry_run:
        supabase_url, supabase_key = _validate_load_credentials(args)
        _preflight(supabase_url, supabase_key, args.no_embed)

    use_llm = not args.no_llm and (bool(config.LLM_API_KEY) or bool(config.BASE_LLM_URL))
    skip_folders, after_ts = _parse_filter_args(args)
    sync_log = load_sync_log(recipe_dir)

    print(f"Vault:    {vault_root}")
    print(f"Mode:     {'DRY RUN' if args.dry_run else 'LIVE IMPORT'}")
    print(f"Chunking: {'hybrid (headings + LLM fallback)' if use_llm else 'headings only (--no-llm)'}")
    print()

    all_thoughts, filtered, skip_reasons = _run_parse_phase(
        args, vault_root, skip_folders, after_ts, sync_log, use_llm)

    if not filtered:
        print("Nothing to import.")
        return

    if args.dry_run:
        _print_parse_summary(all_thoughts, filtered, skip_reasons, args,
                              vault_root, recipe_dir)
        return

    _run_load_phase(args, all_thoughts, filtered, vault_root, recipe_dir,
                    sync_log, skip_reasons, supabase_url, supabase_key)


if __name__ == '__main__':
    main()

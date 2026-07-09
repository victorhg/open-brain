"""
obsidian_parser.py — Obsidian vault note parsing utilities.

Handles vault traversal, frontmatter extraction, wikilink and tag
extraction, date normalization, and JSON-safe frontmatter conversion.
Parsing logic adapted from the OpenBrainBeta MCP server (vaultprime_build.py),
battle-tested on 4,600+ Obsidian notes.
"""

import os
import re
from datetime import date, datetime, timezone
from pathlib import Path

try:
    import frontmatter
except ImportError:
    import sys
    print("Missing dependency: python-frontmatter")
    print("Run: pip install -r requirements.txt")
    sys.exit(1)

import config

# ── Regex patterns ─────────────────────────────────────────────────────────

WIKILINK_RE = re.compile(r'\[\[([^\]|#]+?)(?:\|[^\]]+)?\]\]')
INLINE_TAG_RE = re.compile(r'(?<!\w)#([A-Za-z0-9_/-]+)')

# Patterns to strip before inline tag extraction (avoid false positives)
_CODE_FENCE_RE = re.compile(r'```[\s\S]*?```')
_INLINE_CODE_RE = re.compile(r'`[^`]+`')
_HTML_COMMENT_RE = re.compile(r'<!--[\s\S]*?-->')
_HTML_TAG_RE = re.compile(r'<[^>]+>')


# ── Internal helpers ───────────────────────────────────────────────────────

def _strip_non_tag_regions(text: str) -> str:
    """Remove code blocks, inline code, HTML comments, and HTML tags."""
    text = _CODE_FENCE_RE.sub('', text)
    text = _INLINE_CODE_RE.sub('', text)
    text = _HTML_COMMENT_RE.sub('', text)
    text = _HTML_TAG_RE.sub('', text)
    return text


def _jsonify_frontmatter(meta: dict) -> dict:
    """Deep-copy frontmatter dict into a JSON-safe form.

    YAML parsing can produce datetime.datetime / datetime.date objects
    (from `date: 2024-05-13`-style values). Supabase's JSONB column
    rejects these. Converts them to ISO strings; recurses into nested
    dicts and lists. Leaves primitives untouched.
    """
    def _conv(v):
        if isinstance(v, datetime):
            return v.isoformat()
        if isinstance(v, date):
            return v.isoformat()
        if isinstance(v, list):
            return [_conv(x) for x in v]
        if isinstance(v, dict):
            return {str(k): _conv(x) for k, x in v.items()}
        return v
    return _conv(meta)


# ── Public API ─────────────────────────────────────────────────────────────

def iter_notes(vault_root: Path, skip_folders: set):
    """Yield (full_path, relative_path, folder, title) for every .md file."""
    all_skip = config.ALWAYS_SKIP | skip_folders
    for root, dirs, files in os.walk(vault_root):
        dirs[:] = [d for d in dirs if d not in all_skip and not d.startswith('.')]
        for fname in sorted(files):
            if not fname.endswith('.md'):
                continue
            full = Path(root) / fname
            rel = full.relative_to(vault_root)
            folder = str(rel.parent) if str(rel.parent) != '.' else ''
            title = fname[:-3]
            yield full, str(rel), folder, title


def parse_note(path: Path):
    """Return (metadata_dict, body_text, wikilinks, inline_tags)."""
    try:
        post = frontmatter.load(str(path))
        meta = dict(post.metadata)
        body = post.content
    except Exception:
        meta = {}
        try:
            body = path.read_text(errors='replace')
        except Exception:
            body = ''

    # Extract wikilinks from body + frontmatter values
    wikilinks = WIKILINK_RE.findall(body)
    for v in meta.values():
        if isinstance(v, str):
            wikilinks += WIKILINK_RE.findall(v)
        elif isinstance(v, list):
            for item in v:
                if isinstance(item, str):
                    wikilinks += WIKILINK_RE.findall(item)
    wikilinks = list(dict.fromkeys(w.strip() for w in wikilinks))

    # Extract inline tags with false-positive stripping
    clean_body = _strip_non_tag_regions(body)
    inline_tags = list(dict.fromkeys(INLINE_TAG_RE.findall(clean_body)))

    return meta, body, wikilinks, inline_tags


def extract_date(meta: dict, path: Path) -> str:
    """Extract date from frontmatter or file mtime. Returns ISO date string."""
    for key in ('date', 'created', 'created_at', 'date_created'):
        val = meta.get(key)
        if val:
            if isinstance(val, datetime):
                return val.strftime('%Y-%m-%d')
            s = str(val).strip()[:10]
            if re.match(r'^\d{4}-\d{2}-\d{2}$', s):
                return s
    try:
        mtime = path.stat().st_mtime
        return datetime.fromtimestamp(mtime, tz=timezone.utc).strftime('%Y-%m-%d')
    except Exception:
        return datetime.now(tz=timezone.utc).strftime('%Y-%m-%d')


def word_count(text: str) -> int:
    return len(text.split())

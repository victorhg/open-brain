"""
config.py — Shared constants and mutable LLM configuration globals.

These module-level variables are intentionally mutable: the main entry
point (import-obsidian.py) sets them at startup based on CLI flags and
environment variables. All other modules read them via `import config`
at call time to see the resolved values.
"""

import os

# ── Obsidian walk settings ─────────────────────────────────────────────────

ALWAYS_SKIP = {".obsidian", ".trash", ".git", "node_modules"}
DEFAULT_MIN_WORDS = 50

# ── Chunking thresholds ────────────────────────────────────────────────────

WHOLE_NOTE_THRESHOLD = 500    # notes under this word count → 1 thought
LLM_CHUNK_THRESHOLD = 1000   # sections over this → LLM distillation

# ── API retry settings ─────────────────────────────────────────────────────

MAX_RETRIES = 3
RETRY_BACKOFF = 2  # seconds, doubles each retry

# Expected embedding vector dimensions — must match the pgvector index on the
# thoughts table. Default is 1536 (OpenAI text-embedding-3-small).
# If your local model outputs a different number of dimensions you must either
# switch to a compatible model or recreate the database index.
EMBEDDING_DIMENSIONS: int = int(os.environ.get("EMBEDDING_DIMENSIONS", "1536"))

# ── LLM configuration (mutable globals) ───────────────────────────────────
# import-obsidian.py mutates these at startup after resolving the provider.
# All other modules access them via `config.<VAR>` at call time.

OPENROUTER_BASE_URL_DEFAULT = "https://openrouter.ai/api/v1"

BASE_LLM_URL: str = os.environ.get("OPENROUTER_BASE_URL", OPENROUTER_BASE_URL_DEFAULT)
EMBEDDING_MODEL: str = os.environ.get("OPENROUTER_EMBEDDING_MODEL", "openai/text-embedding-3-small")
LLM_MODEL: str = os.environ.get("OPENROUTER_LLM_MODEL", "openai/gpt-4o-mini")
LLM_API_KEY: str = os.environ.get("OPENROUTER_API_KEY", "")

LOCAL_LLM_BASE_URL: str = os.environ.get("LOCAL_LLM_BASE_URL", "").rstrip('/')
LOCAL_EMBEDDING_MODEL: str = os.environ.get("LOCAL_EMBEDDING_MODEL", "")
LOCAL_CHAT_MODEL: str = os.environ.get("LOCAL_CHAT_MODEL", "")
LOCAL_LLM_API: str = os.environ.get("LOCAL_LLM_API", "")

# ── LLM prompt templates ───────────────────────────────────────────────────

SUMMARIZATION_PROMPT = """You are extracting atomic thoughts from an Obsidian note section.

Given the following section from a note titled "{title}", distill it into 1-3 standalone thoughts.
Each thought must make sense to someone with ZERO prior context — not compressed notes, but full
standalone statements.

Rules:
- Each thought should capture ONE distinct idea, fact, or insight
- Include relevant context (who, what, when) so the thought stands alone
- Keep each thought under 300 words
- Return valid JSON: {{"thoughts": ["thought 1 text", "thought 2 text"]}}

Section content:
{content}"""

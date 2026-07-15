"""
llm_client.py — LLM and embedding API client.

Provides request helpers for both local and OpenRouter endpoints,
with exponential back-off retry logic. Config globals (BASE_LLM_URL,
LLM_MODEL, etc.) are read from the config module at call time so they
always reflect values resolved by the main entry point at startup.
"""

import json
import re
import time


def _extract_json_text(text: str) -> str:
    """Return the JSON substring from an LLM response, handling common wrapping patterns.

    Some models (e.g. Gemma) wrap JSON in markdown code fences or embed it inside
    chain-of-thought prose. This normalises the output before json.loads().

    Strategy (applied in order):
    1. Strip leading/trailing whitespace.
    2. Strip ```json...``` or ```...``` code fences.
    3. If the result still doesn't start with '{', extract the first {...} block via regex.
    """
    text = text.strip()
    # Strip markdown code fences
    text = re.sub(r'^```(?:json)?\s*\n?', '', text)
    text = re.sub(r'\n?```\s*$', '', text)
    text = text.strip()
    # Fallback: pull the first complete JSON object out of surrounding prose
    if not text.startswith('{'):
        match = re.search(r'\{[\s\S]*\}', text)
        if match:
            text = match.group()
    return text


try:
    import requests
except ImportError:
    import sys
    print("Missing dependency: requests")
    print("Run: pip install -r requirements.txt")
    sys.exit(1)

import config


def _local_request(path: str, payload: dict) -> dict:
    """POST to the configured LLM endpoint (local or OpenRouter via BASE_LLM_URL)."""
    url = f"{config.BASE_LLM_URL}/{path.lstrip('/')}"
    headers = {"Authorization": f"Bearer {config.LLM_API_KEY}"} if config.LLM_API_KEY else {}
    return requests.post(url, json=payload, headers=headers, timeout=60).json()


def _openrouter_request(path: str, payload: dict, api_key: str) -> dict:
    """POST to the OpenRouter API with an explicit key."""
    url = f"{config.BASE_LLM_URL}/{path.lstrip('/')}"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    return requests.post(url, json=payload, headers=headers, timeout=60).json()


def generate_embedding(text: str, api_key: str) -> list[float] | None:
    """Generate an embedding vector via the configured provider with retry."""
    for attempt in range(config.MAX_RETRIES):
        try:
            payload = {
                "model": config.EMBEDDING_MODEL,
                "input": text[:8000],
                "dimensions": config.EMBEDDING_DIMENSIONS,
            }
            if config.BASE_LLM_URL and config.EMBEDDING_MODEL:
                data = _local_request("embeddings", payload)
            else:
                data = _openrouter_request("embeddings", payload, api_key)

            if "data" not in data:
                raise ValueError(f"Unexpected response (no 'data' key): {data}")

            return data["data"][0]["embedding"]
        except (requests.RequestException, KeyError, IndexError, ValueError) as e:
            status = getattr(getattr(e, 'response', None), 'status_code', None)
            # Show the raw server response to aid debugging
            if isinstance(e, (KeyError, IndexError, ValueError)) and 'data' in dir():
                print(f"  Server response: {locals().get('data')}")
            if attempt < config.MAX_RETRIES - 1:
                wait = config.RETRY_BACKOFF * (2 ** attempt)
                if status == 429:
                    retry_after = getattr(e, 'response', None)
                    retry_after = (
                        int(retry_after.headers.get('Retry-After', wait))
                        if retry_after else wait
                    )
                    print(f"  Rate limited. Retrying in {retry_after}s "
                          f"(attempt {attempt + 1}/{config.MAX_RETRIES})")
                    time.sleep(retry_after)
                else:
                    print(f"  Retrying (attempt {attempt + 1}/{config.MAX_RETRIES}): {e}")
                    time.sleep(wait)
            else:
                if status == 429:
                    print(f"  Embedding failed: rate limit exceeded after {config.MAX_RETRIES} retries.")
                else:
                    print(f"  Embedding failed: {e}")
                return None
    return None


def llm_distill(title: str, content: str, openrouter_key: str) -> list[str]:
    """Use the configured LLM to distill a long section into 1-3 atomic thoughts.

    Uses config.LLM_CHUNK_MODEL when set (recommended: a small 3B-7B model that
    fits in memory alongside the embedding model). Falls back to config.LLM_MODEL.
    """
    # Prefer a dedicated small chunking model to avoid loading the large chat model.
    model = config.LLM_CHUNK_MODEL or config.LLM_MODEL
    if len(content) > 4000:
        content = content[:4000] + "\n[... truncated]"

    prompt = config.SUMMARIZATION_PROMPT.format(title=title, content=content)
    messages = [{"role": "user", "content": prompt}]

    for attempt in range(config.MAX_RETRIES):
        try:
            if config.BASE_LLM_URL and model:
                data = _local_request("chat/completions", {
                    "model": model,
                    "messages": messages,
                    "temperature": 0.3,
                })
            else:
                data = _openrouter_request("chat/completions", {
                    "model": model,
                    "messages": messages,
                    "temperature": 0.3,
                    "response_format": {"type": "json_object"},
                }, openrouter_key)

            text = data["choices"][0]["message"]["content"]
            text = _extract_json_text(text)
            parsed = json.loads(text)
            thoughts = parsed.get("thoughts", [])
            if thoughts and isinstance(thoughts, list):
                return [t for t in thoughts if isinstance(t, str) and t.strip()]
        except (requests.RequestException, json.JSONDecodeError, KeyError) as e:
            if 'data' in locals() and isinstance(data, dict):
                print(f"    LLM response structure error: {data}")
            if attempt < config.MAX_RETRIES - 1:
                wait = config.RETRY_BACKOFF * (2 ** attempt)
                print(f"    LLM retry in {wait}s: {e}")
                time.sleep(wait)
            else:
                print(f"    LLM failed after {config.MAX_RETRIES} attempts, using raw content")

    return [content.strip()]

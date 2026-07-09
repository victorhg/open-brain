"""
security.py — Secret detection patterns and scanning utilities.
"""

import re

SECRET_PATTERNS = [
    ("OpenAI/OpenRouter API key", re.compile(r'sk-(?:or-v1-|proj-|live-)?[a-zA-Z0-9]{20,}')),
    ("JWT token", re.compile(r'eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}')),
    ("GitHub token", re.compile(r'gh[ps]_[a-zA-Z0-9]{36,}')),
    ("GitHub OAuth token", re.compile(r'gho_[a-zA-Z0-9]{36,}')),
    ("AWS access key", re.compile(r'AKIA[0-9A-Z]{16}')),
    ("Supabase key", re.compile(r'sbp_[a-zA-Z0-9]{20,}')),
    ("Private key block", re.compile(r'-----BEGIN [A-Z ]+ PRIVATE KEY-----')),
    ("Generic secret assignment", re.compile(
        r'(?:password|secret|token|api_key|apikey|api_secret|access_token|auth_token)'
        r'\s*[=:]\s*["\']?[a-zA-Z0-9_\-/.]{16,}',
        re.IGNORECASE,
    )),
    ("Connection string with credentials", re.compile(
        r'(?:postgres|mysql|mongodb|redis)://[^:]+:[^@]+@',
        re.IGNORECASE,
    )),
]


def scan_for_secrets(text: str) -> str | None:
    """Return the label of the first secret pattern found, or None if clean."""
    for label, pattern in SECRET_PATTERNS:
        if pattern.search(text):
            return label
    return None

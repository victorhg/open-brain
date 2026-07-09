# LLM Configuration & API Troubleshooting Guidelines

This document summarizes critical findings and best practices derived from troubleshooting LLM integration within the `import-obsidian.py` recipe. These guidelines are intended to maintain the system's integrity when interacting with external or local LLM services.

## ⚙️ Key Operational Learnings

1.  **Default Behavior is Local-First:** The system is now configured to default to using the **Local LLM configuration** if variables like `LOCAL_LLM_BASE_URL` are present in the `.env` file. This is the preferred operational mode to mitigate external API failures.
2.  **Explicit Mode Control:** To override the default, the following flags are available:
    *   `--use-local-llm`: Forces reliance on local configuration (even if defaults seem set).
    *   `--use-openrouter`: Explicitly forces usage of the OpenRouter API.
3.  **Authentication Errors (401):** The recurring `'No cookie auth credentials found', 'code': 401` error points directly to an invalid or missing API key in the service endpoint being called, not a bug in the Python logic.
4.  **Validation Preflight:** A preflight check is now mandatory on non-dry-run imports. This check verifies Supabase connectivity and attempts a dummy embedding/chat request to confirm *both* the Supabase connection and the LLM endpoint are reachable *before* processing any notes.

## 🛠️ Actionable Troubleshooting Steps (When LLM Fails)

If LLM chunking fails with a 401/Authentication error:
1.  **Check Local Config:** Ensure all variables (`LOCAL_LLM_BASE_URL`, `LOCAL_CHAT_MODEL`, `LOCAL_LLM_API`) are correctly set in `.env` and that the local LLM service is running and accessible at the specified URL.
2.  **Check OpenRouter Config:** If using OpenRouter, ensure `OPENROUTER_API_KEY` in `.env` is valid and active for the chosen model.
3.  **Use Isolation Tests:** Use the `--test-llm` flag or the detailed preflight check to isolate if the issue is the Embedding call or the Chat Completion call.

---
*Last Updated: 2026-07-09*
# pi-open-brain

A [pi](https://pi.dev) package that gives any pi instance native access to an [Open Brain](https://github.com/victorhugogermano/openbrain) knowledge graph backed by an Obsidian vault.

Adds four tools directly into pi — no MCP protocol layer, no extra config files:

| Tool | Description |
|---|---|
| `search_thoughts` | Semantic search over your Obsidian vault |
| `capture_thought` | Save a new thought (requires `CAPTURE_ENABLED=true` on server) |
| `list_thoughts` | List recent captures, newest first |
| `thought_stats` | Total thought count in the graph |

---

## Install

```bash
# From this repo (dev / local)
pi install ./packages/pi-open-brain

# From git (any machine)
pi install git:github.com/victorhugogermano/openbrain
```

## Required env vars

Add to your shell profile (`~/.zshrc`, `~/.bashrc`, etc.) or `.env`:

```sh
# The full URL to your deployed Open Brain edge function
export BRAIN_MCP_URL="https://<ref>.supabase.co/functions/v1/open-brain-mcp"

# Your MCP access key (same value as MCP_ACCESS_KEY on the Supabase server)
export BRAIN_ACCESS_KEY="your-mcp-access-key"
```

Restart pi (or `/reload`) after setting env vars.

---

## How it works

The extension calls the Supabase Edge Function directly over HTTPS using the same JSON-RPC protocol the MCP server exposes — but as a native pi tool call instead of through the MCP client layer.

Auth: `x-brain-key` header only (query params are never used — they appear in logs).

---

## Test

```bash
# Layer 1: HTTP smoke — tests connectivity, auth, and response shapes (no pi needed)
node packages/pi-open-brain/test/smoke.js

# Layer 1 with write test (inserts a thought — use carefully)
node packages/pi-open-brain/test/smoke.js --write

# Layer 2: Pi load — verifies all 4 tools register correctly (needs pi)
node packages/pi-open-brain/test/pi-load.js
```

## Manual verification checklist

After installing, open pi and verify:

```
[ ] pi startup header shows "open-brain" in skills list
[ ] pi startup header shows 4 tools from open-brain extension

[ ] Ask: "what do my notes say about <topic>?"
    → model calls search_thoughts

[ ] Ask: "how many thoughts do I have in my brain?"
    → model calls thought_stats

[ ] Ask: "save this insight: <text>"
    → model calls capture_thought

[ ] Ask: "show me my recent captures"
    → model calls list_thoughts
```

---

## Updating

```bash
# Re-install to pick up latest changes
pi install ./packages/pi-open-brain
```

## Uninstall

```bash
pi remove ./packages/pi-open-brain
```

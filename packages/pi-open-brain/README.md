# pi-open-brain

A [pi](https://pi.dev) package that gives any pi instance native access to an [Open Brain](https://github.com/victorhugogermano/openbrain) knowledge graph backed by an Obsidian vault.

Adds four tools directly into pi — no MCP protocol layer, no extra config files:

| Tool | Description |
|---|---|
| `search_thoughts` | Semantic search over your Obsidian vault |
| `capture_thought` | Save a new thought (requires `CAPTURE_ENABLED=true` on server) |
| `list_thoughts` | List recent captures, newest first |
| `thought_stats` | Total thought count in the graph |

For a full walkthrough with examples, see **[USAGE.md](./USAGE.md)**.

---

## Install

**Inside your Obsidian vault (recommended — project-local, not global):**

```bash
cd ~/path/to/your-obsidian-vault
pi install git:github.com/victorhugogermano/openbrain -l
```

The `-l` flag installs into `.pi/` inside the vault directory. The package is only
active when pi is opened from that vault — nothing changes globally.

```bash
# Dev / local repo install
pi install ./packages/pi-open-brain -l
```

## Credentials — keep them outside the vault

> **The vault must never contain credentials.** If you use Obsidian Sync, iCloud,
> Dropbox, or any other sync service, a credentials file inside the vault will be
> uploaded. Keep secrets in your shell profile — it lives on the machine, not in the vault.

**Add to your shell profile** (`~/.zshrc`, `~/.bash_profile`, etc.):

```sh
# Open Brain — add to ~/.zshrc (never inside the vault)
export BRAIN_MCP_URL="https://<ref>.supabase.co/functions/v1/open-brain-mcp"
export BRAIN_ACCESS_KEY="your-mcp-access-key"  # same as MCP_ACCESS_KEY on the server
```

Then reload your shell:

```bash
source ~/.zshrc   # or open a new terminal
```

Pi inherits these from the shell automatically. The vault holds zero credentials.

## Exclude `.pi/` from Obsidian Sync

After installing, your vault contains a `.pi/` folder with the cloned package files.
These are per-machine (each device installs its own copy) and should not sync:

> **Obsidian → Settings → Sync → Excluded folders → Add `.pi`**

This keeps the package local on each machine. When you set up a new device, run
`pi install git:... -l` again — it takes under a minute.

**What `.pi/` contains (all safe, but no need to sync):**

```
.pi/
├── settings.json          ← package list only, no credentials
└── git/
    └── github.com/...     ← cloned package code (public, per-machine)
```

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

# Using pi-open-brain — Practical Guide

A hands-on walkthrough from first launch to daily use.

---

## Setup (one time)

### 1. Install the package inside your vault

```bash
cd ~/path/to/your-obsidian-vault
pi install git:github.com/victorhugogermano/openbrain -l
```

The `-l` flag installs into `.pi/` inside the vault — project-local, not global.
The package is only active when pi is opened from that vault directory.

### 2. Add credentials to your shell profile

> **Never put credentials inside the vault.** Obsidian Sync, iCloud, and Dropbox
> will upload anything in the vault directory. Credentials belong in your shell
> profile, which lives on the machine.

Open `~/.zshrc` (or `~/.bash_profile` / `~/.bashrc`) and add:

```bash
# Open Brain — keep in shell profile, never in the vault
export BRAIN_MCP_URL="https://<ref>.supabase.co/functions/v1/open-brain-mcp"
export BRAIN_ACCESS_KEY="your-mcp-access-key"
```

Then reload:

```bash
source ~/.zshrc   # or open a new terminal
```

Pi picks these up from the shell automatically. Zero credentials in the vault.

### 3. Exclude `.pi/` from Obsidian Sync

The `.pi/` folder holds the cloned package files. They're per-machine (not shared
across devices) and don't belong in sync.

> **Obsidian → Settings → Sync → Excluded folders → Add `.pi`**

On a new device: just run `pi install git:... -l` again. Takes under a minute.

### New device checklist

```
[ ] cd into the vault
[ ] pi install git:github.com/victorhugogermano/openbrain -l
[ ] Add BRAIN_MCP_URL + BRAIN_ACCESS_KEY to ~/.zshrc
[ ] source ~/.zshrc
[ ] pi  (trust the project when prompted)
```

---

## First Launch

```bash
cd ~/path/to/your-obsidian-vault
pi
```

**First time only:** pi asks `Trust this project? [y/n]` — press `y`. Remembered forever.

**Startup header confirms the package is loaded:**
```
Skills:  auto-capture · open-brain · panning-for-gold
Tools:   search_thoughts · capture_thought · list_thoughts · thought_stats
```

Everything from here is natural language. You never type tool names.

---

## Querying Your Vault

The model calls `search_thoughts` automatically when it recognises a knowledge question.

**Find notes on a topic:**
```
what do my notes say about deep work?
```

**Before a meeting:**
```
I have a call with Sarah from Acme tomorrow. What do I know about her and that company?
```

**Cross-domain connections:**
```
is there any connection in my notes between my sleep patterns and my productivity?
```

**Check if a topic exists:**
```
do I have anything on compound interest?
```
> If similarity is low, pi tells you — it won't invent coverage that isn't there.

**Combine vault + general knowledge:**
```
based on my notes and your own knowledge, what should I consider before switching to a product role?
```
> Pi labels what came from your vault vs. its own reasoning.

---

## Capturing Thoughts

```
save this: the real reason I procrastinate is fear of the blank page, not laziness
```

```
capture this decision: we chose edge functions over server routes because of cold-start latency
```

```
remember that I work best in 90-minute blocks with a hard stop — calendar blocking works, to-do lists don't
```

> Deduplication is automatic — capturing the same idea twice won't create a duplicate.

---

## Vault Stats & Recent Captures

```
how many thoughts are in my brain?
```
> Calls `thought_stats` → "Total thoughts captured: 3963"

```
show me what I've been capturing lately
```
> Calls `list_thoughts` → last 20 entries, newest first.

---

## Working Sessions

Pi is most useful as a thinking partner **during** work, not just for lookup.

**Before starting a task:**
```
I'm about to write the architecture doc for the new API. What have I already decided about this?
```

**Mid-session reality check:**
```
I just realised the cache needs to be per-user, not per-endpoint.
Is there anything in my notes that contradicts or supports this?
```

**Pre-meeting prep:**
```
I'm meeting the Acme team in an hour. Pull everything I have on them — past conversations, open items, context.
```

**Connecting a new idea to existing thinking:**
```
I just read about Zettelkasten. Does that connect to anything I've already written about note-taking or knowledge management?
```

---

## Auto-Capture (end of session)

The `auto-capture` skill activates automatically when you signal the session is ending.
You don't ask for it — just close naturally:

```
alright, let's wrap up
```
```
parking this for now
```
```
goodnight, I'll pick this up tomorrow
```

pi will automatically:
1. Identify ACT NOW items and key decisions from the session
2. Check your vault for duplicates before capturing
3. Save each ACT NOW item as its own thought
4. Save a session summary

---

## Panning for Gold (transcripts + brain dumps)

Paste a voice transcript or stream-of-consciousness notes and trigger the workflow:

```
pan for gold on this:
[paste transcript or brain dump]
```

Or just describe what you have:
```
I recorded my commute thoughts this morning, can you process this transcript?
[paste]
```

pi runs three phases:
- **Extract** — every idea thread, nothing filtered out on the first pass
- **Evaluate** — ACT NOW / RESEARCH MORE / PARK / KILL verdicts on top threads
- **Capture** — ACT NOW items and a session summary go into your vault automatically

---

## Daily Habits That Compound

| Habit | Prompt |
|---|---|
| Capture every decision | `"save this: we chose X over Y because Z"` |
| Search before Googling | Ask pi first — your past thinking is often enough |
| Weekly review | `"show me what I captured this week"` |
| Pre-meeting prep | `"what do I know about [person / project]?"` |
| Connect new learning | `"is there anything in my vault related to [new concept]?"` |

---

## Tips

- **Don't say "search my notes"** — any question about your life, projects, or past decisions triggers a search automatically. The `open-brain` skill handles this.
- **Fuzzy queries work** — search is semantic, not keyword-based. `"morning energy"` finds notes that say `"I'm sharpest before 9am"`.
- **Low similarity = honest** — if pi says it didn't find much, the vault genuinely doesn't cover that topic yet. That's a signal to capture something now.
- **The vault compounds** — every capture makes future searches richer. The system gets more useful the more you use it.
- **You can mix modes** — ask pi to search your vault AND reason from general knowledge in the same message. It will clearly attribute what came from where.

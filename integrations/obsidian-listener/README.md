# Obsidian Live Watcher & Sync Engine

> A reactive, real-time bridge that connects your Obsidian vault directly to Open Brain. Whenever you create, edit, or save a note, Open Brain instantly processes it, generates vector embeddings, runs metadata analyses, and updates your personal knowledge graph.

---

## How It Works

The engine monitors your Obsidian vault for file additions and edits. When a Markdown note is modified, it is intelligently parsed and synced:

```mermaid
graph TD
    A[Obsidian Note Edited/Saved] --> B{Trigger Router}
    B -- Standard Note --> C[Atomic Heading Chunking]
    B -- Tagged #brain-dump / #transcript --> D[Gold Panning Flow]
    
    C --> C1[Extract [[wikilinks]] as Lineage]
    C1 --> C2[Query parent thought UUIDs]
    C2 --> C3[Upsert chunks with 'derived_from' links]
    
    D --> D1[GPT-4o Extracts Idea Threads]
    D1 --> D2[Save original dump as parent reference]
    D2 --> D3[Capture each thread linked to parent]
    
    C3 --> E[Full Provenance Graph in Supabase]
    D3 --> E
```

---

## Features Deployed

### 1. Atomic Heading Chunking & Embeddings
To keep your vector database clean, the engine splits long notes at H2 (`##`) boundaries. Each chunk becomes a self-contained "thought", prefixed with its file header (e.g., `[Obsidian: Project Roadmap > Phase 2]`). It calls the OpenRouter API to generate vector embeddings and extract rich metadata tags (category, importance, entities).

### 2. Auto-Deduplication (Task 1.2 Integration)
The engine computes a SHA-256 fingerprint of each text chunk. It upserts the data using Open Brain's new `upsert_thought` RPC. If the content matches an existing fingerprint, it safely merges tags and updates timestamps rather than inserting a duplicate.

### 3. Automatic Provenance Chains
If your note links to other notes (e.g. `[[Related Idea]]`), the engine parses these wikilinks, resolves them against existing thought UUIDs in your Supabase database, and records them in the `derived_from` field. This compiles a **first-class derivation lineage** showing exactly how your thoughts are connected.

### 4. Zero-Click "Panning for Gold"
If you add a `#brain-dump`, `#transcript`, or `#gold-panning` tag to a note (or put it in a `Brain Dumps/` folder), the engine bypasses standard chunking and runs the **Gold Panning Engine**:
1. It parses the entire dump using GPT-4o.
2. It extracts all high-signal idea, task, and reference threads along with their exact context quotes.
3. It saves your raw brain dump as a single reference thought.
4. It captures each extracted thread as a distinct thought, automatically linked directly back to your raw brain dump using database-level **provenance chains**.

---

## Installation & Setup

### Step 1: Install Listener Dependencies
Navigate to the integration folder and install the watcher daemon package:

```bash
cd integrations/obsidian-listener
npm install
```

Ensure your `.env` in the root of the project contains:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENROUTER_API_KEY`

---

## Trigger Options: Choose Your Method

We offer two different ways to run the integration. Choose the one that best fits your workflow:

### Option A: The Background Daemon (Real-time File Watcher)
This method runs a lightweight background process that monitors your Obsidian folder for any file-system changes and syncs them instantly.

1. **Start the watcher** by passing the path to your Obsidian vault:
   ```bash
   node watcher.js "/path/to/your/obsidian-vault"
   ```
2. (Optional) Run it continuously in the background using `pm2` or a system service:
   ```bash
   npm install -g pm2
   pm2 start watcher.js --name "obsidian-watcher" -- "/path/to/your/obsidian-vault"
   ```

---

### Option B: Obsidian-Native Trigger (Highly Recommended ⭐)
This method does not require a running background daemon. Instead, it leverages Obsidian's popular **Shell Commands** plugin to execute the process script *exactly* when you save or edit a file. This is highly efficient and uses **zero CPU** when Obsidian is closed.

1. Open Obsidian and go to **Settings > Community Plugins**.
2. Search for and install the **Shell Commands** plugin, then enable it.
3. Go to **Settings > Shell Commands**.
4. Click **New Command** and enter:
   ```bash
   node "/Users/YOUR_USER/Development/openbrain/integrations/obsidian-listener/process-file.js" "{{file_path}}"
   ```
   *(Be sure to replace `/Users/YOUR_USER/Development/openbrain` with the absolute path of your Open Brain directory).*
5. Click the **Events** icon (the small lightning bolt) next to your new shell command.
6. Check the following events to trigger the script:
   - **`After saving a file`** (Triggers whenever you hit save or auto-save finishes)
   - **`File created`** (Triggers when you create a new note)
7. Close Settings. The integration is now natively running inside Obsidian!

---

## How to Organize Your Obsidian Vault

The listener works with any folder structure, but you can unlock special workflows by adding simple tags:

### 💡 Capture standard ideas
Simply create or edit notes in Obsidian. They will be split into atomic sections based on headings and pushed to Open Brain automatically.

```markdown
---
tags: [project/ob1, coding]
---
## Database Architecture
We should leverage PostgreSQL GIN indexes for fast text substring matches...
```

### 🥞 Trigger "Gold Panning" on Transcript/Brain-Dump
Add `#brain-dump` or `#transcript` as a tag, or save the note in a folder named `Brain Dumps` or `Transcripts`. The system will automatically run the advanced thread-extraction pipeline and build a citation graph.

```markdown
---
tags: [brain-dump]
---
# Brain Dump 2026-07-13
I had a call with Sarah today about the marketing campaign. We should probably focus on SEO first. Also, my back has been hurting from the office chair, I should order an ergonomic cushion. I also need to pay the AWS bill.
```
*Result:* This will automatically extract separate thoughts:
1. Marketing campaign SEO focus (linked to Sarah, categorized as `idea`)
2. Ergonomic office chair cushion (categorized as `task`)
3. Pay AWS bill (categorized as `task`)
All of them will be linked back to the original `Brain Dump 2026-07-13` in a database provenance chain!

---

## Troubleshooting

### Issue: "Error: Missing required environment keys"
**Solution:** Ensure your root `.env` contains valid `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `OPENROUTER_API_KEY`. The script looks for `.env` exactly two levels up from its folder.

### Issue: Wikilink references are not linking
**Solution:** The linked note must already be imported or captured in your Open Brain database. When importing a deeply connected vault for the first time, run the script twice or run a full import first so all note titles are registered.

### Issue: Ingestion is picking up template files
**Solution:** The file watcher ignores any file located in a directory called `templates` or `Templates` (case-insensitive) by default. If your template directory has a different name, add it to the `ignoredPatterns` array in `integrations/obsidian-listener/watcher.js`.

#!/usr/bin/env node
/**
 * bin/extract-tag-comention-edges.js
 *
 * B.3 — Deterministic tag co-mention edge extractor (no LLM).
 *
 * Notes that share a specific (non-generic) Obsidian tag are connected in
 * the graph. This covers the ~11% of the vault that has tags but no
 * wikilinks (wikilink extraction alone reaches ~89% of notes).
 *
 * ── Tag frequency banding ────────────────────────────────────────────────
 * Tags are computed at NOTE level (deduped across chunks — see note-level
 * dedup note below), not chunk level. Only tags with note-frequency in
 * [MIN_TAG_FREQ, MAX_TAG_FREQ] are used:
 *   - Below MIN_TAG_FREQ: too rare to represent a real cluster (mostly
 *     noise / one-off tags).
 *   - Above MAX_TAG_FREQ: too generic (e.g. #resource, #dailynotes appear
 *     on 900+ notes each) — would create a near-complete graph with no
 *     retrieval signal.
 * Adjust the constants below if your vault's tag distribution differs;
 * run with --dry-run first to see the band's note/edge counts.
 *
 * ── Note-level dedup ─────────────────────────────────────────────────────
 * Same rationale as bin/extract-wikilink-edges.js: Obsidian notes are
 * chunked into multiple `thoughts` rows sharing the same metadata.title and
 * (typically) the same metadata.tags. Edges are extracted between
 * *canonical* thought IDs (MIN(id) per title) — never between arbitrary
 * chunk pairs.
 *
 * Confidence: scaled linearly by tag rarity within the band — rarer tags
 * (closer to MIN_TAG_FREQ) signal a tighter, more specific cluster and get
 * higher confidence (up to 0.9); more common tags within the band get
 * lower confidence (down to 0.5). Always below wikilink confidence (1.0) —
 * co-tagging is a weaker signal than an explicit link.
 *
 * When two notes share more than one in-band tag, the single edge between
 * them keeps the highest-confidence (rarest) tag as its reason.
 *
 * Idempotent: upserts on (source_thought_id, target_thought_id, edge_source).
 *
 * Usage:
 *   node bin/extract-tag-comention-edges.js
 *   node bin/extract-tag-comention-edges.js --dry-run
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '../.env');
if (!existsSync(envPath)) throw new Error(`.env not found at ${envPath}`);

const env = Object.fromEntries(
  readFileSync(envPath, 'utf-8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const [k, ...v] = l.split('=');
      return [k.trim(), v.join('=').trim()];
    })
);

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = { ...env, ...process.env };
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const DRY_RUN = process.argv.includes('--dry-run');
const PAGE_SIZE = 1000;
const INSERT_BATCH_SIZE = 500;

const MIN_TAG_FREQ = 5;   // fewer notes than this: too rare to be a meaningful cluster
const MAX_TAG_FREQ = 20;  // more notes than this: quadratic pair blowup + weak signal
                          // (measured: freq 50 → #chines/#kindle/#highlights alone
                          //  contributed 4,859 of 14,091 pairs; freq 20 keeps the
                          //  edge count in the same order of magnitude as wikilinks)
const CONF_MAX = 0.9;     // confidence at MIN_TAG_FREQ (rarest in-band tags)
const CONF_MIN = 0.5;     // confidence at MAX_TAG_FREQ (most common in-band tags)

/** Confidence scales linearly: rarer tag (lower freq) -> higher confidence. */
function confidenceForFreq(freq) {
  if (MAX_TAG_FREQ === MIN_TAG_FREQ) return CONF_MAX;
  const t = (freq - MIN_TAG_FREQ) / (MAX_TAG_FREQ - MIN_TAG_FREQ); // 0 at MIN, 1 at MAX
  const conf = CONF_MAX - t * (CONF_MAX - CONF_MIN);
  return Math.round(conf * 1000) / 1000;
}

/** Fetch all thoughts, group into note-level records: canonical id + tag set. */
async function loadNoteIndex() {
  const titleGroups = new Map(); // normalized title -> { ids: [], tags: Set }

  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('thoughts')
      .select('id, metadata')
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`Failed to fetch thoughts page @${from}: ${error.message}`);
    if (!data.length) break;

    for (const row of data) {
      const title = row.metadata?.title;
      if (typeof title !== 'string' || !title.trim()) continue;
      const key = title.trim().toLowerCase();

      if (!titleGroups.has(key)) titleGroups.set(key, { ids: [], tags: new Set() });
      const group = titleGroups.get(key);
      group.ids.push(row.id);

      const tags = row.metadata?.tags;
      if (Array.isArray(tags)) {
        for (const t of tags) if (typeof t === 'string' && t.trim()) group.tags.add(t.trim());
      }
    }

    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  for (const group of titleGroups.values()) {
    group.canonicalId = group.ids.reduce((min, id) => (id < min ? id : min), group.ids[0]);
  }

  return titleGroups;
}

async function main() {
  console.log('🏷️  Open Brain — Tag Co-mention Edge Extractor (B.3)');
  console.log('='.repeat(50));
  if (DRY_RUN) console.log('(dry run — no writes will be made)\n');
  console.log(`Tag frequency band: [${MIN_TAG_FREQ}, ${MAX_TAG_FREQ}] notes\n`);

  console.log('Loading thoughts and grouping by note (title)...');
  const titleGroups = await loadNoteIndex();
  console.log(`  ${titleGroups.size} unique notes indexed\n`);

  // tag -> [canonical ids of notes carrying it]
  const tagToNotes = new Map();
  for (const group of titleGroups.values()) {
    for (const tag of group.tags) {
      if (!tagToNotes.has(tag)) tagToNotes.set(tag, new Set());
      tagToNotes.get(tag).add(group.canonicalId);
    }
  }

  const inBandTags = [...tagToNotes.entries()].filter(
    ([, notes]) => notes.size >= MIN_TAG_FREQ && notes.size <= MAX_TAG_FREQ
  );
  console.log(`Unique tags total: ${tagToNotes.size}`);
  console.log(`Tags in band [${MIN_TAG_FREQ}, ${MAX_TAG_FREQ}]: ${inBandTags.length}\n`);

  // pair key "minId|maxId" -> best edge candidate so far
  const edgeMap = new Map();

  for (const [tag, noteSet] of inBandTags) {
    const notes = [...noteSet];
    const freq = notes.length;
    const confidence = confidenceForFreq(freq);

    for (let i = 0; i < notes.length; i++) {
      for (let j = i + 1; j < notes.length; j++) {
        const [a, b] = [notes[i], notes[j]];
        const [source, target] = a < b ? [a, b] : [b, a]; // canonical ordering, avoid duplicate reverse pair
        const pairKey = `${source}|${target}`;

        const existing = edgeMap.get(pairKey);
        if (!existing || confidence > existing.confidence) {
          edgeMap.set(pairKey, {
            source_thought_id: source,
            target_thought_id: target,
            edge_source: 'tag_comention',
            confidence,
            metadata: { tag, tag_frequency: freq },
          });
        }
      }
    }
  }

  const edges = [...edgeMap.values()];
  console.log(`Unique note pairs connected: ${edges.length}`);
  if (edges.length > 0) {
    const confs = edges.map((e) => e.confidence);
    console.log(
      `Confidence range: ${Math.min(...confs).toFixed(3)} – ${Math.max(...confs).toFixed(3)}\n`
    );
  }

  if (DRY_RUN) {
    console.log(`Dry run complete. Would insert/update ${edges.length} edges.`);
    return;
  }

  if (edges.length === 0) {
    console.log('No edges to write.');
    return;
  }

  console.log(`Writing ${edges.length} edges in batches of ${INSERT_BATCH_SIZE}...`);
  let written = 0;
  for (let i = 0; i < edges.length; i += INSERT_BATCH_SIZE) {
    const batch = edges.slice(i, i + INSERT_BATCH_SIZE);
    const { error } = await supabase
      .from('graph_edges')
      .upsert(batch, { onConflict: 'source_thought_id,target_thought_id,edge_source' });
    if (error) throw new Error(`Batch write failed @${i}: ${error.message}`);
    written += batch.length;
    process.stdout.write(`\r  ${written}/${edges.length} written`);
  }
  console.log('\n\n✅ Tag co-mention edge extraction complete.');
}

main().catch((err) => {
  console.error(`\n❌ ${err.message}`);
  process.exit(1);
});

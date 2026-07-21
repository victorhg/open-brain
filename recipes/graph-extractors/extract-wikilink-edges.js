#!/usr/recipes/env node
/**
 * recipes/extract-wikilink-edges.js
 *
 * B.2 — Deterministic wikilink edge extractor (no LLM).
 *
 * Every thought already has its Obsidian [[wikilinks]] captured in
 * metadata.wikilinks at ingest time (integrations/obsidian-listener).
 * This script resolves those link titles to thought UUIDs and inserts
 * graph_edges rows at confidence 1.0.
 *
 * ── Note-level dedup (important) ────────────────────────────────────────
 * Obsidian notes are chunked by heading into multiple `thoughts` rows —
 * every chunk shares the same `metadata.title` and the same
 * `metadata.wikilinks` list (it's note-level frontmatter, duplicated per
 * chunk). Linking every chunk of note A to every chunk of note B would
 * create a bipartite explosion (measured: 16,643 raw link references
 * naively expand to 36,296+ edges). Instead, edges are extracted between
 * *canonical* thought IDs — one representative chunk per note, chosen
 * deterministically as MIN(id) among that note's chunks. The
 * `expand_graph_neighbors` RPC (schema.sql) knows how to map an arbitrary
 * semantic-search hit (any chunk) to its note's canonical ID and back to
 * the most substantive chunk when returning results.
 *
 * Resolution: case-insensitive, trimmed title match against
 * metadata->>'title'. Obsidian aliases ([[Real Title|Alias]]) are not
 * normalized here — if your listener stores the alias instead of the real
 * title, those links will show up as unresolved.
 *
 * Idempotent: upserts on (source_thought_id, target_thought_id, edge_source),
 * safe to re-run after new thoughts are ingested. Note: if a note's
 * canonical ID changes between runs (a lower-UUID chunk added later), old
 * edges under the previous canonical ID are not cleaned up automatically —
 * acceptable cruft for a personal tool re-run occasionally; revisit if it
 * becomes a real problem.
 *
 * Usage:
 *   node recipes/extract-wikilink-edges.js
 *   node recipes/extract-wikilink-edges.js --dry-run   # resolve + report only, no writes
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

/**
 * Fetch all thoughts (id + metadata) in pages, building:
 *   - titleGroups: normalized title -> { canonicalId, wikilinks, memberCount }
 *     (wikilinks taken from whichever chunk has the longest list, since
 *      they should be identical across chunks of the same note anyway)
 */
async function loadNoteIndex() {
  const titleGroups = new Map(); // normalized title -> { ids: [], wikilinks }

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

      if (!titleGroups.has(key)) titleGroups.set(key, { ids: [], wikilinks: [] });
      const group = titleGroups.get(key);
      group.ids.push(row.id);

      const wikilinks = row.metadata?.wikilinks;
      if (Array.isArray(wikilinks) && wikilinks.length > group.wikilinks.length) {
        group.wikilinks = wikilinks; // keep the longest observed list for this note
      }
    }

    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  // Assign canonical id per title group: deterministic MIN(id) (UUID string sort).
  for (const group of titleGroups.values()) {
    group.canonicalId = group.ids.reduce((min, id) => (id < min ? id : min), group.ids[0]);
  }

  return titleGroups;
}

async function main() {
  console.log('🔗 Open Brain — Wikilink Edge Extractor (B.2)');
  console.log('='.repeat(50));
  if (DRY_RUN) console.log('(dry run — no writes will be made)\n');

  console.log('Loading thoughts and grouping by note (title)...');
  const titleGroups = await loadNoteIndex();
  const notesWithLinks = [...titleGroups.values()].filter((g) => g.wikilinks.length > 0);
  console.log(
    `  ${titleGroups.size} unique notes indexed (from chunked thoughts), ` +
      `${notesWithLinks.length} notes have wikilinks\n`
  );

  const edgeMap = new Map(); // "sourceId->targetId" -> { source, target, linkText }
  let totalLinks = 0;
  let resolved = 0;
  const unresolved = new Map(); // link text -> count

  for (const group of notesWithLinks) {
    const sourceCanonicalId = group.canonicalId;
    for (const linkText of group.wikilinks) {
      totalLinks++;
      const key = typeof linkText === 'string' ? linkText.trim().toLowerCase() : '';
      const targetGroup = titleGroups.get(key);

      if (!targetGroup) {
        unresolved.set(linkText, (unresolved.get(linkText) ?? 0) + 1);
        continue;
      }

      const targetCanonicalId = targetGroup.canonicalId;
      if (targetCanonicalId === sourceCanonicalId) continue; // no self-loops (note links to itself)

      resolved++;
      const edgeKey = `${sourceCanonicalId}->${targetCanonicalId}`;
      if (!edgeMap.has(edgeKey)) {
        edgeMap.set(edgeKey, {
          source_thought_id: sourceCanonicalId,
          target_thought_id: targetCanonicalId,
          edge_source: 'wikilink',
          confidence: 1.0,
          metadata: { link_text: linkText },
        });
      }
    }
  }

  const edges = [...edgeMap.values()];
  const resolutionRate = totalLinks > 0 ? ((resolved / totalLinks) * 100).toFixed(1) : '0.0';

  console.log(`Total wikilink references (across all chunks): ${totalLinks}`);
  console.log(`Resolved (note-to-note):                       ${resolved} (${resolutionRate}%)`);
  console.log(`Unique edges after dedup:                      ${edges.length}`);
  console.log(`Unresolved link targets:                        ${unresolved.size} unique\n`);

  if (unresolved.size > 0) {
    const top = [...unresolved.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    console.log('Top unresolved link targets (likely non-existent notes or aliases):');
    for (const [text, count] of top) console.log(`  ${count.toString().padStart(4)}x  ${text}`);
    console.log('');
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
  console.log('\n\n✅ Wikilink edge extraction complete.');
}

main().catch((err) => {
  console.error(`\n❌ ${err.message}`);
  process.exit(1);
});

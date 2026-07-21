#!/usr/recipes/env node
/**
 * recipes/build-wiki.js
 *
 * C.2 — Wiki Synthesis Engine.
 *
 * Identifies well-connected hub notes, gathers their graph neighbors, and
 * synthesises a 250-350 word wiki page via the local chat LLM. The page is
 * embedded and upserted into wiki_pages (keyed on slug) so re-running is safe.
 *
 * Hub selection: top-N notes ranked by degree (edge count) × hub content length.
 * This avoids synthesising structural index notes (high degree but minimal own
 * content like course syllabi) in favour of notes with real prose.
 *
 * Context per synthesis: up to MAX_NEIGHBORS neighbors × MAX_NEIGHBOR_CHARS each
 * (~3 000–6 000 tokens total input). Well within the local model context window.
 *
 * Usage:
 *   node recipes/build-wiki.js                      # build top 20 hubs
 *   node recipes/build-wiki.js --limit 50           # build top 50
 *   node recipes/build-wiki.js --slug ai-snake-oil  # rebuild one page by slug
 *   node recipes/build-wiki.js --min-degree 15      # only hubs with ≥15 edges
 *   node recipes/build-wiki.js --dry-run            # select + prompt, no writes
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath   = join(__dirname, '../.env');
if (!existsSync(envPath)) throw new Error(`.env not found at ${envPath}`);

const env = Object.fromEntries(
  readFileSync(envPath, 'utf-8').split('\n')
    .filter(l => l && !l.startsWith('#'))
    .map(l => { const [k,...v]=l.split('='); return [k.trim(), v.join('=').trim()]; })
);

const {
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
  LOCAL_LLM_BASE_URL, LOCAL_CHAT_MODEL, LOCAL_EMBEDDING_MODEL,
  LOCAL_LLM_API, EMBEDDING_DIMENSIONS,
} = { ...env, ...process.env };

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY)
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
if (!LOCAL_LLM_BASE_URL || !LOCAL_CHAT_MODEL || !LOCAL_EMBEDDING_MODEL)
  throw new Error('LOCAL_LLM_BASE_URL, LOCAL_CHAT_MODEL, LOCAL_EMBEDDING_MODEL must be set');

const sb       = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const DIMS     = parseInt(EMBEDDING_DIMENSIONS ?? '2560', 10);
const LLM_BASE = LOCAL_LLM_BASE_URL.replace(/\/+$/, '');

// ── CLI flags ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
function flag(name, defaultVal) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i+1] ? argv[i+1] : defaultVal;
}
const DRY_RUN       = argv.includes('--dry-run');
const SKIP_EXISTING = argv.includes('--skip-existing');
const LIMIT         = parseInt(flag('--limit', '20'), 10);
const MIN_DEGREE    = parseInt(flag('--min-degree', '10'), 10);
const SLUG_ARG      = argv.includes('--slug') ? flag('--slug', null) : null;

// ── Synthesis tuning ─────────────────────────────────────────────────────────
const MAX_NEIGHBORS       = 12;   // neighbors passed to LLM per synthesis
const MAX_NEIGHBOR_CHARS  = 500;  // chars taken from each neighbor's content
const MIN_HUB_CONTENT_LEN = 50;   // skip hubs with almost no own content

// ── LLM helpers ──────────────────────────────────────────────────────────────

function llmHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (LOCAL_LLM_API) h['Authorization'] = `Bearer ${LOCAL_LLM_API}`;
  return h;
}

async function synthesize(title, hubContent, neighbors) {
  const neighborBlocks = neighbors
    .map((n, i) => {
      const t = n.metadata?.title ?? 'Untitled';
      const c = n.content.slice(0, MAX_NEIGHBOR_CHARS).replace(/\n+/g, ' ').trim();
      return `[${i+1}] ${t}\n${c}`;
    })
    .join('\n\n');

  const hubBlock = hubContent
    ? `Hub note content:\n${hubContent.slice(0, MAX_NEIGHBOR_CHARS).trim()}\n\n`
    : '';

  const prompt = `${hubBlock}Connected notes (up to ${neighbors.length}):\n\n${neighborBlocks}`;

  const system = `You are building a personal knowledge wiki for a second brain system.
Given a hub note titled "${title}" and its connected notes, write a 250-350 word synthesis.

Structure your response as flowing prose (no headings, no bullet lists) covering:
- The central theme or purpose of this topic in the person's notes
- Key concepts, works, people, or ideas that appear across the connected notes
- Notable connections or tensions between sub-topics
- What this cluster of notes collectively suggests about the person's thinking

Write in second person ("Your notes on X reveal…", "Across these notes you've tracked…").
Be specific: reference actual note titles, authors, or concepts where they appear.
Output only the synthesis text — no preamble, no "Here is the synthesis:" framing.`;

  const res = await fetch(`${LLM_BASE}/chat/completions`, {
    method: 'POST',
    headers: llmHeaders(),
    body: JSON.stringify({
      model: LOCAL_CHAT_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user',   content: prompt },
      ],
      temperature: 0.4,
      max_tokens: 600,
    }),
  });
  if (!res.ok) throw new Error(`LLM synthesis HTTP ${res.status}: ${res.statusText}`);
  const data = await res.json();
  return data.choices[0].message.content.trim();
}

async function embed(text) {
  const res = await fetch(`${LLM_BASE}/embeddings`, {
    method: 'POST',
    headers: llmHeaders(),
    body: JSON.stringify({ model: LOCAL_EMBEDDING_MODEL, input: text }),
  });
  if (!res.ok) throw new Error(`Embedding HTTP ${res.status}`);
  const data = await res.json();
  const vec = data.data[0].embedding;
  if (vec.length !== DIMS)
    throw new Error(`Dimension mismatch: got ${vec.length}, expected ${DIMS}`);
  return vec;
}

// ── Slug generation ───────────────────────────────────────────────────────────

function toSlug(title) {
  return title
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80);
}

// ── Hub selection ─────────────────────────────────────────────────────────────

async function selectHubs() {
  if (SLUG_ARG) {
    // single-slug rebuild: find the canonical thought matching that slug
    const allPages = await sb.from('wiki_pages').select('slug,title').eq('slug', SLUG_ARG);
    if (allPages.data?.length) {
      // it already exists — find its hub thought
      const title = allPages.data[0].title;
      const { data } = await sb.from('thoughts')
        .select('id, content, metadata->>title')
        .eq('metadata->>title', title).limit(1);
      if (!data?.length) throw new Error(`No thought found for title: ${title}`);
      return [{ id: data[0].id, title, content: data[0].content, degree: 0 }];
    }
    // new slug: try to resolve by title from slug text
    const guessTitle = SLUG_ARG.replace(/-/g, ' ');
    const { data } = await sb.from('thoughts')
      .select('id, content, metadata->>title')
      .ilike('metadata->>title', `%${guessTitle}%`).limit(1);
    if (!data?.length) throw new Error(`Cannot resolve slug: ${SLUG_ARG}`);
    return [{ id: data[0].id, title: data[0].title, content: data[0].content, degree: 0 }];
  }

  // compute degree for every canonical thought (MIN(id) per title)
  const PAGE_SIZE = 1000;
  const titleGroups = new Map();
  let from = 0;
  for (;;) {
    const { data, error } = await sb.from('thoughts').select('id, content, metadata').range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`Fetch thoughts: ${error.message}`);
    if (!data.length) break;
    for (const row of data) {
      const title = row.metadata?.title;
      if (!title?.trim()) continue;
      const key = title.trim().toLowerCase();
      if (!titleGroups.has(key)) titleGroups.set(key, { ids: [], title: title.trim(), content: '' });
      const g = titleGroups.get(key);
      g.ids.push(row.id);
      if (row.content.length > g.content.length) g.content = row.content;
    }
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  // assign canonical id
  for (const g of titleGroups.values())
    g.canonicalId = g.ids.reduce((min, id) => id < min ? id : min, g.ids[0]);

  // fetch all edges and count degree per canonical id
  const { data: edges } = await sb.from('graph_edges').select('source_thought_id, target_thought_id');
  const degree = {};
  for (const e of edges) {
    degree[e.source_thought_id] = (degree[e.source_thought_id] ?? 0) + 1;
    degree[e.target_thought_id] = (degree[e.target_thought_id] ?? 0) + 1;
  }

  // rank by degree × content length; filter by min-degree and min content
  const ranked = [...titleGroups.values()]
    .filter(g => (degree[g.canonicalId] ?? 0) >= MIN_DEGREE)
    .filter(g => g.content.length >= MIN_HUB_CONTENT_LEN)
    .map(g => ({
      id:      g.canonicalId,
      title:   g.title,
      content: g.content,
      degree:  degree[g.canonicalId] ?? 0,
      score:   (degree[g.canonicalId] ?? 0) * g.content.length,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, LIMIT);

  return ranked;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('📖  Open Brain — Wiki Synthesis Engine (C.2)');
  console.log('='.repeat(50));
  if (DRY_RUN) console.log('(dry run — no writes)\n');

  const hubs = await selectHubs();
  console.log(`Selected ${hubs.length} hub(s) for synthesis`);
  if (hubs.length === 0) { console.log('Nothing to do.'); return; }

  let built = 0, skipped = 0;
  const start = Date.now();

  // pre-load existing slugs if --skip-existing
  const existingSlugs = new Set();
  if (SKIP_EXISTING) {
    const { data: existing } = await sb.from('wiki_pages').select('slug');
    for (const p of existing ?? []) existingSlugs.add(p.slug);
    console.log(`Skipping ${existingSlugs.size} already-built page(s)\n`);
  }

  for (const hub of hubs) {
    const slug = SLUG_ARG ?? toSlug(hub.title);
    console.log(`\n[${built + skipped + 1}/${hubs.length}] "${hub.title}" (degree=${hub.degree}, slug=${slug})`);

    if (SKIP_EXISTING && existingSlugs.has(slug)) {
      console.log('  → already built, skipping');
      skipped++;
      continue;
    }

    // gather neighbors
    const { data: neighbors, error: nErr } = await sb.rpc('expand_graph_neighbors', {
      p_thought_ids:    [hub.id],
      p_min_confidence: 0.5,
      p_limit:          MAX_NEIGHBORS,
    });
    if (nErr) { console.warn(`  ⚠ graph expansion failed: ${nErr.message} — skipping`); skipped++; continue; }
    console.log(`  neighbors: ${neighbors.length}`);

    if (DRY_RUN) {
      const neighborChars = neighbors.reduce((s,n)=>s+Math.min(n.content.length,MAX_NEIGHBOR_CHARS),0);
      console.log(`  estimated prompt chars: ~${neighborChars + Math.min(hub.content.length,MAX_NEIGHBOR_CHARS)}`);
      built++;
      continue;
    }

    // synthesize
    let synthesis;
    const t0 = Date.now();
    try {
      synthesis = await synthesize(hub.title, hub.content, neighbors);
    } catch (err) {
      console.warn(`  ⚠ synthesis failed: ${err.message} — skipping`);
      skipped++;
      continue;
    }
    const synthMs = Date.now() - t0;
    console.log(`  synthesis: ${synthesis.length} chars, ${synthMs}ms`);

    // embed
    let embedding;
    try {
      embedding = await embed(synthesis);
    } catch (err) {
      console.warn(`  ⚠ embedding failed: ${err.message} — skipping`);
      skipped++;
      continue;
    }

    // upsert
    const sourceIds = [hub.id, ...neighbors.map(n => n.neighbor_id)].filter(Boolean);
    const { error: upsertErr } = await sb.from('wiki_pages').upsert({
      slug,
      title:              hub.title,
      content:            synthesis,
      page_type:          'hub_synthesis',
      source_thought_ids: sourceIds,
      embedding,
      model_used:         LOCAL_CHAT_MODEL,
    }, { onConflict: 'slug' });

    if (upsertErr) {
      console.warn(`  ⚠ upsert failed: ${upsertErr.message} — skipping`);
      skipped++;
      continue;
    }

    console.log(`  ✓ saved (total: ${Date.now()-t0}ms)`);
    built++;
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n${'='.repeat(50)}`);
  console.log(`✅  Built: ${built}  Skipped: ${skipped}  Time: ${elapsed}s`);
}

main().catch(err => { console.error(`\n❌ ${err.message}`); process.exit(1); });

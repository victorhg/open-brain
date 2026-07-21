/**
 * lib/context-assembler.js (inside open-brain-core)
 *
 * Central retrieval and context assembly module for Open Brain.
 * All tools that need to query the knowledge graph import from here.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// ---------------------------------------------------------------------------
// Environment + Supabase
// Helper to locate .env by walking up directories
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

function findEnvFile(startDir) {
  let curr = startDir;
  while (curr && curr !== dirname(curr)) {
    const candidate = join(curr, '.env');
    if (existsSync(candidate)) return candidate;
    curr = dirname(curr);
  }
  return null;
}

const envPath = findEnvFile(__dirname) || join(process.cwd(), '.env');

let fileEnv = {};
if (existsSync(envPath)) {
  fileEnv = Object.fromEntries(
    readFileSync(envPath, 'utf-8')
      .split('\n')
      .filter(line => line && !line.startsWith('#'))
      .map(line => {
        const [key, ...rest] = line.split('=');
        return [key.trim(), rest.join('=').trim()];
      })
  );
}

// process.env takes precedence (allows CI / shell overrides)
export const env = { ...fileEnv, ...process.env };

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  LOCAL_LLM_BASE_URL,
  LOCAL_EMBEDDING_MODEL,
  LOCAL_LLM_API,
} = env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('[open-brain-core] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ---------------------------------------------------------------------------
// Embedding
// ---------------------------------------------------------------------------

/**
 * Generate an embedding vector via the local OpenAI-compatible server.
 * Throws on missing config or HTTP error — no cloud fallback.
 *
 * @param {string} text
 * @returns {Promise<number[]>}
 */
export async function generateEmbedding(text) {
  if (!LOCAL_LLM_BASE_URL || !LOCAL_EMBEDDING_MODEL) {
    throw new Error('[open-brain-core] LOCAL_LLM_BASE_URL and LOCAL_EMBEDDING_MODEL must be set in .env');
  }
  const url = `${LOCAL_LLM_BASE_URL.replace(/\/+$/, '')}/embeddings`;
  const headers = { 'Content-Type': 'application/json' };
  if (LOCAL_LLM_API) headers['Authorization'] = `Bearer ${LOCAL_LLM_API}`;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: LOCAL_EMBEDDING_MODEL, input: text }),
  });
  if (!res.ok) throw new Error(`[open-brain-core] Embedding HTTP ${res.status}: ${res.statusText}`);
  const data = await res.json();
  return data.data[0].embedding;
}

// ---------------------------------------------------------------------------
// Context formatting
// ---------------------------------------------------------------------------

/**
 * Format a single thought chunk into a labelled context block.
 * Used in the assembled context string and exposed for tools that need
 * per-chunk formatting (e.g. find-relations).
 *
 * @param {object} t  — a thought row from match_thoughts RPC
 * @returns {string}
 */
export function formatChunk(t) {
  const title  = t.metadata?.title    || 'Unknown';
  const folder = t.metadata?.folder   || t.metadata?.category || 'Unknown';
  const date   = t.created_at
    ? new Date(t.created_at).toISOString().split('T')[0]
    : 'Unknown';
  return `[Source: ${title} | ${folder} | ${date}]\n${t.content}`;
}

// ---------------------------------------------------------------------------
// assembleContext — the main retrieval pipeline
// ---------------------------------------------------------------------------

/**
 * Assemble retrieval context for a query through all active pipeline stages.
 *
 * @param {object} opts
 * @returns {Promise<object>}
 */
export async function assembleContext({
  query,
  topK               = 6,
  minSimilarity      = 0.25,
  includeGraph       = false,
  graphMinConfidence = 0.5,
  graphLimit         = 10,
  includeWiki        = false,
  includeLearnings   = false,
} = {}) {
  if (!query) throw new Error('[open-brain-core] query is required');

  // Stage 1: Semantic search
  const embedding = await generateEmbedding(query);

  const { data, error } = await supabase.rpc('match_thoughts', {
    query_embedding: embedding,
    match_threshold: minSimilarity,
    match_count:     topK,
  });
  if (error) throw new Error(`[open-brain-core] Semantic search failed: ${error.message}`);

  const chunks = data || [];

  // Stage 2: Graph expansion
  let graphNeighbors = [];
  if (includeGraph && chunks.length > 0) {
    const seedIds = chunks.map((c) => c.id);
    const { data: neighbors, error: graphError } = await supabase.rpc('expand_graph_neighbors', {
      p_thought_ids: seedIds,
      p_min_confidence: graphMinConfidence,
      p_limit: graphLimit,
    });
    if (graphError) {
      console.warn(`[open-brain-core] Graph expansion failed: ${graphError.message}`);
    } else {
      graphNeighbors = neighbors || [];
    }
  }

  // Stage 3: Wiki lookup
  let wikiPages = [];
  if (includeWiki) {
    const { data: semanticWiki, error: wErr } = await supabase.rpc('match_wiki_pages', {
      query_embedding: embedding,
      match_threshold: 0.3,
      match_count: 2,
    });
    if (wErr) {
      console.warn(`[open-brain-core] Wiki semantic search failed: ${wErr.message}`);
    } else {
      wikiPages.push(...(semanticWiki ?? []));
    }

    const { data: ftsWiki } = await supabase
      .from('wiki_pages')
      .select('id, slug, title, content, page_type, source_thought_ids, model_used, updated_at')
      .textSearch('title', query, { type: 'websearch', config: 'simple' })
      .limit(2);

    const seenIds = new Set(wikiPages.map(p => p.id));
    for (const p of ftsWiki ?? []) {
      if (!seenIds.has(p.id)) {
        wikiPages.push({ ...p, similarity: null });
        seenIds.add(p.id);
      }
    }
    wikiPages = wikiPages.slice(0, 3);
  }

  // Stage 4: Accumulated Learnings
  let learnings = [];
  if (includeLearnings) {
    const { data: foundLearnings, error: lErr } = await supabase
      .from('learnings')
      .select('id, insight, learning_type, confidence')
      .is('dismissed_at', null)
      .order('confidence', { ascending: false })
      .limit(3);

    if (lErr) {
      console.warn(`[open-brain-core] Learnings lookup failed: ${lErr.message}`);
    } else {
      learnings = foundLearnings ?? [];
    }
  }

  // Assemble final context string
  const sections = [];

  if (chunks.length > 0) {
    sections.push(chunks.map(formatChunk).join('\n\n---\n\n'));
  }

  if (graphNeighbors.length > 0) {
    const formatGraphNeighbor = (n) =>
      `${formatChunk(n)}\n[via: ${n.edge_source}, confidence: ${n.confidence}]`;
    sections.push(
      '[Graph Expansion]\n\n' +
      graphNeighbors.map(formatGraphNeighbor).join('\n\n---\n\n')
    );
  }

  if (wikiPages.length > 0) {
    sections.push(
      '[Wiki Pages]\n\n' +
      wikiPages.map(p => `[Wiki: ${p.title} (${p.page_type})]\n${p.content}`).join('\n\n---\n\n')
    );
  }

  if (learnings.length > 0) {
    sections.push(
      '[Accumulated Learnings]\n\n' +
      learnings.map(l => `- [${l.learning_type.toUpperCase()} | conf: ${l.confidence}] ${l.insight}`).join('\n')
    );
  }

  const assembledContext = sections.join('\n\n===\n\n');

  return { chunks, graphNeighbors, wikiPages, learnings, assembledContext };
}

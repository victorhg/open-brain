/**
 * lib/context-assembler.js
 *
 * Central retrieval and context assembly module for Open Brain.
 * All tools that need to query the knowledge graph import from here.
 *
 * Pipeline (current → future):
 *   Stage 1 — Semantic search      (pgvector cosine, thoughts table)   ✅ implemented
 *   Stage 2 — Graph expansion       (graph_edges 1-hop traversal)       TODO: Phase B
 *   Stage 3 — Wiki lookup           (wiki_pages entity/synthesis pages) TODO: Phase C
 *
 * Exports:
 *   env              — merged .env + process.env object (for callers that need LLM config)
 *   generateEmbedding(text) → float[]
 *   assembleContext(opts)   → { chunks, graphNeighbors, wikiPages, assembledContext }
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// ---------------------------------------------------------------------------
// Environment + Supabase
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const envPath = join(__dirname, '../.env');
if (!existsSync(envPath)) {
  throw new Error(`[context-assembler] .env not found at ${envPath}`);
}

const fileEnv = Object.fromEntries(
  readFileSync(envPath, 'utf-8')
    .split('\n')
    .filter(line => line && !line.startsWith('#'))
    .map(line => {
      const [key, ...rest] = line.split('=');
      return [key.trim(), rest.join('=').trim()];
    })
);

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
  throw new Error('[context-assembler] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env');
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
    throw new Error('[context-assembler] LOCAL_LLM_BASE_URL and LOCAL_EMBEDDING_MODEL must be set in .env');
  }
  const url = `${LOCAL_LLM_BASE_URL.replace(/\/+$/, '')}/embeddings`;
  const headers = { 'Content-Type': 'application/json' };
  if (LOCAL_LLM_API) headers['Authorization'] = `Bearer ${LOCAL_LLM_API}`;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: LOCAL_EMBEDDING_MODEL, input: text }),
  });
  if (!res.ok) throw new Error(`[context-assembler] Embedding HTTP ${res.status}: ${res.statusText}`);
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
 * @typedef {object} AssemblerOptions
 * @property {string}  query                   - The user's query text.
 * @property {number}  [topK=6]                - Max semantic hits to retrieve.
 * @property {number}  [minSimilarity=0.25]    - Cosine similarity floor.
 * @property {boolean} [includeGraph=false]    - Phase B: graph_edges 1-hop expansion.
 * @property {number}  [graphMinConfidence=0.5] - Phase B: min edge confidence to include.
 * @property {number}  [graphLimit=10]          - Phase B: max graph neighbors to return.
 * @property {boolean} [includeWiki=false]     - Phase C: wiki_pages lookup.
 *
 * @typedef {object} ContextResult
 * @property {object[]} chunks           - Ranked semantic hits (thought rows).
 * @property {object[]} graphNeighbors   - Phase B: 1-hop graph expansions.
 * @property {object[]} wikiPages        - Phase C: matching wiki_pages rows.
 * @property {string}   assembledContext - Ready-to-inject prompt block.
 */

/**
 * Assemble retrieval context for a query through all active pipeline stages.
 *
 * @param {AssemblerOptions} opts
 * @returns {Promise<ContextResult>}
 */
export async function assembleContext({
  query,
  topK               = 6,
  minSimilarity      = 0.25,
  includeGraph       = false,
  graphMinConfidence = 0.5,
  graphLimit         = 10,
  includeWiki        = false,
} = {}) {
  if (!query) throw new Error('[context-assembler] query is required');

  // ------------------------------------------------------------------
  // Stage 1: Semantic search (pgvector cosine)
  // ------------------------------------------------------------------
  const embedding = await generateEmbedding(query);

  const { data, error } = await supabase.rpc('match_thoughts', {
    query_embedding: embedding,
    match_threshold: minSimilarity,
    match_count:     topK,
  });
  if (error) throw new Error(`[context-assembler] Semantic search failed: ${error.message}`);

  const chunks = data || [];

  // ------------------------------------------------------------------
  // Stage 2: Graph expansion — Phase B (graph_edges 1-hop traversal)
  // ------------------------------------------------------------------
  let graphNeighbors = [];
  if (includeGraph && chunks.length > 0) {
    const seedIds = chunks.map((c) => c.id);
    const { data: neighbors, error: graphError } = await supabase.rpc('expand_graph_neighbors', {
      p_thought_ids: seedIds,
      p_min_confidence: graphMinConfidence,
      p_limit: graphLimit,
    });
    if (graphError) {
      console.warn(`[context-assembler] Graph expansion failed: ${graphError.message}`);
    } else {
      graphNeighbors = neighbors || [];
    }
  }

  // ------------------------------------------------------------------
  // Stage 3: Wiki lookup — Phase C (wiki_pages RPC + FTS)
  // ------------------------------------------------------------------
  let wikiPages = [];
  if (includeWiki) {
    // TODO: Phase C
    // 1. Call match_wiki_pages RPC with query embedding (threshold 0.3, limit 3)
    // 2. Text-search wiki_pages titles against extracted entity names from the query
    // 3. Deduplicate and append to wikiPages
    console.warn('[context-assembler] --wiki requested but Phase C (wiki_pages) is not yet implemented.');
  }

  // ------------------------------------------------------------------
  // Assemble final context string
  // ------------------------------------------------------------------
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

  const assembledContext = sections.join('\n\n===\n\n');

  return { chunks, graphNeighbors, wikiPages, assembledContext };
}

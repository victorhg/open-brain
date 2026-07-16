#!/usr/bin/env node

/**
 * Open Brain Local CLI Query Utility
 * 
 * Queries your personal knowledge graph semantically from the command line.
 * Generates query embeddings using your local LLM,
 * and matches them against thoughts in your Supabase database.
 * 
 * Usage:
 *   node bin/query-brain.js "your semantic search query" [--limit 5] [--threshold 0.3] [--answer] [--strict]
 * 
 * Options:
 *   --limit N         Max search results (default: 5)
 *   --threshold T     Similarity threshold 0-1 (default: 0.3)
 *   --answer          Synthesize a grounded answer using the local Chat LLM
 *   --strict          Abort answer generation if best match similarity < 0.25 (no hallucination on weak context)
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from project root
const envPath = join(__dirname, '../.env');
if (!existsSync(envPath)) {
  console.error('❌ Error: .env file not found in project root');
  process.exit(1);
}

const envContent = readFileSync(envPath, 'utf-8');
const fileEnv = Object.fromEntries(
  envContent.split('\n')
    .filter(line => line && !line.startsWith('#'))
    .map(line => {
      const [key, ...valueParts] = line.split('=');
      return [key.trim(), valueParts.join('=').trim()];
    })
);

// Allow process.env to override .env file variables (standard practice)
const env = { ...fileEnv, ...process.env };

const { 
  SUPABASE_URL, 
  SUPABASE_SERVICE_ROLE_KEY, 
  LOCAL_LLM_BASE_URL,
  LOCAL_EMBEDDING_MODEL,
  LOCAL_CHAT_MODEL
} = env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Error: Missing required Supabase credentials in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// --- Parse CLI Args ---
const args = process.argv.slice(2);
const queryText = args[0];

if (!queryText || queryText.startsWith('-')) {
  console.log('🤖 Open Brain Semantic Search CLI');
  console.log('═'.repeat(40));
  console.log('Usage:');
  console.log('  node bin/query-brain.js "<search query>" [options]');
  console.log('');
  console.log('Options:');
  console.log('  --limit N        Max results (default: 5)');
  console.log('  --threshold T    Similarity threshold 0-1 (default: 0.3)');
  console.log('  --answer         Synthesize a grounded answer using your local Chat LLM');
  console.log('  --strict         Abort if best match similarity < 0.25 (prevents hallucination on weak context)');
  console.log('');
  console.log('Example:');
  console.log('  node bin/query-brain.js "what did I discuss with Sarah about SEO" --answer');
  process.exit(0);
}

let limit = 5;
let threshold = 0.3;
let answer = false;
let strict = false;

for (let i = 1; i < args.length; i++) {
  if (args[i] === '--limit') limit = parseInt(args[++i], 10) || 5;
  if (args[i] === '--threshold') threshold = parseFloat(args[++i]) || 0.3;
  if (args[i] === '--answer') answer = true;
  if (args[i] === '--strict') strict = true;
}

// --- Helpers ---

// Generate Embedding via Local LLM
async function generateEmbedding(text) {
  if (!LOCAL_LLM_BASE_URL || !LOCAL_EMBEDDING_MODEL) {
    console.error('❌ LOCAL_LLM_BASE_URL and LOCAL_EMBEDDING_MODEL must be set in .env');
    return null;
  }
  try {
    const url = `${LOCAL_LLM_BASE_URL.replace(/\/+$/, '')}/embeddings`;
    const headers = { 'Content-Type': 'application/json' };
    if (env.LOCAL_LLM_API) headers['Authorization'] = `Bearer ${env.LOCAL_LLM_API}`;

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: LOCAL_EMBEDDING_MODEL, input: text }),
    });
    if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
    const data = await res.json();
    return data.data[0].embedding;
  } catch (err) {
    console.error(`❌ Failed to generate query embedding: ${err.message}`);
    return null;
  }
}

// Grounding system prompt — the LLM must answer ONLY from provided context
const GROUNDING_SYSTEM_PROMPT = `You are a personal knowledge assistant.
Answer the user's question using ONLY the context passages provided below.
Rules:
- If the context contains a clear answer, provide it and cite the source note title in [brackets].
- If the context is partially relevant, share what it says and note its limits.
- If the context does not contain enough information, respond with exactly:
  "I don't have enough information in your notes to answer this."
- Never use knowledge from outside the provided context.
- Never invent facts, dates, names, or relationships not present in the context.`;

// Ask Local LLM to synthesize a grounded answer based on search context
async function synthesizeAnswer(question, contextThoughts) {
  if (!LOCAL_LLM_BASE_URL || !LOCAL_CHAT_MODEL) {
    return '⚠️ LOCAL_LLM_BASE_URL and LOCAL_CHAT_MODEL must be set in .env for answer synthesis.';
  }
  try {
    const url = `${LOCAL_LLM_BASE_URL.replace(/\/+$/, '')}/chat/completions`;
    const headers = { 'Content-Type': 'application/json' };
    if (env.LOCAL_LLM_API) headers['Authorization'] = `Bearer ${env.LOCAL_LLM_API}`;

    // Format each chunk with full source provenance header
    const contextText = contextThoughts.map((t) => {
      const title  = t.metadata?.title  || 'Unknown';
      const folder = t.metadata?.folder || t.metadata?.category || 'Unknown';
      const date   = t.created_at ? new Date(t.created_at).toISOString().split('T')[0] : 'Unknown';
      return `[Source: ${title} | ${folder} | ${date}]\n${t.content}`;
    }).join('\n\n---\n\n');

    const body = {
      model: LOCAL_CHAT_MODEL,
      messages: [
        { role: 'system', content: GROUNDING_SYSTEM_PROMPT },
        { role: 'user', content: `CONTEXT:\n\n${contextText}\n\nQUESTION:\n${question}` },
      ],
      temperature: 0.3,
    };

    console.log(`\n🧠 Synthesizing grounded answer via local LLM (${LOCAL_CHAT_MODEL})...\n`);

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.choices[0].message.content;
  } catch (err) {
    return `⚠️ Could not synthesize answer locally: ${err.message}`;
  }
}

// --- Main Execution ---

async function runSearch() {
  console.log(`\n🔍 Searching Open Brain for: "${queryText}"...`);
  
  // 1. Generate search query embedding
  const embedding = await generateEmbedding(queryText);
  if (!embedding) {
    console.error('❌ Could not generate query vector. Exiting.');
    process.exit(1);
  }

  // 2. Query pgvector match RPC in Supabase
  const { data: matches, error } = await supabase.rpc('match_thoughts', {
    query_embedding: embedding,
    match_threshold: threshold,
    match_count: limit
  });

  if (error) {
    console.error(`❌ Semantic search failed: ${error.message}`);
    process.exit(1);
  }

  if (!matches || matches.length === 0) {
    console.log('\n🤷 No relevant thoughts found in your database. Try lowering the --threshold.');
    process.exit(0);
  }

  console.log(`\n🎉 Found ${matches.length} matching thought(s) in your Open Brain:\n`);

  matches.forEach((m, idx) => {
    const title = m.metadata?.title || 'Atomic Capture';
    const header = m.metadata?.header ? ` > ${m.metadata.header}` : '';
    const type = m.metadata?.type || m.type || 'observation';
    const category = m.metadata?.category || 'general';
    const similarity = (m.similarity * 100).toFixed(1);

    console.log(`📌 Result #${idx + 1} [Relevance: ${similarity}% | Type: ${type} | Topic: ${category}]`);
    console.log(`📂 Source: Obsidian > ${title}${header}`);
    console.log('─'.repeat(50));
    console.log(m.content.replace(/^\[Obsidian:.*\]\n\n/, '').trim()); // Strip prefix for clean terminal reading
    
    if (m.derived_from && m.derived_from.length > 0) {
      console.log(`🔗 Provenance: Derived from ${m.derived_from.length} parent note(s)`);
    }
    console.log('\n' + '═'.repeat(60) + '\n');
  });

  // 3. Synthesize grounded answer if requested
  if (answer) {
    // --strict guard: abort if best match is below the confident-context threshold
    if (strict) {
      const maxSimilarity = Math.max(...matches.map(m => m.similarity));
      if (maxSimilarity < 0.25) {
        console.log('\n🔒 [--strict] Best match similarity is ' + (maxSimilarity * 100).toFixed(1) + '% — below the 25% confident-context threshold.');
        console.log("I don't have enough information in your notes to answer this.");
        process.exit(0);
      }
    }

    const answerText = await synthesizeAnswer(queryText, matches);
    console.log('═'.repeat(60));
    console.log('🤖 GROUNDED ANSWER:');
    console.log('═'.repeat(60));
    console.log(answerText);
    console.log('═'.repeat(60));
  }
}

runSearch().catch(err => {
  console.error('Fatal query search error:', err);
  process.exit(1);
});

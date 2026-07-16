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

import { assembleContext, env, generateEmbedding } from '../../lib/context-assembler.js';

const { LOCAL_LLM_BASE_URL, LOCAL_CHAT_MODEL } = env;

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

// Remove duplicate generateEmbedding — imported from lib/context-assembler.js


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

/**
 * Ask the local LLM to synthesize a grounded answer from a pre-assembled context string.
 * @param {string} question
 * @param {string} assembledContext  — formatted context block from assembleContext()
 */
async function synthesizeAnswer(question, assembledContext) {
  if (!LOCAL_LLM_BASE_URL || !LOCAL_CHAT_MODEL) {
    return '⚠️ LOCAL_LLM_BASE_URL and LOCAL_CHAT_MODEL must be set in .env for answer synthesis.';
  }
  try {
    const url = `${LOCAL_LLM_BASE_URL.replace(/\/+$/, '')}/chat/completions`;
    const headers = { 'Content-Type': 'application/json' };
    if (env.LOCAL_LLM_API) headers['Authorization'] = `Bearer ${env.LOCAL_LLM_API}`;

    const body = {
      model: LOCAL_CHAT_MODEL,
      messages: [
        { role: 'system', content: GROUNDING_SYSTEM_PROMPT },
        { role: 'user', content: `CONTEXT:\n\n${assembledContext}\n\nQUESTION:\n${question}` },
      ],
      temperature: 0.3,
    };

    console.log(`\n🧠 Synthesizing grounded answer via local LLM (${LOCAL_CHAT_MODEL})...\n`);

    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
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

  // 1. Retrieve and assemble context via the shared assembler
  let chunks, assembledContext;
  try {
    ({ chunks, assembledContext } = await assembleContext({
      query:         queryText,
      topK:          limit,
      minSimilarity: threshold,
    }));
  } catch (err) {
    console.error(`❌ Context assembly failed: ${err.message}`);
    process.exit(1);
  }

  if (!chunks || chunks.length === 0) {
    console.log('\n🤷 No relevant thoughts found in your database. Try lowering the --threshold.');
    process.exit(0);
  }

  console.log(`\n🎉 Found ${chunks.length} matching thought(s) in your Open Brain:\n`);

  chunks.forEach((m, idx) => {
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

  // 2. Synthesize grounded answer if requested
  if (answer) {
    // --strict guard: abort if best match is below the confident-context threshold
    if (strict) {
      const maxSimilarity = Math.max(...chunks.map(m => m.similarity));
      if (maxSimilarity < 0.25) {
        console.log('\n🔒 [--strict] Best match similarity is ' + (maxSimilarity * 100).toFixed(1) + '% — below the 25% confident-context threshold.');
        console.log("I don't have enough information in your notes to answer this.");
        process.exit(0);
      }
    }

    const answerText = await synthesizeAnswer(queryText, assembledContext);
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

#!/usr/bin/env node

/**
 * Open Brain Local CLI Query Utility
 * 
 * Queries your personal knowledge graph semantically from the command line.
 * Generates query embeddings using your local LLM (OMLX) or OpenRouter,
 * and matches them against thoughts in your Supabase database.
 * 
 * Usage:
 *   node bin/query-brain.js "your semantic search query" [--limit 5] [--threshold 0.3] [--answer]
 * 
 * Options:
 *   --limit N         Max search results (default: 5)
 *   --threshold T     Min similarity score 0-1 (default: 0.3)
 *   --answer          Have the local LLM answer your question using the matched context!
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
  OPENROUTER_API_KEY,
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
  console.log('  --answer         Synthesize an answer using your local Chat LLM');
  console.log('');
  console.log('Example:');
  console.log('  node bin/query-brain.js "what did I discuss with Sarah about SEO" --answer');
  process.exit(0);
}

let limit = 5;
let threshold = 0.3;
let answer = false;

for (let i = 1; i < args.length; i++) {
  if (args[i] === '--limit') limit = parseInt(args[++i], 10) || 5;
  if (args[i] === '--threshold') threshold = parseFloat(args[++i]) || 0.3;
  if (args[i] === '--answer') answer = true;
}

// --- Helpers ---

// Generate Embedding via Local LLM or OpenRouter
async function generateEmbedding(text) {
  try {
    const isLocal = !!LOCAL_LLM_BASE_URL && !!LOCAL_EMBEDDING_MODEL;
    const url = isLocal 
      ? `${LOCAL_LLM_BASE_URL.replace(/\/+$/, '')}/embeddings` 
      : 'https://openrouter.ai/api/v1/embeddings';
    
    const headers = { 'Content-Type': 'application/json' };
    if (isLocal) {
      if (env.LOCAL_LLM_API) {
        headers['Authorization'] = `Bearer ${env.LOCAL_LLM_API}`;
      }
    } else {
      headers['Authorization'] = `Bearer ${OPENROUTER_API_KEY}`;
    }

    const body = {
      model: isLocal ? LOCAL_EMBEDDING_MODEL : 'openai/text-embedding-3-small',
      input: text
    };
    
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    
    if (!res.ok) {
      throw new Error(`HTTP Error ${res.status}`);
    }
    
    const data = await res.json();
    return data.data[0].embedding;
  } catch (err) {
    console.error(`❌ Failed to generate query embedding: ${err.message}`);
    return null;
  }
}

// Ask Local LLM / OpenRouter to synthesize an answer based on search context
async function synthesizeAnswer(question, contextThoughts) {
  try {
    const isLocal = !!LOCAL_LLM_BASE_URL && !!LOCAL_CHAT_MODEL;
    const url = isLocal 
      ? `${LOCAL_LLM_BASE_URL.replace(/\/+$/, '')}/chat/completions` 
      : 'https://openrouter.ai/api/v1/chat/completions';
    
    const headers = { 'Content-Type': 'application/json' };
    if (isLocal) {
      if (env.LOCAL_LLM_API) {
        headers['Authorization'] = `Bearer ${env.LOCAL_LLM_API}`;
      }
    } else {
      headers['Authorization'] = `Bearer ${OPENROUTER_API_KEY}`;
    }

    const contextText = contextThoughts.map((t, i) => `[Source ${i+1}: ${t.metadata?.title || 'Unknown'}]\n${t.content}`).join('\n\n');

    const prompt = `You are Open Brain, a helpful personal knowledge assistant.
Answer the user's question relying strictly on the highly relevant context retrieved from their personal thoughts and Obsidian vault notes.
If the context does not contain the answer, say honestly that you couldn't find enough information in their brain.

CONTEXT:
${contextText}

QUESTION:
${question}`;

    const body = {
      model: isLocal ? LOCAL_CHAT_MODEL : 'openai/gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
    };

    console.log(`\n🧠 Synthesizing local answer using ${isLocal ? 'Local Chat LLM (' + LOCAL_CHAT_MODEL + ')' : 'OpenRouter'}...\n`);

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

  // 3. Synthesize Local Answer if requested
  if (answer) {
    const answerText = await synthesizeAnswer(queryText, matches);
    console.log('═'.repeat(60));
    console.log('🤖 SYNTHESIZED ANSWER:');
    console.log('═'.repeat(60));
    console.log(answerText);
    console.log('═'.repeat(60));
  }
}

runSearch().catch(err => {
  console.error('Fatal query search error:', err);
  process.exit(1);
});

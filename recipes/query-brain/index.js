#!/usr/bin/env node

/**
 * Open Brain Local CLI Query Utility
 * 
 * Queries your personal knowledge graph semantically from the command line.
 * Generates query embeddings using your local LLM,
 * and matches them against thoughts in your Supabase database.
 * 
 * Usage:
 *   node bin/query-brain.js "your semantic search query" [--limit 5] [--threshold 0.3] [--answer] [--strict] [--graph]
 * 
 * Options:
 *   --limit N         Max search results (default: 5)
 *   --threshold T     Similarity threshold 0-1 (default: 0.3)
 *   --answer          Synthesize a grounded answer using the local Chat LLM
 *   --strict          Abort answer generation if best match similarity < 0.25
 *   --graph           Expand results with 1-hop graph neighbors
 *   --wiki            Prepend pre-computed wiki synthesis pages matching the query
 *   --learnings       Inject accumulated insights and patterns
 */

import { assembleContext, env, generateEmbedding } from '../../lib/context-assembler.js';
import { checkLLMHealth } from '../../lib/llm-health.js';

const { LOCAL_LLM_BASE_URL, LOCAL_CHAT_MODEL } = env;

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

export async function runQuery(queryText, options = {}) {
  const { limit = 5, threshold = 0.3, answer = false, strict = false, graph = false, wiki = false, learnings = false } = options;

  console.log(`\n🔍 Searching Open Brain for: "${queryText}"...`);

  let chunks, graphNeighbors, wikiPages, learningsFound, assembledContext;
  try {
    ({ chunks, graphNeighbors, wikiPages, learnings: learningsFound, assembledContext } = await assembleContext({
      query:            queryText,
      topK:             limit,
      minSimilarity:    threshold,
      includeGraph:     graph,
      includeWiki:      wiki,
      includeLearnings: learnings,
    }));
  } catch (err) {
    console.error(`❌ Context assembly failed: ${err.message}`);
    process.exit(1);
  }

  if (!chunks || chunks.length === 0) {
    console.log('\n🤷 No relevant thoughts found in your database. Try lowering the --threshold.');
    return;
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
    console.log(m.content.replace(/^\[Obsidian:.*\]\n\n/, '').trim());
    
    if (m.derived_from && m.derived_from.length > 0) {
      console.log(`🔗 Provenance: Derived from ${m.derived_from.length} parent note(s)`);
    }
    console.log('\n' + '═'.repeat(60) + '\n');
  });

  if (wiki && wikiPages && wikiPages.length > 0) {
    console.log(`📖  Wiki Pages — ${wikiPages.length} pre-computed synthesis page(s):\n`);
    wikiPages.forEach((p, idx) => {
      const sim = p.similarity != null ? ` (similarity: ${(p.similarity*100).toFixed(0)}%)` : '';
      console.log(`  ${idx + 1}. ${p.title}${sim}`);
      console.log('  ' + '─'.repeat(48));
      console.log('  ' + p.content.slice(0, 500).replace(/\n/g, '\n  '));
      console.log('  ...');
      console.log();
    });
    console.log('═'.repeat(60) + '\n');
  } else if (wiki) {
    console.log('📖  Wiki Pages: no matching synthesis pages found.\n');
  }

  if (graph && graphNeighbors && graphNeighbors.length > 0) {
    console.log(`🕸️  Graph Expansion — ${graphNeighbors.length} related note(s):\n`);
    graphNeighbors.forEach((n, idx) => {
      const title = n.metadata?.title || 'Untitled';
      const via = n.edge_source === 'wikilink' ? '🔗 wikilink' : '🏷️  shared tag';
      console.log(`  ${idx + 1}. ${title} (${via}, confidence: ${n.confidence})`);
    });
    console.log('\n' + '═'.repeat(60) + '\n');
  } else if (graph) {
    console.log('🕸️  Graph Expansion: no connected notes found above the confidence threshold.\n');
  }

  if (learnings && learningsFound && learningsFound.length > 0) {
    console.log(`💡  Accumulated Learnings — ${learningsFound.length} insight(s):\n`);
    learningsFound.forEach((l, idx) => {
      console.log(`  ${idx + 1}. [${l.learning_type.toUpperCase()} | conf: ${l.confidence}] ${l.insight}`);
    });
    console.log('\n' + '═'.repeat(60) + '\n');
  } else if (learnings) {
    console.log('💡  Accumulated Learnings: no relevant insights found.\n');
  }

  if (answer) {
    const { isHealthy, circuitBroken } = await checkLLMHealth();
    if (circuitBroken || !isHealthy) {
      console.error('\n🚫 LLM inference is currently unavailable. Synthesis disabled.');
      return;
    }

    if (strict) {
      const maxSimilarity = Math.max(...chunks.map(m => m.similarity));
      if (maxSimilarity < 0.25) {
        console.log('\n🔒 [--strict] Best match similarity is ' + (maxSimilarity * 100).toFixed(1) + '% — below the 25% confident-context threshold.');
        console.log("I don't have enough information in your notes to answer this.");
        return;
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

#!/usr/bin/env node

/**
 * Open Brain Relational Reasoning / Multi-Hop Search CLI
 *
 * Runs parallel semantic searches for two distinct concepts, links their
 * shared context, and has the local Chat LLM analyze and synthesize the
 * relationship — solving the "disconnected dots" problem in plain RAG.
 *
 * Usage:
 *   node bin/find-relations.js "<concept A>" "<concept B>"
 *
 * Example:
 *   node bin/find-relations.js "masters" "blog"
 */

import { assembleContext, env } from '../../lib/context-assembler.js';

const { LOCAL_LLM_BASE_URL, LOCAL_CHAT_MODEL } = env;

const conceptA = process.argv[2];
const conceptB = process.argv[3];

if (!conceptA || !conceptB) {
  console.log('🤖 Open Brain Relational Reasoning CLI');
  console.log('═'.repeat(40));
  console.log('Usage:');
  console.log('  node bin/find-relations.js "<concept A>" "<concept B>"');
  console.log('');
  console.log('Example:');
  console.log('  node bin/find-relations.js "masters" "blog"');
  process.exit(0);
}

export async function runRelationFinder(conceptA, conceptB) {
  console.log(`\n🕸️  Open Brain Multi-Hop Relation Finder`);
  console.log('═'.repeat(60));
  console.log(`Concept A: "${conceptA}"`);
  console.log(`Concept B: "${conceptB}"`);
  console.log('═'.repeat(60));

  console.log('   🔍 Running parallel semantic searches...');

  let chunksA, chunksB, contextA, contextB;
  try {
    ([
      { chunks: chunksA, assembledContext: contextA },
      { chunks: chunksB, assembledContext: contextB },
    ] = await Promise.all([
      assembleContext({ query: conceptA, topK: 6, minSimilarity: 0.25 }),
      assembleContext({ query: conceptB, topK: 6, minSimilarity: 0.25 }),
    ]));
  } catch (err) {
    console.error(`❌ Context assembly failed: ${err.message}`);
    return;
  }

  console.log(`   ✓ Retrieved ${chunksA.length} notes for "${conceptA}"`);
  console.log(`   ✓ Retrieved ${chunksB.length} notes for "${conceptB}"`);

  if (chunksA.length === 0 && chunksB.length === 0) {
    console.log('   ❌ No notes found for either concept. Cannot analyze relations.');
    return;
  }

  const overlapTitles = [];
  const bIds = new Set(chunksB.map(t => t.id));
  for (const t of chunksA) {
    if (bIds.has(t.id)) overlapTitles.push(t.metadata?.title || 'Untitled');
  }

  if (overlapTitles.length > 0) {
    console.log('   💡 Found direct overlap! These notes contain BOTH concepts:');
    overlapTitles.forEach(title => console.log(`      - ${title}`));
  }

  const synthesis = await analyzeRelation(conceptA, conceptB, contextA, contextB);

  console.log('\n' + '═'.repeat(60));
  console.log(`🤖 RELATIONAL ANALYSIS: "${conceptA}" & "${conceptB}"`);
  console.log('═'.repeat(60));
  console.log(synthesis);
  console.log('═'.repeat(60) + '\n');
}

async function analyzeRelation(conceptA, conceptB, contextA, contextB) {
  if (!LOCAL_LLM_BASE_URL || !LOCAL_CHAT_MODEL) {
    return '⚠️ LOCAL_LLM_BASE_URL and LOCAL_CHAT_MODEL must be set in .env for relational analysis.';
  }
  try {
    const url = `${LOCAL_LLM_BASE_URL.replace(/\/+$/, '')}/chat/completions`;
    const headers = { 'Content-Type': 'application/json' };
    if (env.LOCAL_LLM_API) headers['Authorization'] = `Bearer ${env.LOCAL_LLM_API}`;

    const body = {
      model: LOCAL_CHAT_MODEL,
      messages: [
        {
          role: 'system',
          content:
            'You are a personal knowledge assistant.\n' +
            'Analyze the relationship between two concepts using ONLY the context passages provided.\n' +
            'Cite source note titles in [brackets]. Never invent connections not present in the notes.',
        },
        {
          role: 'user',
          content:
`Concept A: "${conceptA}"
Concept B: "${conceptB}"

RELEVANT NOTES FOR "${conceptA.toUpperCase()}":
${contextA}

RELEVANT NOTES FOR "${conceptB.toUpperCase()}":
${contextB}

Directions:
1. Explain the connection or relationship between "${conceptA}" and "${conceptB}" based ONLY on the notes above.
2. Cite specific source notes by title in [brackets] to support your points.
3. If no direct connection exists in the notes, explain how they relate conceptually from what is present.
4. Keep the answer structured, clear, and grounded in the provided context.`,
        },
      ],
      temperature: 0.3,
    };

    console.log(`🧠 Synthesizing relationship via local LLM (${LOCAL_CHAT_MODEL})...\n`);

    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.choices[0].message.content;
  } catch (err) {
    return `⚠️ Relational analysis failed: ${err.message}`;
  }
}

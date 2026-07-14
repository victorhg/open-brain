#!/usr/bin/env node

/**
 * Open Brain Relational Reasoning / Multi-Hop Search CLI
 * 
 * Solves the "disconnected dots" problem in simple RAG by running parallel 
 * semantic searches for two distinct concepts, linking their shared context,
 * and having your local Chat LLM analyze and synthesize the relationship.
 * 
 * Usage:
 *   node bin/find-relations.js "masters" "blog"
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

const env = { ...fileEnv, ...process.env };

const { 
  SUPABASE_URL, 
  SUPABASE_SERVICE_ROLE_KEY, 
  LOCAL_LLM_BASE_URL,
  LOCAL_CHAT_MODEL
} = env;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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

// Generate Embedding via Local LLM
async function generateEmbedding(text) {
  if (!LOCAL_LLM_BASE_URL || !env.LOCAL_EMBEDDING_MODEL) {
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
      body: JSON.stringify({ model: env.LOCAL_EMBEDDING_MODEL, input: text }),
    });
    if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
    const data = await res.json();
    return data.data[0].embedding;
  } catch (err) {
    console.error(`❌ Failed to generate embedding: ${err.message}`);
    return null;
  }
}

// Perform Semantic Search for a single concept
async function searchConcept(concept, limit = 6) {
  const embedding = await generateEmbedding(concept);
  if (!embedding) return [];

  const { data, error } = await supabase.rpc('match_thoughts', {
    query_embedding: embedding,
    match_threshold: 0.25, // Lower threshold slightly for better multi-hop capture
    match_count: limit
  });

  if (error) {
    console.error(`❌ Search failed for '${concept}': ${error.message}`);
    return [];
  }
  return data || [];
}

// Ask Local LLM to analyze the relations
async function analyzeRelation(conceptA, conceptB, resultsA, resultsB) {
  if (!LOCAL_LLM_BASE_URL || !LOCAL_CHAT_MODEL) {
    return '⚠️ LOCAL_LLM_BASE_URL and LOCAL_CHAT_MODEL must be set in .env for relational analysis.';
  }
  try {
    const url = `${LOCAL_LLM_BASE_URL.replace(/\/+$/, '')}/chat/completions`;
    const headers = { 'Content-Type': 'application/json' };
    if (env.LOCAL_LLM_API) headers['Authorization'] = `Bearer ${env.LOCAL_LLM_API}`;

    const formatSource = (list) => list.map(t => `[Source Note: ${t.metadata?.title || 'Atomic note'}]\n${t.content}`).join('\n\n');

    const prompt = `You are Open Brain, a highly advanced personal reasoning engine.
Your task is to analyze the relationship, intersections, and connections between two concepts from the user's life and personal thoughts:
Concept A: "${conceptA}"
Concept B: "${conceptB}"

Below are the most relevant thoughts retrieved from their personal Obsidian vault for each concept.
Read them carefully, "connect the dots", and synthesize a brilliant, relational explanation of how these two aspects of their life intersect, influence each other, or are connected.

RELEVANT THOUGHTS FOR "${conceptA.toUpperCase()}":
${formatSource(resultsA)}

RELEVANT THOUGHTS FOR "${conceptB.toUpperCase()}":
${formatSource(resultsB)}

DIRECTIONS:
1. Explain the clear connection or relationship between "${conceptA}" and "${conceptB}" based ONLY on their notes.
2. Cite the specific source notes (using their titles) to support your points.
3. If no direct connection is written on paper, explain how they relate conceptually based on the notes present.
4. Keep the answer structured, clear, and highly personalized.`;

    const body = {
      model: LOCAL_CHAT_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
    };

    console.log(`🧠 Synthesizing relationship via Local Chat LLM (${LOCAL_CHAT_MODEL})...\n`);

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.choices[0].message.content;
  } catch (err) {
    return `⚠️ Relational analysis failed: ${err.message}`;
  }
}

async function main() {
  console.log(`\n🕸️  Open Brain Multi-Hop Relation Finder`);
  console.log(`═`.repeat(60));
  console.log(`Concept A: "${conceptA}"`);
  console.log(`Concept B: "${conceptB}"`);
  console.log(`═`.repeat(60));

  console.log('   🔍 Running parallel semantic searches...');
  const [resultsA, resultsB] = await Promise.all([
    searchConcept(conceptA),
    searchConcept(conceptB)
  ]);

  console.log(`   ✓ Retrieved ${resultsA.length} notes for "${conceptA}"`);
  console.log(`   ✓ Retrieved ${resultsB.length} notes for "${conceptB}"`);

  if (resultsA.length === 0 && resultsB.length === 0) {
    console.log('   ❌ No notes found for either concept. Cannot analyze relations.');
    process.exit(1);
  }

  // Find direct overlaps (if any note appears in both searches)
  const overlapTitles = [];
  const bIds = new Set(resultsB.map(t => t.id));
  
  for (const t of resultsA) {
    if (bIds.has(t.id)) {
      overlapTitles.push(t.metadata?.title || 'Untitled');
    }
  }

  if (overlapTitles.length > 0) {
    console.log(`   💡 Found direct overlap! These notes contain BOTH concepts:`);
    overlapTitles.forEach(title => console.log(`      - ${title}`));
  }

  // Synthesize answer
  const synthesis = await analyzeRelation(conceptA, conceptB, resultsA, resultsB);

  console.log('\n' + '═'.repeat(60));
  console.log(`🤖 RELATIONAL ANALYSIS: "${conceptA}" & "${conceptB}"`);
  console.log('═'.repeat(60));
  console.log(synthesis);
  console.log('═'.repeat(60) + '\n');
}

main().catch(err => {
  console.error('Fatal relational search error:', err);
  process.exit(1);
});

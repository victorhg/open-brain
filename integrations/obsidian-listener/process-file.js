#!/usr/bin/env node

/**
 * Obsidian Live Sync Event Processor
 * 
 * This script processes a single Markdown file from your Obsidian vault when it is created or updated.
 * It is designed to be triggered by file-system events or directly by Obsidian's "Shell Commands" plugin.
 * 
 * Features:
 * 1. Metadata & Frontmatter Parsing: Extracts title, tags, folders, and wikilinks.
 * 2. Duplicate Prevention: Normalizes text and computes SHA-256 fingerprints.
 * 3. Atomic Chunking: Splits large notes at heading (##) boundaries to create clean thoughts.
 * 4. Provenance Chain Building: Translates [[wikilinks]] to UUID-based derivation chains.
 * 5. Panning for Gold: Automatically detects '#brain-dump' or '#transcript' and triggers thread analysis.
 * 6. Embedding Generation: Calls the local LLM embedding endpoint (LOCAL_LLM_BASE_URL).
 *    Dimension validation is driven by EMBEDDING_DIMENSIONS from .env — no hardcoded values,
 *    no silent fallback to OpenRouter. Mismatch = loud error.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, basename, extname } from 'path';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from project root
const envPath = join(__dirname, '../../.env');
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

// Allow process.env to override .env file variables
const env = { ...fileEnv, ...process.env };

const { 
  SUPABASE_URL, 
  SUPABASE_SERVICE_ROLE_KEY, 
  OPENROUTER_API_KEY,
  LOCAL_LLM_BASE_URL,
  LOCAL_EMBEDDING_MODEL,
  LOCAL_CHAT_MODEL,
  LOCAL_LLM_API,
  EMBEDDING_DIMENSIONS
} = env;

// Canonical embedding dimension — must match the pgvector index on the thoughts table.
// Driven by EMBEDDING_DIMENSIONS in .env (e.g. 2560 for Qwen3-Embedding-4B).
// Set the same value in your Supabase schema and never mix models.
const DB_DIMENSIONS = parseInt(EMBEDDING_DIMENSIONS || '2560', 10);

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Error: Missing required Supabase credentials in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// --- Helpers ---

// Generate SHA256 Fingerprint of normalized text
function computeFingerprint(text) {
  const normalized = text.toLowerCase().trim().replace(/\s+/g, ' ');
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

// Generate Embedding via Local LLM or OpenRouter with Automatic Dimension Guard
async function generateEmbedding(text) {
  try {
    const isLocal = !!LOCAL_LLM_BASE_URL && !!LOCAL_EMBEDDING_MODEL;
    let url = isLocal 
      ? `${LOCAL_LLM_BASE_URL.replace(/\/+$/, '')}/embeddings` 
      : 'https://openrouter.ai/api/v1/embeddings';
    
    const headers = { 'Content-Type': 'application/json' };
    if (isLocal) {
      if (LOCAL_LLM_API) headers['Authorization'] = `Bearer ${LOCAL_LLM_API}`;
    } else {
      headers['Authorization'] = `Bearer ${OPENROUTER_API_KEY}`;
    }

    const modelName = isLocal ? LOCAL_EMBEDDING_MODEL : 'openai/text-embedding-3-small';
    const body = {
      model: modelName,
      input: text
    };

    console.log(`      [EMBEDDING] Generating via ${isLocal ? 'Local LLM (' + modelName + ')' : 'OpenRouter'} — expecting ${DB_DIMENSIONS} dims`);

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`HTTP Error ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();
    const embedding = data.data[0].embedding;

    // --- Dimension Guard (fail loudly — no silent cloud fallback) ---
    if (embedding.length !== DB_DIMENSIONS) {
      throw new Error(
        `Dimension mismatch: model '${modelName}' returned ${embedding.length} dims, ` +
        `but EMBEDDING_DIMENSIONS=${DB_DIMENSIONS}. ` +
        `Update EMBEDDING_DIMENSIONS in .env or switch LOCAL_EMBEDDING_MODEL to a compatible model.`
      );
    }

    return embedding;
  } catch (err) {
    console.error(`  ⚠️ Failed to generate embedding: ${err.message}`);
    return null;
  }
}

// Extract LLM Metadata from thought chunk via Local LLM or OpenRouter
async function extractMetadata(text) {
  try {
    const isLocal = !!LOCAL_LLM_BASE_URL && !!LOCAL_CHAT_MODEL;
    const url = isLocal 
      ? `${LOCAL_LLM_BASE_URL.replace(/\/+$/, '')}/chat/completions` 
      : 'https://openrouter.ai/api/v1/chat/completions';
    
    const headers = { 'Content-Type': 'application/json' };
    if (isLocal) {
      if (LOCAL_LLM_API) headers['Authorization'] = `Bearer ${LOCAL_LLM_API}`;
    } else {
      headers['Authorization'] = `Bearer ${OPENROUTER_API_KEY}`;
    }

    const body = {
      model: isLocal ? LOCAL_CHAT_MODEL : 'openai/gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You extract metadata from thoughts. Return ONLY valid JSON, no markdown formatting or backticks.
{
  "type": "decision" | "person_note" | "insight" | "meeting_note" | "idea" | "task" | "reference" | "journal",
  "category": "career" | "product" | "health" | "finance" | "relationships" | "general",
  "people": ["Name1", "Name2"],
  "topics": ["topic1", "topic2"],
  "importance": 1 to 5 (integer, default 3)
}`
        },
        { role: 'user', content: text }
      ],
      temperature: 0,
    };

    console.log(`      [METADATA] Analyzing via ${isLocal ? 'Local LLM (' + LOCAL_CHAT_MODEL + ')' : 'OpenRouter'}`);

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    
    if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
    const data = await res.json();
    const raw = data.choices[0].message.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`      ⚠️ Metadata analysis failed (${err.message}). Using fallback schema.`);
    return { type: 'journal', category: 'general', people: [], topics: [], importance: 3 };
  }
}

// Parse Obsidian file content (splits frontmatter, tags, links)
function parseObsidianFile(filePath) {
  const fileContent = readFileSync(filePath, 'utf-8');
  const title = basename(filePath, '.md');
  
  let content = fileContent;
  let frontmatter = {};
  
  // 1. Parse YAML Frontmatter
  const frontmatterMatch = fileContent.match(/^---\n([\s\S]*?)\n---\n/);
  if (frontmatterMatch) {
    const yaml = frontmatterMatch[1];
    content = fileContent.substring(frontmatterMatch[0].length);
    yaml.split('\n').forEach(line => {
      const parts = line.split(':');
      if (parts.length >= 2) {
        const key = parts[0].trim();
        const value = parts.slice(1).join(':').trim();
        // Parse simple string or list arrays
        if (value.startsWith('[') && value.endsWith(']')) {
          frontmatter[key] = value.slice(1, -1).split(',').map(v => v.trim().replace(/^['"]|['"]$/g, ''));
        } else {
          frontmatter[key] = value.replace(/^['"]|['"]$/g, '');
        }
      }
    });
  }

  // 2. Extract inline #tags
  const tagRegex = /#([a-zA-Z0-9_\-\/]+)/g;
  const inlineTags = [];
  let tagMatch;
  while ((tagMatch = tagRegex.exec(content)) !== null) {
    if (!inlineTags.includes(tagMatch[1])) {
      inlineTags.push(tagMatch[1]);
    }
  }

  // 3. Extract [[wikilinks]]
  const linkRegex = /\[\[(.*?)\]\]/g;
  const wikilinks = [];
  let linkMatch;
  while ((linkMatch = linkRegex.exec(content)) !== null) {
    const linkText = linkMatch[1].split('|')[0].trim();
    if (!wikilinks.includes(linkText)) {
      wikilinks.push(linkText);
    }
  }

  // Consolidate tags
  const tags = Array.from(new Set([
    ...(frontmatter.tags || []),
    ...(frontmatter.keywords || []),
    ...inlineTags
  ]));

  return { title, content, frontmatter, tags, wikilinks };
}

// Chunk note by H2 boundaries
function chunkNote(title, content) {
  const sections = content.split(/\n## /);
  const chunks = [];

  // First section (before any ## heading)
  let intro = sections[0].trim();
  if (intro && intro.split(/\s+/).length >= 10) {
    chunks.push({
      header: title,
      body: intro
    });
  }

  // Heading-split sections
  for (let i = 1; i < sections.length; i++) {
    const lines = sections[i].split('\n');
    const header = lines[0].trim();
    const body = lines.slice(1).join('\n').trim();
    
    if (body && body.split(/\s+/).length >= 10) {
      chunks.push({
        header: `${title} > ${header}`,
        body: `## ${header}\n\n${body}`
      });
    }
  }

  // If no chunks generated (e.g. short note), use whole body
  if (chunks.length === 0 && content.trim()) {
    chunks.push({
      header: title,
      body: content.trim()
    });
  }

  return chunks;
}

// --- Main Ingest Flow ---

async function processFile(filePath) {
  if (extname(filePath) !== '.md') {
    console.log(`⏩ Skipping non-markdown file: ${filePath}`);
    return;
  }

  console.log(`\n📂 Processing: ${basename(filePath)}`);
  
  const fileData = parseObsidianFile(filePath);
  const { title, content, tags, wikilinks } = fileData;
  
  // 1. ROUTING: Check for Panning-for-Gold triggers
  const isBrainDump = tags.includes('brain-dump') || tags.includes('transcript') || tags.includes('gold-panning') || filePath.includes('Brain Dumps') || filePath.includes('Transcripts');
  
  if (isBrainDump) {
    console.log('✨ [ROUTING] Detected Brain Dump or Transcript tag/location. Running Gold Panning flow...');
    await runGoldPanningFlow(fileData, filePath);
    return;
  }

  // 2. ROUTING: Standard Thoughts Processing
  console.log(`📦 [ROUTING] Standard note. Splitting content into atomic thought chunks...`);
  const chunks = chunkNote(title, content);
  console.log(`   Found ${chunks.length} atomic sections`);

  // Try to find the Supabase thought IDs of referenced wikilinks to build Provenance Chains
  let parentIds = [];
  if (wikilinks.length > 0) {
    console.log(`🔗 Looking up UUIDs for referenced wikilinks: ${wikilinks.join(', ')}`);
    const { data: parents, error: parentErr } = await supabase
      .from('thoughts')
      .select('id, metadata->>title')
      .in('metadata->>title', wikilinks);
      
    if (!parentErr && parents) {
      parentIds = parents.map(p => p.id);
      console.log(`   Linked to ${parentIds.length} existing thoughts in Open Brain!`);
    }
  }

  for (const chunk of chunks) {
    const fullContent = `[Obsidian: ${chunk.header}]\n\n${chunk.body}`;
    const fingerprint = computeFingerprint(fullContent);
    
    console.log(`   ⚡ Processing chunk: "${chunk.header}"`);
    console.log(`      Content Fingerprint: ${fingerprint}`);

    // Call OpenAI/OpenRouter to get embedding
    const embedding = await generateEmbedding(fullContent);
    if (!embedding) continue;

    // Call LLM for smart metadata tags
    const llmMeta = await extractMetadata(chunk.body);
    
    // Merge Obsidian metadata with LLM tags
    const mergedMetadata = {
      source: 'obsidian',
      title: title,
      header: chunk.header,
      tags: tags,
      wikilinks: wikilinks,
      topics: llmMeta.topics,
      people: llmMeta.people,
      type: llmMeta.type,
      category: llmMeta.category
    };

    // Insert or Conflict-Update (Deduplicate)
    const payload = {
      metadata: mergedMetadata,
      status: (llmMeta.type === 'task' || llmMeta.type === 'idea') ? 'new' : null
    };

    const { data: result, error: rpcErr } = await supabase.rpc('upsert_thought', {
      p_content: fullContent,
      p_payload: payload
    });

    if (rpcErr) {
      console.error(`      ❌ Error upserting thought: ${rpcErr.message}`);
      continue;
    }

    // Inject embedding directly (upsert_thought handles fingerprinting, but not embedding vector directly in conflict updates)
    const { error: updateErr } = await supabase
      .from('thoughts')
      .update({ embedding })
      .eq('id', thoughtId);

    if (updateErr) {
      console.warn(`      ⚠️ Failed to save embedding vector: ${updateErr.message}`);
    } else {
      console.log(`      ✅ Thought Upserted (UUID: ${thoughtId})`);
    }

    // Build Provenance Chains / Derivation Chains if we found wikilink parent IDs!
    if (parentIds.length > 0) {
      console.log(`      🔗 Writing provenance chain connections to metadata...`);
      await supabase
        .from('thoughts')
        .update({
          derived_from: parentIds,
          derivation_layer: 'derived',
          derivation_method: 'synthesis'
        })
        .eq('id', thoughtId);
    }
  }

  console.log(`✅ Note sync complete!`);
}

// --- GOLD PANNING FLOW ---

async function runGoldPanningFlow(fileData, filePath) {
  const { title, content, tags } = fileData;
  console.log(`🥞 Starting PAN FOR GOLD process on: "${title}"`);
  
  // Set up prompt for deep thread extraction
  console.log('   🧠 Step 1: Running Phase 1 (Extracting idea threads)...');
  
  try {
    const isLocal = !!LOCAL_LLM_BASE_URL && !!LOCAL_CHAT_MODEL;
    const url = isLocal 
      ? `${LOCAL_LLM_BASE_URL.replace(/\/+$/, '')}/chat/completions` 
      : 'https://openrouter.ai/api/v1/chat/completions';
    
    const headers = { 'Content-Type': 'application/json' };
    if (isLocal) {
      if (LOCAL_LLM_API) headers['Authorization'] = `Bearer ${LOCAL_LLM_API}`;
    } else {
      headers['Authorization'] = `Bearer ${OPENROUTER_API_KEY}`;
    }

    const body = {
      model: isLocal ? LOCAL_CHAT_MODEL : 'openai/gpt-4o',
      messages: [
        {
          role: 'system',
          content: `You are the Open Brain Panning Engine. Your job is to read raw voice transcripts, meeting notes, or stream-of-consciousness brain dumps, and extract every single high-signal idea, action item, observation, lesson, or decision thread.
For each thread found, return a JSON object inside an array:
{
  "idea": "A clear, concise, self-contained summary of the idea thread",
  "quote": "The exact sentence or context from the raw note supporting this thread",
  "category": "personal" | "professional" | "technical" | "relationships" | "wellness" | "finance",
  "type": "idea" | "task" | "lesson" | "decision" | "reference"
}
Return ONLY a valid JSON array, no markdown or wrapper code.`
        },
        { role: 'user', content: content }
      ],
      temperature: 0.1,
    };

    console.log(`      [PANNING] Processing via ${isLocal ? 'Local Chat LLM (' + LOCAL_CHAT_MODEL + ')' : 'OpenRouter'}`);

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
    const data = await res.json();
    const raw = data.choices[0].message.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const threads = JSON.parse(raw);
    
    console.log(`   🎉 Success! Extracted ${threads.length} high-signal threads.`);
    
    // Create first-class primary thoughts for each extracted thread
    const parentId = computeFingerprint(content);
    
    // Save original brain dump first so we can reference it
    const originalEmbedding = await generateEmbedding(content);
    
    const { data: origResult, error: origErr } = await supabase.rpc('upsert_thought', {
      p_content: `[Obsidian: Original Brain Dump] ${title}\n\n${content}`,
      p_payload: {
        metadata: {
          source: 'obsidian',
          title: title,
          tags: [...tags, 'panned-source'],
          type: 'reference',
          category: 'general'
        }
      }
    });

    if (origErr) {
      console.error(`   ❌ Failed to save raw source note: ${origErr.message}`);
      return;
    }
    
    const rawSourceId = origResult.id;
    if (originalEmbedding) {
      await supabase.from('thoughts').update({ embedding: originalEmbedding }).eq('id', rawSourceId);
    }
    
    console.log(`   ✓ Raw source saved as Thought ${rawSourceId}`);
    
    // Capture each thread with rich metadata and link to rawSourceId as its provenance parent!
    console.log('   💾 Step 2: Capturing threads to Open Brain with Provenance Chains...');
    
    for (const thread of threads) {
      const threadContent = `[Panned Thread] ${thread.idea}\n\nEvidence: "${thread.quote}"\n\nSource: [[${title}]]`;
      const threadEmbedding = await generateEmbedding(threadContent);
      if (!threadEmbedding) continue;
      
      const payload = {
        metadata: {
          source: 'panning-engine',
          origin_source: title,
          evidence_quote: thread.quote,
          type: thread.type,
          category: thread.category,
          topics: [thread.category]
        },
        status: (thread.type === 'idea' || thread.type === 'task') ? 'new' : null
      };

      const { data: threadRes, error: threadErr } = await supabase.rpc('upsert_thought', {
        p_content: threadContent,
        p_payload: payload
      });

      if (!threadErr && threadRes) {
        // Link embedding and provenance chains
        const { error: updateErr } = await supabase.from('thoughts').update({
          embedding: threadEmbedding,
          derived_from: [rawSourceId],
          derivation_layer: 'derived',
          derivation_method: 'synthesis'
        }).eq('id', threadRes.id);
        
        if (updateErr) {
          console.warn(`     ⚠️ Failed to save thread embedding: ${updateErr.message}`);
        } else {
          console.log(`     ✅ Captured thread: "${thread.idea.substring(0, 40)}..."`);
        }
      }
    }
    
    console.log(`🥞 Gold panning complete! All threads extracted, panned, and linked!`);
  } catch (err) {
    console.error(`   ❌ Gold panning process failed: ${err.message}`);
  }
}

// --- Runner ---
const args = process.argv.slice(2);
if (args.length === 0) {
  console.log('❌ Error: Please specify the absolute file path of the Obsidian note.');
  console.log('   Usage: node process-file.js "/path/to/vault/Note.md"');
  process.exit(1);
}

processFile(args[0]).catch(err => {
  console.error('Fatal error in process:', err);
  process.exit(1);
});

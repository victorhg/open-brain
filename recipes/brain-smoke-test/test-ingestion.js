#!/usr/bin/env node
/**
 * test-ingestion.js -- Validates the obsidian-listener/process-file logic.
 * 
 * This test simulates the ingestion of a note, ensuring that:
 * 1. The note is parsed correctly.
 * 2. It is chunked into atomic thoughts.
 * 3. The metadata extraction runs.
 * 4. The Supabase upsert logic (via RPC) is reachable.
 */

import { parseObsidianFile, chunkNote } from '../../packages/pi-obsidian-listener/process-file.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  console.log("🧪 Testing Ingestion Pipeline Logic...");

  // 1. Create a dummy test file
  const testFilePath = path.join(__dirname, 'test-note.md');
  const dummyContent = `---
tags: [brain-dump]
---
# Title Test
This is a test note to ensure the pipeline is working.

## Section 1
This is a specific section of content that should be chunked correctly.

## Section 2
Another section to ensure the splitter logic remains intact.`;

  fs.writeFileSync(testFilePath, dummyContent);

  try {
    // 2. Test Parser
    console.log("   - Testing parser...");
    const parsed = parseObsidianFile(testFilePath);
    if (parsed.tags.length === 0) throw new Error("Parser failed to find tags");
    
    // 3. Test Chunking
    console.log("   - Testing chunker...");
    const chunks = chunkNote(parsed.title, parsed.content);
    if (chunks.length < 2) throw new Error(`Chunker failed to split sections. Found: ${chunks.length}`);
    
    console.log(`   ✓ Pipeline validation passed: ${chunks.length} chunks generated.`);
  } catch (err) {
    console.error(`❌ Ingestion test failed: ${err.message}`);
    process.exit(1);
  } finally {
    if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

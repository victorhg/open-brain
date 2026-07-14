#!/usr/bin/env node

/**
 * Historical Obsidian Provenance Backfill
 * 
 * This script stitches your 3,911 already-imported thoughts into a highly connected
 * graph using database-level Provenance Chains.
 * 
 * How it works:
 * 1. Fetches all thoughts in the database.
 * 2. Maps every thought's metadata.title to its database UUID.
 * 3. Scans each thought's metadata.wikilinks list and matches linked titles to UUIDs.
 * 4. Atomically updates the 'derived_from' column with the found parent UUID arrays,
 *    marking the thought as 'derived' via 'synthesis'.
 * 
 * Cost: ZERO. Running entirely as local memory mapping + database updates.
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
const env = Object.fromEntries(
  envContent.split('\n')
    .filter(line => line && !line.startsWith('#'))
    .map(line => {
      const [key, ...valueParts] = line.split('=');
      return [key.trim(), valueParts.join('=').trim()];
    })
);

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Error: Missing required environment keys in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function backfill() {
  console.log('🕸️  Starting Obsidian Provenance Backfill...');
  console.log('═'.repeat(60));

  // 1. Fetch all thoughts with title metadata (paginated to bypass PostgREST limit of 1000)
  console.log('   📥 Fetching all thoughts from database (paginated)...');
  let thoughts = [];
  let start = 0;
  const limit = 1000;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from('thoughts')
      .select('id, metadata')
      .range(start, start + limit - 1);

    if (error) {
      console.error(`   ❌ Failed to fetch thoughts at range ${start}-${start + limit - 1}: ${error.message}`);
      process.exit(1);
    }

    thoughts = thoughts.concat(data);
    start += limit;
    if (data.length < limit) {
      hasMore = false;
    }
  }

  console.log(`   ✓ Retrieved ${thoughts.length} thoughts.`);

  // 2. Build Title -> UUID lookup map
  console.log('   🗺️  Mapping thought titles to database UUIDs...');
  const titleToIdMap = new Map();
  
  for (const t of thoughts) {
    const title = t.metadata?.title;
    if (title) {
      // Normalize to handle casing differences gracefully
      const normTitle = title.trim().toLowerCase();
      titleToIdMap.set(normTitle, t.id);
    }
  }

  console.log(`   ✓ Mapped ${titleToIdMap.size} unique note titles.`);

  // 3. Scan and find parent UUIDs for each thought's wikilinks
  console.log('   🔗 Linking wikilinks to provenance arrays...');
  let updateCount = 0;
  let linkedWikilinksCount = 0;

  const updates = [];

  for (const t of thoughts) {
    const wikilinks = t.metadata?.wikilinks;
    if (!wikilinks || !Array.isArray(wikilinks) || wikilinks.length === 0) {
      continue;
    }

    const parentIds = [];
    for (const link of wikilinks) {
      if (typeof link !== 'string') continue;
      const normLink = link.trim().toLowerCase();
      const parentId = titleToIdMap.get(normLink);
      
      if (parentId && parentId !== t.id) {
        parentIds.push(parentId);
        linkedWikilinksCount++;
      }
    }

    if (parentIds.length > 0) {
      updates.push({
        id: t.id,
        derived_from: parentIds,
        derivation_layer: 'derived',
        derivation_method: 'synthesis'
      });
    }
  }

  console.log(`   ✓ Found ${updates.length} thoughts containing ${linkedWikilinksCount} total valid links.`);

  if (updates.length === 0) {
    console.log('   ℹ️  No links need to be backfilled. Your database is already connected!');
    process.exit(0);
  }

  // 4. Batch update database
  console.log(`   💾 Writing provenance relationships to Supabase in batches...`);
  const batchSize = 100;
  
  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = updates.slice(i, i + batchSize);
    
    // Execute updates in parallel for each batch
    await Promise.all(
      batch.map(async (u) => {
        const { error } = await supabase
          .from('thoughts')
          .update({
            derived_from: u.derived_from,
            derivation_layer: u.derivation_layer,
            derivation_method: u.derivation_method
          })
          .eq('id', u.id);

        if (error) {
          console.error(`      ⚠️ Failed to update thought ${u.id}: ${error.message}`);
        } else {
          updateCount++;
        }
      })
    );
    
    console.log(`      Progress: ${Math.min(i + batchSize, updates.length)}/${updates.length} thoughts processed...`);
  }

  console.log('═'.repeat(60));
  console.log(`🎉 SUCCESS: Finished Provenance Backfill!`);
  console.log(`   Linked ${updateCount} thoughts together with first-class parent derivations.`);
  console.log(`   Your Obsidian vault is now a fully interconnected knowledge graph in Open Brain!`);
  console.log('═'.repeat(60));
}

backfill().catch(err => {
  console.error('Fatal error during backfill:', err);
  process.exit(1);
});

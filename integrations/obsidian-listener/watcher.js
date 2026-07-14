#!/usr/bin/env node

/**
 * Obsidian Directory Watcher Daemon
 * 
 * Watches an Obsidian vault directory for file changes and triggers
 * the Open Brain process-file pipeline automatically in the background.
 * 
 * Usage:
 *   node watcher.js "/path/to/my/obsidian-vault"
 * 
 * Dependencies:
 *   npm install chokidar
 */

import chokidar from 'chokidar';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const vaultPath = process.argv[2];

if (!vaultPath) {
  console.error('❌ Error: Please specify the absolute path to your Obsidian vault.');
  console.error('   Usage: node watcher.js "/Users/name/Library/Mobile Documents/iCloud~md~obsidian/Documents/Personal"');
  process.exit(1);
}

const resolvedVaultPath = resolve(vaultPath);

if (!existsSync(resolvedVaultPath)) {
  console.error(`❌ Error: Specified vault path does not exist: ${resolvedVaultPath}`);
  process.exit(1);
}

console.log('═'.repeat(60));
console.log('👀 OPEN BRAIN - OBSIDIAN LIVE VAULT WATCHER');
console.log('═'.repeat(60));
console.log(`Vault Folder: ${resolvedVaultPath}`);
console.log('Status: Watching for file additions and modifications...');
console.log('Press Ctrl+C to terminate the daemon.');
console.log('═'.repeat(60));

// Ignore hidden folders, templates, trash, and attachments
const ignoredPatterns = [
  /(^|[\/\\])\../,            // Hidden files/directories (.obsidian, .git)
  /[\/\\]templates[\/\\]/i,   // Templates folder
  /[\/\\]\.trash[\/\\]/i,     // Trash folder
  /\.(png|jpg|jpeg|gif|pdf|zip|mp3|m4a|wav)$/i // Attachments
];

const watcher = chokidar.watch(resolvedVaultPath, {
  ignored: ignoredPatterns,
  persistent: true,
  ignoreInitial: true, // Only watch for NEW changes while running, don't re-ingest vault on start
  awaitWriteFinish: {
    stabilityThreshold: 1500, // Wait for file to stop writing for 1.5 seconds before processing
    pollInterval: 100
  }
});

const scriptPath = join(__dirname, 'process-file.js');

function syncFile(filePath) {
  console.log(`\n🔔 Change detected in: ${filePath}`);
  
  const cmd = `node "${scriptPath}" "${filePath}"`;
  exec(cmd, (error, stdout, stderr) => {
    if (error) {
      console.error(`❌ Error executing process-file: ${error.message}`);
      return;
    }
    if (stderr) {
      console.error(`⚠️ process stderr: ${stderr}`);
    }
    if (stdout) {
      console.log(stdout.trim());
    }
  });
}

watcher
  .on('add', filePath => syncFile(filePath))
  .on('change', filePath => syncFile(filePath))
  .on('error', error => console.error(`Watcher Error: ${error.message}`));

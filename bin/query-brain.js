#!/usr/bin/env node
// Shim for recipes/query-brain
import { spawn } from 'child_process';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const recipe = join(__dirname, '../recipes/query-brain/index.js');

spawn('node', [recipe, ...process.argv.slice(2)], { stdio: 'inherit' });

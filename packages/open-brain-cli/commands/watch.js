import { Command } from 'commander';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default new Command('watch')
  .description('Start the Obsidian vault watcher daemon')
  .requiredOption('--vault <path>', 'Absolute path to your Obsidian vault')
  .action((options) => {
    const watcherScript = path.join(__dirname, '../../obsidian-listener/watcher.js');
    
    spawn('node', [watcherScript, options.vault], {
      stdio: 'inherit',
      env: { ...process.env },
    });
  });

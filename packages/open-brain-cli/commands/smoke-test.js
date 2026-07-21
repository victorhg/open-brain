import { Command } from 'commander';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default new Command('smoke-test')
  .description('Run connectivity smoke test for pi-open-brain')
  .option('--write', 'Include write tests (capture_thought)', false)
  .action((options) => {
    const smokeScript = path.join(__dirname, '../../pi-open-brain/test/smoke.js');
    const args = [];
    if (options.write) args.push('--write');

    const child = spawn('node', [smokeScript, ...args], {
      stdio: 'inherit',
      env: { ...process.env },
    });

    child.on('exit', (code) => {
      process.exit(code || 0);
    });
  });

#!/usr/bin/env node
import { Command } from 'commander';
import queryCmd from '../commands/query.js';
import relationsCmd from '../commands/find-relations.js';
import smokeCmd from '../commands/smoke-test.js';

const program = new Command();

program
  .name('brain')
  .description('OB1 Open Brain Orchestrator')
  .version('1.0.0');

program.addCommand(queryCmd);
program.addCommand(relationsCmd);
program.addCommand(wikiCmd);
program.addCommand(smokeCmd);

program.parse();

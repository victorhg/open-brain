import { Command } from 'commander';
import { runRelationFinder } from '../../recipes/find-relations/index.js';

const cmd = new Command('find-relations');

cmd
  .description('Find and synthesize relationships between two concepts')
  .argument('<conceptA>', 'First concept')
  .argument('<conceptB>', 'Second concept')
  .action((conceptA, conceptB) => {
    runRelationFinder(conceptA, conceptB);
  });

export default cmd;

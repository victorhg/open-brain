import { Command } from 'commander';
import { runQuery } from '../../../recipes/query-brain/index.js';

const cmd = new Command('query');

cmd
  .description('Search your knowledge graph')
  .argument('<query>', 'Search string')
  .option('-l, --limit <number>', 'Max results', (val) => parseInt(val, 10), 5)
  .option('-t, --threshold <number>', 'Similarity threshold', (val) => parseFloat(val), 0.3)
  .option('--answer', 'Synthesize a grounded answer', false)
  .option('--strict', 'Abort if context is weak', false)
  .option('--graph', 'Expand results with 1-hop graph neighbors (wikilinks + tag co-mentions)', false)
  .option('--wiki', 'Prepend pre-computed wiki synthesis pages matching the query', false)
  .option('--learnings', 'Inject accumulated insights and patterns', false)
  .action((query, options) => {
    runQuery(query, options);
  });

export default cmd;

import { Command } from 'commander';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const buildWiki = join(__dirname, '../../bin/build-wiki.js');

const cmd = new Command('wiki');

cmd
  .description('Build or list pre-computed wiki synthesis pages')
  .addCommand(
    new Command('build')
      .description('Synthesise wiki pages for the top hub notes in your knowledge graph')
      .option('-l, --limit <number>', 'Max pages to build (default: 20)', '20')
      .option('-d, --min-degree <number>', 'Min graph edges for a hub to qualify (default: 10)', '10')
      .option('-s, --slug <slug>', 'Rebuild one specific page by slug')
      .option('--skip-existing', 'Skip pages that already exist in wiki_pages')
      .option('--dry-run', 'Show what would be built without writing anything')
      .action((opts) => {
        const args = [];
        if (opts.limit)         args.push('--limit',      opts.limit);
        if (opts.minDegree)     args.push('--min-degree', opts.minDegree);
        if (opts.slug)          args.push('--slug',       opts.slug);
        if (opts.skipExisting)  args.push('--skip-existing');
        if (opts.dryRun)        args.push('--dry-run');
        const result = spawnSync('node', [buildWiki, ...args], { stdio: 'inherit' });
        if (result.status !== 0) process.exit(result.status ?? 1);
      })
  )
  .addCommand(
    new Command('list')
      .description('List all wiki pages in the database')
      .action(async () => {
        const { createClient } = await import('@supabase/supabase-js');
        const { readFileSync, existsSync } = await import('fs');
        const envPath = join(__dirname, '../../.env');
        if (!existsSync(envPath)) { console.error('.env not found'); process.exit(1); }
        const env = Object.fromEntries(
          readFileSync(envPath,'utf-8').split('\n')
            .filter(l=>l&&!l.startsWith('#'))
            .map(l=>{const[k,...v]=l.split('=');return[k.trim(),v.join('=').trim()]})
        );
        const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
        const { data, error } = await sb.from('wiki_pages')
          .select('slug,title,page_type,model_used,updated_at')
          .order('updated_at', { ascending: false });
        if (error) { console.error(error.message); process.exit(1); }
        if (!data.length) { console.log('No wiki pages yet. Run: brain wiki build'); return; }
        console.log(`\n📖  ${data.length} wiki page(s):\n`);
        for (const p of data) {
          const date = new Date(p.updated_at).toISOString().split('T')[0];
          console.log(`  ${p.slug}`);
          console.log(`    title: ${p.title}`);
          console.log(`    type: ${p.page_type} | model: ${p.model_used} | updated: ${date}\n`);
        }
      })
  );

export default cmd;

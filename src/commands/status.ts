import type { Command } from 'commander';
import ora from 'ora';
import { ManifestManager } from '../config/manifest.js';
import { Orchestrator } from '../core/orchestrator.js';
import { Dashboard } from '../ui/dashboard.js';

export function registerStatus(program: Command): void {
  program
    .command('status')
    .alias('dash')
    .description('Show dashboard with branch states across all repos')
    .option('-g, --group <name>', 'Filter by group')
    .option('-r, --repo <name>', 'Filter by repo')
    .option('-c, --compact', 'Compact view')
    .option('--fetch', 'Fetch from remotes first', false)
    .action(async (opts: { group?: string; repo?: string; compact?: boolean; fetch?: boolean }) => {
      const manifest = new ManifestManager();
      const orchestrator = new Orchestrator(manifest);
      const target = opts.group ?? opts.repo;

      if (opts.fetch) {
        const spinner = ora('Fetching from remotes...').start();
        await orchestrator.repos.fetchAll(target);
        spinner.succeed('Fetched');
      }

      const states = await orchestrator.repos.getStates(target);
      Dashboard.render(states, { compact: opts.compact });
    });
}

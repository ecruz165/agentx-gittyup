import type { Command } from 'commander';
import chalk from 'chalk';
import { ManifestManager } from '../config/manifest.js';
import { Orchestrator } from '../core/orchestrator.js';

export function registerFetch(program: Command): void {
  program
    .command('fetch')
    .description('Fetch all remotes across repos')
    .option('-g, --group <name>', 'Filter by group')
    .action(async (opts: { group?: string }) => {
      const manifest = new ManifestManager();
      const orchestrator = new Orchestrator(manifest);
      const results = await orchestrator.repos.fetchAll(opts.group, (repo, status) => {
        console.log(chalk.dim(`  ${repo}: ${status}`));
      });
      const failed = results.filter((r) => !r.success);
      console.log(failed.length === 0
        ? chalk.green(`\n✓ Fetched ${results.length} repos`)
        : chalk.yellow(`\n⚠ ${failed.length}/${results.length} failed`),
      );
    });
}

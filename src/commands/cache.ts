import type { Command } from 'commander';
import chalk from 'chalk';
import { CliCache } from '../core';

export function registerCache(program: Command): void {
  const cacheCmd = program.command('cache').description('Manage result cache');

  cacheCmd
    .command('clear')
    .description('Clear all cached results')
    .action(async () => {
      const c = new CliCache();
      console.log(chalk.green(`✓ Cleared ${c.clear()} cached result(s)`));
    });

  cacheCmd
    .command('prune')
    .description('Remove expired cache entries')
    .action(async () => {
      const c = new CliCache();
      console.log(chalk.green(`✓ Pruned ${c.prune()} expired entry/entries`));
    });
}

import type { Command } from 'commander';
import chalk from 'chalk';
import { ManifestManager } from '../config/manifest.js';

export function registerGroup(program: Command): void {
  const groupCmd = program.command('group').description('Manage groups');

  groupCmd
    .command('create <name>')
    .description('Create a new empty group')
    .option('-d, --desc <description>', 'Group description')
    .action(async (name: string, opts: { desc?: string }) => {
      const manifest = new ManifestManager();
      manifest.createGroup(name, opts.desc);
      manifest.save();
      console.log(chalk.green(`✓ Created group "${name}"`));
    });

  groupCmd
    .command('remove <name>')
    .description('Remove a group')
    .action(async (name: string) => {
      const manifest = new ManifestManager();
      manifest.removeGroup(name);
      manifest.save();
      console.log(chalk.green(`✓ Removed group "${name}"`));
    });
}

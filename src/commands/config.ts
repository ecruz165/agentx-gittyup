import type { Command } from 'commander';
import chalk from 'chalk';
import { ManifestManager } from '../config';
import type { AiMode } from '../config';

export function registerConfig(program: Command): void {
  program
    .command('config')
    .description('View or update settings')
    .option('--ai <mode>', 'Set AI mode: auto | suggest | manual')
    .option('--show', 'Show current config')
    .action(async (opts: { ai?: string; show?: boolean }) => {
      const manifest = new ManifestManager();
      if (opts.ai) {
        manifest.updateSettings({ ai_mode: opts.ai as AiMode });
        manifest.save();
        console.log(chalk.green(`✓ AI mode set to: ${opts.ai}`));
      }
      if (opts.show || !opts.ai) {
        const { resolveGitHubToken } = await import('../auth/token-manager.js');
        const settings = manifest.data.settings;
        const hasToken = (await resolveGitHubToken()) !== null;
        console.log(chalk.bold('\n  Current Settings:'));
        console.log(chalk.dim(`    AI Mode:         ${settings.ai_mode}`));
        console.log(chalk.dim(`    GitHub Token:     ${hasToken ? chalk.green('✓ detected') : chalk.red('✗ not found')}`));
        console.log(chalk.dim(`    Conflict Prefix:  ${settings.conflict_branch_prefix}`));
        console.log(chalk.dim(`    Manifest:         ${manifest.manifestPath}\n`));
      }
    });
}

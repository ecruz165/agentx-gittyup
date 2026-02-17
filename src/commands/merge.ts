import type { Command } from 'commander';
import chalk from 'chalk';
import { confirm } from '@inquirer/prompts';
import { ManifestManager } from '../config/manifest.js';
import { Orchestrator } from '../core/orchestrator.js';
import type { AiMode, MergeTarget } from '../config/schema.js';

export function registerMerge(program: Command): void {
  program
    .command('merge')
    .description('Merge a branch across repos (dev sync)')
    .argument('<source>', 'Source branch (or alias)')
    .argument('[target]', 'Target branch (or alias)', 'dev')
    .option('-g, --group <name>', 'Target group')
    .option('-r, --repo <name>', 'Target single repo')
    .option('--ai <mode>', 'AI mode: auto | suggest | manual')
    .option('--push', 'Push after successful merge', false)
    .option('--pr', 'Create PRs after merge', false)
    .option('--no-fetch', 'Skip fetching before merge')
    .action(async (source: string, target: string, opts: { group?: string; repo?: string; ai?: string; push?: boolean; pr?: boolean; fetch?: boolean }) => {
      const manifest = new ManifestManager();
      const orchestrator = new Orchestrator(manifest);
      const scope = opts.group ?? opts.repo;
      if (!scope) { console.error(chalk.red('Specify --group or --repo')); process.exit(1); }

      const repos = orchestrator.repos.getReposForTarget(scope);
      const targets: MergeTarget[] = repos.map((repo) => ({
        repo, sourceBranch: repo.branches[source] ?? source, targetBranch: repo.branches[target] ?? target,
      }));

      console.log(chalk.bold('\n  Merge Plan:'));
      for (const t of targets) console.log(chalk.dim(`    ${t.repo.name}: ${t.sourceBranch} → ${t.targetBranch}`));

      const ok = await confirm({ message: `Proceed with merge across ${targets.length} repo(s)?`, default: true });
      if (!ok) return;

      await orchestrator.executeMerge(targets, { aiMode: (opts.ai as AiMode) ?? undefined, push: opts.push, createPR: opts.pr, fetch: opts.fetch });
    });
}

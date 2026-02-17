import type { Command } from 'commander';
import chalk from 'chalk';
import { confirm } from '@inquirer/prompts';
import { ManifestManager } from '../config/manifest.js';
import { Orchestrator } from '../core/orchestrator.js';
import type { AiMode, CherryPickTarget } from '../config/schema.js';

export function registerPick(program: Command): void {
  program
    .command('pick')
    .alias('cherry-pick')
    .description('Cherry-pick commits between branches within repos')
    .option('-g, --group <name>', 'Target group')
    .option('-r, --repo <name>', 'Target single repo')
    .option('-s, --source <branch>', 'Source branch (or alias)')
    .option('-t, --target <branch>', 'Target branch (or alias)')
    .option('-c, --commits <shas...>', 'Specific commit SHAs')
    .option('-i, --interactive', 'Interactively select commits', false)
    .option('--ai <mode>', 'AI mode: auto | suggest | manual')
    .option('--push', 'Push after cherry-pick', false)
    .option('--pr', 'Create PRs', false)
    .option('--no-fetch', 'Skip fetching')
    .action(async (opts: { group?: string; repo?: string; source?: string; target?: string; commits?: string[]; interactive?: boolean; ai?: string; push?: boolean; pr?: boolean; fetch?: boolean }) => {
      const manifest = new ManifestManager();
      const orchestrator = new Orchestrator(manifest);
      const scope = opts.group ?? opts.repo;
      if (!scope) { console.error(chalk.red('Specify --group or --repo')); process.exit(1); }
      if (!opts.source || !opts.target) { console.error(chalk.red('Specify --source and --target branches')); process.exit(1); }

      const repos = orchestrator.repos.getReposForTarget(scope);
      const targets: CherryPickTarget[] = [];

      for (const repo of repos) {
        const sourceBranch = repo.branches[opts.source!] ?? opts.source!;
        const targetBranch = repo.branches[opts.target!] ?? opts.target!;

        let commits: string[];
        if (opts.commits) {
          commits = opts.commits;
        } else if (opts.interactive) {
          console.log(chalk.bold(`\nSelect commits for ${repo.name}:`));
          commits = await orchestrator.selectCommits(repo, sourceBranch);
          if (commits.length === 0) { console.log(chalk.yellow(`  Skipping ${repo.name}`)); continue; }
        } else {
          console.error(chalk.red('Specify --commits or use --interactive')); process.exit(1);
        }
        targets.push({ repo, commits, sourceBranch, targetBranch });
      }

      if (targets.length === 0) { console.log(chalk.yellow('No targets configured.')); return; }

      console.log(chalk.bold('\n  Cherry-Pick Plan:'));
      for (const t of targets) {
        console.log(chalk.dim(`    ${t.repo.name}: ${t.commits.length} commit(s) ${t.sourceBranch} → ${t.targetBranch}`));
        for (const c of t.commits) console.log(chalk.dim(`      ${c.substring(0, 8)}`));
      }

      const ok = await confirm({ message: `Proceed with cherry-pick across ${targets.length} repo(s)?`, default: true });
      if (!ok) return;

      await orchestrator.executeCherryPick(targets, { aiMode: (opts.ai as AiMode) ?? undefined, push: opts.push, createPR: opts.pr, fetch: opts.fetch });
    });
}

import type { Command } from 'commander';
import chalk from 'chalk';
import { ManifestManager } from '../config/manifest.js';
import { Orchestrator } from '../core/orchestrator.js';
import { GitHubClient } from '../github/client.js';

export function registerPrs(program: Command): void {
  program
    .command('prs')
    .description('List open PRs across repos')
    .option('-g, --group <name>', 'Filter by group')
    .action(async (opts: { group?: string }) => {
      const manifest = new ManifestManager();
      const orchestrator = new Orchestrator(manifest);
      const repos = opts.group ? orchestrator.repos.getReposForTarget(opts.group) : orchestrator.repos.getAllRepos();
      const ghRepos = repos.filter((r) => r.url?.includes('github.com'));
      if (ghRepos.length === 0) { console.log(chalk.yellow('No repos with GitHub URLs configured.')); return; }

      const gh = await GitHubClient.create();
      for (const repo of ghRepos) {
        try {
          const { owner, repo: repoName } = await gh.getRepoOwner(repo.url!);
          const prs = await gh.listOpenPRs(owner, repoName);
          console.log(chalk.blue.bold(`\n  ${repo.name}`) + chalk.dim(` (${prs.length} open)`));
          for (const pr of prs.slice(0, 10)) console.log(`    #${pr.number} ${pr.title} ${chalk.dim(`(${pr.head} → ${pr.base})`)} ${chalk.blue(pr.url)}`);
        } catch (err: any) { console.log(chalk.red(`  ${repo.name}: ${err.message}`)); }
      }
      console.log();
    });
}

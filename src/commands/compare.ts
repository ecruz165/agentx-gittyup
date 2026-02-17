import type { Command } from 'commander';
import chalk from 'chalk';
import { ManifestManager } from '../config';
import { Orchestrator } from '../core';
import { CliCache } from '../core';
import { gatherCompareData, renderCompare } from '../ui';
import { GitHubClient } from '../github';
import type { PRInfo } from '../config';

export function registerCompare(program: Command): void {
  program
    .command('compare')
    .alias('cmp')
    .description('Compare two branches side-by-side with conflict detection')
    .argument('<left>', 'Left branch (or alias)')
    .argument('<right>', 'Right branch (or alias)')
    .option('-g, --group <name>', 'Filter by group')
    .option('-r, --repo <name>', 'Filter by repo')
    .option('--fetch', 'Fetch from remotes first', false)
    .option('--no-conflicts', 'Skip conflict detection')
    .option('--no-pr', 'Skip PR lookup from GitHub')
    .option('-f, --force', 'Bypass cache and force fresh data', false)
    .action(async (left: string, right: string, opts: { group?: string; repo?: string; fetch?: boolean; conflicts?: boolean; pr?: boolean; force?: boolean }) => {
      const manifest = new ManifestManager();
      const orchestrator = new Orchestrator(manifest);
      const target = opts.group ?? opts.repo;

      // Cache check
      const cache = new CliCache();
      cache.prune();

      const cacheKey = CliCache.buildKey('compare', { left, right, group: opts.group, repo: opts.repo, conflicts: opts.conflicts, pr: opts.pr });

      if (!opts.force && !opts.fetch) {
        const cached = cache.get<{ rows: any[]; prData: Record<string, any> | null }>(cacheKey);
        if (cached.hit) {
          CliCache.printCacheNotice(cached.ageMs);
          const prMap = cached.data.prData ? new Map(Object.entries(cached.data.prData)) as Map<string, PRInfo> : undefined;
          renderCompare(cached.data.rows, left, right, prMap);
          return;
        }
      }

      const rows = await gatherCompareData(manifest, orchestrator.repos, target, left, right, { fetch: opts.fetch, checkConflicts: opts.conflicts });

      // PR lookup (on by default)
      let prData: Map<string, PRInfo> | undefined;
      if (opts.pr !== false) {
        try {
          const gh = await GitHubClient.create();
          prData = new Map();
          for (const row of rows) {
            if (!row.repo.url?.includes('github.com')) continue;
            try {
              const { owner, repo: repoName } = await gh.getRepoOwner(row.repo.url!);
              const rightRef = row.repo.branches[right] ?? right;
              const leftRef = row.repo.branches[left] ?? left;
              const existing = await gh.findExistingPR(owner, repoName, rightRef, leftRef);
              if (existing) prData.set(row.repo.name, { number: existing.number, state: 'open', url: existing.html_url, date: existing.created_at.slice(0, 10) });
            } catch {}
          }
        } catch (err: any) { console.log(chalk.yellow(`  Could not fetch PR data: ${err.message}`)); }
      }

      // Cache result
      cache.set(cacheKey, { rows, prData: prData ? Object.fromEntries(prData.entries()) : null }, { command: 'compare', args: [left, right] });

      renderCompare(rows, left, right, prData);
    });
}

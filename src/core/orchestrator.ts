import chalk from 'chalk';
import ora from 'ora';
import { confirm, checkbox } from '@inquirer/prompts';
import { RepoManager } from './repo-manager.js';
import { ConflictResolver } from './conflict-resolver.js';
import { GitHubClient } from '../github/client.js';
import { callCopilot } from '../auth/token-manager.js';
import { resolveGitHubToken } from '../auth/token-manager.js';
import { Dashboard } from '../ui/dashboard.js';
import { ManifestManager } from '../config/manifest.js';
import type {
  AiMode, CherryPickTarget, ConflictFile, MergeTarget, OperationResult, RepoConfig,
} from '../config/schema.js';

/**
 * Coordinates merge and cherry-pick flows across multiple repos.
 * Delegates conflict resolution to ConflictResolver and PR creation to GitHubClient.
 */
export class Orchestrator {
  private repoManager: RepoManager;
  private manifest: ManifestManager;
  private github: GitHubClient | null = null;

  constructor(manifest: ManifestManager) {
    this.manifest = manifest;
    this.repoManager = new RepoManager(manifest);
  }

  get repos(): RepoManager {
    return this.repoManager;
  }

  private async getGitHub(): Promise<GitHubClient> {
    if (!this.github) {
      this.github = await GitHubClient.create();
    }
    return this.github;
  }

  // ─── Merge Flow (Dev Sync) ────────────────────────────────────────

  async executeMerge(
    targets: MergeTarget[],
    options: { aiMode?: AiMode; createPR?: boolean; push?: boolean; fetch?: boolean } = {},
  ): Promise<OperationResult[]> {
    const results: OperationResult[] = [];
    const aiMode = options.aiMode ?? this.manifest.data.settings.ai_mode;

    if (options.fetch !== false) {
      const spinner = ora('Fetching latest from remotes...').start();
      for (const t of targets) {
        try { await this.repoManager.getGit(t.repo).fetch(t.repo.remote); } catch {}
      }
      spinner.succeed('Fetch complete');
    }

    for (const target of targets) {
      console.log(chalk.bold(`\n  Merging ${target.sourceBranch} → ${target.targetBranch} in ${target.repo.name}`));
      const spinner = ora('  Merging...').start();

      try {
        const git = this.repoManager.getGit(target.repo);
        const hadStash = await git.stash();
        const mergeResult = await git.merge(target.sourceBranch, target.targetBranch);

        if (mergeResult.success) {
          spinner.succeed(`  ${target.repo.name}: Merged cleanly`);
          if (options.push) {
            await git.push(target.repo.remote, target.targetBranch);
            console.log(chalk.dim(`    Pushed to ${target.repo.remote}/${target.targetBranch}`));
          }
          results.push({ repo: target.repo.name, status: 'success', message: `Merged ${target.sourceBranch} → ${target.targetBranch}` });
        } else {
          spinner.warn(`  ${target.repo.name}: ${mergeResult.conflicts.length} conflict(s)`);
          const resolver = new ConflictResolver(git, target.repo, aiMode, { onAiResolve: this.createAiResolver() });
          const session = await resolver.startSession('merge', target.sourceBranch, target.targetBranch);
          if (session.status === 'resolved' && options.push) await git.push(target.repo.remote, target.targetBranch);
          results.push({
            repo: target.repo.name,
            status: session.status === 'resolved' ? 'success' : 'conflict',
            message: session.status === 'resolved' ? 'Conflicts resolved' : `${session.files.length - session.resolvedFiles.length} unresolved`,
            conflictSession: session,
          });
        }

        if (hadStash) { try { await git.stashPop(); } catch {} }
      } catch (err) {
        spinner.fail(`  ${target.repo.name}: Error`);
        results.push({ repo: target.repo.name, status: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    }

    if (options.createPR) await this.attachPRs(results, targets, 'merge');
    Dashboard.renderOperationResults(results, 'Merge');
    return results;
  }

  // ─── Cherry-Pick Flow (Promotion) ─────────────────────────────────

  async executeCherryPick(
    targets: CherryPickTarget[],
    options: { aiMode?: AiMode; createPR?: boolean; push?: boolean; fetch?: boolean } = {},
  ): Promise<OperationResult[]> {
    const results: OperationResult[] = [];
    const aiMode = options.aiMode ?? this.manifest.data.settings.ai_mode;

    if (options.fetch !== false) {
      const spinner = ora('Fetching latest from remotes...').start();
      for (const t of targets) { try { await this.repoManager.getGit(t.repo).fetch(t.repo.remote); } catch {} }
      spinner.succeed('Fetch complete');
    }

    for (const target of targets) {
      console.log(chalk.bold(`\n  Cherry-picking ${target.commits.length} commit(s) → ${target.targetBranch} in ${target.repo.name}`));
      const spinner = ora('  Cherry-picking...').start();

      try {
        const git = this.repoManager.getGit(target.repo);
        const hadStash = await git.stash();
        const cpResult = await git.cherryPick(target.commits, target.targetBranch);

        if (cpResult.success) {
          spinner.succeed(`  ${target.repo.name}: Applied ${cpResult.applied.length} commit(s) cleanly`);
          if (options.push) await git.push(target.repo.remote, target.targetBranch);
          results.push({ repo: target.repo.name, status: 'success', message: `Applied ${cpResult.applied.length} commits to ${target.targetBranch}` });
        } else {
          spinner.warn(`  ${target.repo.name}: Conflict at commit ${cpResult.failedAt?.substring(0, 8)}`);
          const resolver = new ConflictResolver(git, target.repo, aiMode, { onAiResolve: this.createAiResolver() });
          const session = await resolver.startSession('cherry-pick', target.sourceBranch, target.targetBranch);
          if (session.status === 'resolved' && options.push) await git.push(target.repo.remote, target.targetBranch);
          results.push({
            repo: target.repo.name,
            status: session.status === 'resolved' ? 'success' : 'conflict',
            message: session.status === 'resolved' ? `Resolved and applied ${target.commits.length} commits` : `Conflict at ${cpResult.failedAt?.substring(0, 8)}`,
            conflictSession: session,
          });
        }

        if (hadStash) { try { await git.stashPop(); } catch {} }
      } catch (err) {
        spinner.fail(`  ${target.repo.name}: Error`);
        results.push({ repo: target.repo.name, status: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    }

    if (options.createPR) await this.attachPRs(results, targets, 'cherry-pick');
    Dashboard.renderOperationResults(results, 'Cherry-Pick');
    return results;
  }

  // ─── Interactive Commit Selection ─────────────────────────────────

  /** Prompt the user to select commits from a branch for cherry-picking. */
  async selectCommits(repo: RepoConfig, sourceBranch: string, maxCount = 30): Promise<string[]> {
    const git = this.repoManager.getGit(repo);
    const commits = await git.listCommits(sourceBranch, maxCount);
    if (commits.length === 0) { console.log(chalk.yellow(`No commits found on ${sourceBranch}`)); return []; }

    return checkbox({
      message: `Select commits to cherry-pick from ${sourceBranch}:`,
      choices: commits.map((c) => ({
        name: `${chalk.yellow(c.hash.substring(0, 8))} ${c.message.substring(0, 60)} ${chalk.dim(`(${c.author}, ${c.date})`)}`,
        value: c.hash,
      })),
      pageSize: 20,
    });
  }

  // ─── PR Helper ────────────────────────────────────────────────────

  private async attachPRs(
    results: OperationResult[],
    targets: Array<{ repo: RepoConfig; sourceBranch: string; targetBranch: string }>,
    operation: string,
  ): Promise<void> {
    const gh = await this.getGitHub();
    const template = this.manifest.data.settings.pr_template ?? '';

    for (const result of results) {
      if (result.status !== 'success' && result.status !== 'conflict') continue;
      const target = targets.find((t) => t.repo.name === result.repo);
      if (!target?.repo.url) continue;

      try {
        const { owner, repo } = await gh.getRepoOwner(target.repo.url);
        const head = result.conflictSession?.conflictBranch || target.targetBranch;
        const body = template
          .replace('{{operation}}', operation)
          .replace('{{source_branch}}', target.sourceBranch)
          .replace('{{target_branch}}', target.targetBranch)
          .replace('{{repo_name}}', target.repo.name)
          .replace('{{commit_count}}', 'N/A');
        const pr = await gh.createPR({ owner, repo, title: `[gittyup] ${operation}: ${target.sourceBranch} → ${target.targetBranch}`, body, head, base: target.targetBranch, labels: ['gittyup'] });
        if (pr.url) result.prUrl = pr.url;
      } catch (err) {
        console.log(chalk.yellow(`  Could not create PR for ${result.repo}: ${err}`));
      }
    }
  }

  // ─── AI Resolver via Copilot ───────────────────────────────────────

  private createAiResolver(): (file: ConflictFile, mode: 'auto' | 'suggest') => Promise<string | null> {
    return async (file: ConflictFile, mode: 'auto' | 'suggest') => {
      // Check if Copilot auth is available
      const tokenSource = await resolveGitHubToken();
      if (!tokenSource) {
        console.log(chalk.dim('\n  [AI] No GitHub token found. Run "gittyup auth login" for Copilot access.'));
        return null;
      }

      const systemPrompt = mode === 'auto'
        ? 'You are a git merge conflict resolver. Given the OURS (current branch), THEIRS (incoming branch), and BASE (common ancestor) versions of a file, produce the correctly merged output. Output ONLY the merged file contents, no explanation.'
        : 'You are a git merge conflict resolver. Given the OURS (current branch), THEIRS (incoming branch), and BASE (common ancestor) versions of a file, suggest a merged resolution. Explain your reasoning briefly, then output the merged file contents in a code block.';

      const userPrompt = [
        `File: ${file.path}`,
        '',
        '=== OURS (current branch) ===',
        file.oursContent,
        '',
        '=== THEIRS (incoming branch) ===',
        file.theirsContent,
        ...(file.baseContent ? ['', '=== BASE (common ancestor) ===', file.baseContent] : []),
      ].join('\n');

      try {
        const spinner = ora(`  AI ${mode}: analyzing ${file.path}...`).start();
        const response = await callCopilot(
          [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          'gpt-4o',
        );
        spinner.stop();

        const content = response.choices?.[0]?.message?.content;
        if (!content) return null;

        if (mode === 'auto') {
          // Strip any code fences if present
          return content.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '');
        }
        return content;
      } catch (err) {
        console.log(chalk.yellow(`  [AI] Copilot error: ${err instanceof Error ? err.message : String(err)}`));
        return null;
      }
    };
  }
}

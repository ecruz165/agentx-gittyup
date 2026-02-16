import { existsSync } from 'node:fs';
import { ManifestManager } from '../config/manifest.js';
import { GitOperations } from './git-operations.js';
import type { RepoConfig, RepoGroup, RepoState } from '../config/schema.js';
import { APP_NAME } from '../config/branding.js';

/**
 * Manages loaded repos and their git instances.
 * Provides batch operations (fetch, state) across groups.
 */
export class RepoManager {
  private manifest: ManifestManager;
  private gitInstances: Map<string, GitOperations> = new Map();

  constructor(manifest: ManifestManager) {
    this.manifest = manifest;
  }

  /** Get or create a GitOperations instance for a repo. */
  getGit(repo: RepoConfig): GitOperations {
    const resolvedPath = this.manifest.resolveRepoPath(repo.path);
    if (!this.gitInstances.has(repo.name)) {
      if (!existsSync(resolvedPath)) {
        throw new Error(`Repo path not found: ${resolvedPath} (${repo.name})`);
      }
      this.gitInstances.set(repo.name, new GitOperations(resolvedPath));
    }
    return this.gitInstances.get(repo.name)!;
  }

  getGroup(name: string): RepoGroup | undefined {
    return this.manifest.getGroup(name);
  }

  getGroups(): RepoGroup[] {
    return this.manifest.getGroups();
  }

  getAllRepos(): Array<RepoConfig & { group: string }> {
    return this.manifest.getAllRepos();
  }

  /**
   * Resolve a target string to repos. Target can be a group name or repo name.
   * Throws if neither is found.
   */
  getReposForTarget(target: string): Array<RepoConfig & { group: string }> {
    const group = this.manifest.getGroup(target);
    if (group) return group.repos.map((r) => ({ ...r, group: group.name }));

    const allRepos = this.manifest.getAllRepos();
    const repo = allRepos.find((r) => r.name === target);
    if (repo) return [repo];

    throw new Error(`"${target}" is not a known group or repo. Run "${APP_NAME} repo list" to see available repos and groups.`);
  }

  /** Get branch state for all repos (or filtered by target). */
  async getStates(target?: string): Promise<RepoState[]> {
    const repos = target ? this.getReposForTarget(target) : this.getAllRepos();
    const states: RepoState[] = [];

    for (const repo of repos) {
      try {
        const git = this.getGit(repo);
        states.push(await git.getRepoState(repo.name, repo.group, repo.branches));
      } catch (err) {
        states.push({
          name: repo.name, group: repo.group,
          path: this.manifest.resolveRepoPath(repo.path),
          currentBranch: 'error', branches: {}, hasUnresolved: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return states;
  }

  /** Fetch all remotes, optionally filtered by target. */
  async fetchAll(
    target?: string,
    onProgress?: (repo: string, status: string) => void,
  ): Promise<Array<{ repo: string; success: boolean; error?: string }>> {
    const repos = target ? this.getReposForTarget(target) : this.getAllRepos();
    const results: Array<{ repo: string; success: boolean; error?: string }> = [];

    for (const repo of repos) {
      onProgress?.(repo.name, 'fetching...');
      try {
        const git = this.getGit(repo);
        await git.fetch(repo.remote);
        results.push({ repo: repo.name, success: true });
        onProgress?.(repo.name, 'done');
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        results.push({ repo: repo.name, success: false, error });
        onProgress?.(repo.name, `error: ${error}`);
      }
    }
    return results;
  }
}

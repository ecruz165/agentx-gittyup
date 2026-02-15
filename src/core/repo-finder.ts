import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, basename, relative } from 'node:path';
import simpleGit from 'simple-git';

/**
 * Represents a discovered git repository.
 */
export interface DiscoveredRepo {
  /** Repository name (folder name) */
  name: string;
  /** Absolute path to the repository */
  absolutePath: string;
  /** Path relative to the search root */
  relativePath: string;
  /** Remote URL if available */
  remoteUrl?: string;
  /** Current branch */
  currentBranch?: string;
  /** Whether it has uncommitted changes */
  isDirty?: boolean;
}

/**
 * Options for repository discovery.
 */
export interface FindReposOptions {
  /** Maximum depth to search (default: 5) */
  maxDepth?: number;
  /** Directories to skip (default: node_modules, .git, vendor, etc.) */
  skipDirs?: string[];
  /** Include repo metadata like remote URL and branch (slower) */
  includeMetadata?: boolean;
}

const DEFAULT_SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'vendor',
  'dist',
  'build',
  '.next',
  '.nuxt',
  'target',
  '__pycache__',
  '.venv',
  'venv',
  '.cache',
  '.npm',
  '.yarn',
]);

/**
 * Recursively finds git repositories starting from a root directory.
 */
export class RepoFinder {
  private readonly rootDir: string;
  private readonly options: Required<FindReposOptions>;

  constructor(rootDir: string, options: FindReposOptions = {}) {
    this.rootDir = rootDir;
    this.options = {
      maxDepth: options.maxDepth ?? 5,
      skipDirs: options.skipDirs ?? [...DEFAULT_SKIP_DIRS],
      includeMetadata: options.includeMetadata ?? true,
    };
  }

  /**
   * Find all git repositories under the root directory.
   */
  async find(onProgress?: (path: string) => void): Promise<DiscoveredRepo[]> {
    const repos: DiscoveredRepo[] = [];
    await this.scanDirectory(this.rootDir, 0, repos, onProgress);
    return repos;
  }

  private async scanDirectory(
    dir: string,
    depth: number,
    repos: DiscoveredRepo[],
    onProgress?: (path: string) => void
  ): Promise<void> {
    if (depth > this.options.maxDepth) return;

    const gitDir = join(dir, '.git');
    if (existsSync(gitDir)) {
      onProgress?.(dir);
      const repo = await this.buildRepoInfo(dir);
      repos.push(repo);
      return; // Don't recurse into git repos
    }

    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return; // Permission denied or other error
    }

    for (const entry of entries) {
      if (this.options.skipDirs.includes(entry)) continue;
      if (entry.startsWith('.') && entry !== '.git') continue;

      const fullPath = join(dir, entry);
      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          await this.scanDirectory(fullPath, depth + 1, repos, onProgress);
        }
      } catch {
        // Skip inaccessible entries
      }
    }
  }

  private async buildRepoInfo(repoPath: string): Promise<DiscoveredRepo> {
    const repo: DiscoveredRepo = {
      name: basename(repoPath),
      absolutePath: repoPath,
      relativePath: relative(this.rootDir, repoPath) || '.',
    };

    if (this.options.includeMetadata) {
      try {
        const git = simpleGit(repoPath);
        const [remotes, status] = await Promise.all([
          git.getRemotes(true),
          git.status(),
        ]);

        const origin = remotes.find((r) => r.name === 'origin');
        if (origin?.refs?.fetch) {
          repo.remoteUrl = origin.refs.fetch;
        }
        repo.currentBranch = status.current ?? undefined;
        repo.isDirty = !status.isClean();
      } catch {
        // Git operations failed, skip metadata
      }
    }

    return repo;
  }
}


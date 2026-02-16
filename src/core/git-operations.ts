import simpleGit, { type SimpleGit, type StatusResult } from 'simple-git';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RepoBranchState, RepoState, ConflictFile } from '../config/schema.js';
import { APP_NAME } from '../config/branding.js';

/**
 * Low-level git operations for a single repository.
 * Wraps simple-git with methods for merge, cherry-pick, conflict detection, and resolution.
 */
export class GitOperations {
  private git: SimpleGit;
  private repoPath: string;

  constructor(repoPath: string) {
    this.repoPath = repoPath;
    this.git = simpleGit(repoPath);
  }

  // ─── State Inspection ──────────────────────────────────────────────

  async getStatus(): Promise<StatusResult> {
    return this.git.status();
  }

  async getCurrentBranch(): Promise<string> {
    const status = await this.git.status();
    return status.current ?? 'HEAD';
  }

  /** Get detailed state for a single branch (ahead/behind, dirty, last commit). */
  async getBranchState(branchName: string, trackingBranch?: string): Promise<RepoBranchState> {
    try {
      const log = await this.git.log({ maxCount: 1, from: branchName });
      const latest = log.latest;
      const tracking = trackingBranch ?? `origin/${branchName}`;

      let ahead = 0;
      let behind = 0;
      try {
        const revList = await this.git.raw([
          'rev-list', '--left-right', '--count', `${branchName}...${tracking}`,
        ]);
        const [a, b] = revList.trim().split(/\s+/).map(Number);
        ahead = a ?? 0;
        behind = b ?? 0;
      } catch {
        // tracking branch may not exist
      }

      const status = await this.git.status();
      const isDirty =
        status.current === branchName &&
        (status.modified.length > 0 || status.not_added.length > 0 || status.staged.length > 0);

      return {
        branch: branchName,
        ahead,
        behind,
        hasConflicts: status.conflicted.length > 0,
        isDirty,
        lastCommit: latest?.hash?.substring(0, 8) ?? 'unknown',
        lastCommitDate: latest?.date ?? 'unknown',
        trackingBranch: tracking,
      };
    } catch {
      return {
        branch: branchName, ahead: 0, behind: 0, hasConflicts: false,
        isDirty: false, lastCommit: 'error', lastCommitDate: 'error',
      };
    }
  }

  /** Aggregate state across all aliased branches for dashboard display. */
  async getRepoState(
    name: string,
    group: string,
    branchAliases: Record<string, string>,
  ): Promise<RepoState> {
    try {
      const currentBranch = await this.getCurrentBranch();
      const branches: Record<string, RepoBranchState> = {};

      for (const [alias, branchName] of Object.entries(branchAliases)) {
        try {
          branches[alias] = await this.getBranchState(branchName);
        } catch { /* branch may not exist locally */ }
      }

      const status = await this.git.status();
      return {
        name, group, path: this.repoPath, currentBranch,
        branches, hasUnresolved: status.conflicted.length > 0,
      };
    } catch (err) {
      return {
        name, group, path: this.repoPath, currentBranch: 'unknown',
        branches: {}, hasUnresolved: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // ─── Fetch ─────────────────────────────────────────────────────────

  async fetch(remote = 'origin'): Promise<void> {
    await this.git.fetch(remote, { '--prune': null });
  }

  // ─── Merge Operations ─────────────────────────────────────────────

  async merge(
    sourceBranch: string,
    targetBranch: string,
  ): Promise<{ success: boolean; conflicts: string[] }> {
    await this.git.checkout(targetBranch);
    try {
      await this.git.merge([sourceBranch, '--no-ff']);
      return { success: true, conflicts: [] };
    } catch {
      const status = await this.git.status();
      if (status.conflicted.length > 0) {
        return { success: false, conflicts: status.conflicted };
      }
      throw new Error(`Merge failed: ${sourceBranch} → ${targetBranch}`);
    }
  }

  // ─── Cherry-Pick Operations ───────────────────────────────────────

  async cherryPick(
    commits: string[],
    targetBranch: string,
  ): Promise<{ success: boolean; applied: string[]; failedAt?: string; conflicts: string[] }> {
    await this.git.checkout(targetBranch);
    const applied: string[] = [];

    for (const sha of commits) {
      try {
        await this.git.raw(['cherry-pick', sha]);
        applied.push(sha);
      } catch {
        const status = await this.git.status();
        if (status.conflicted.length > 0) {
          return { success: false, applied, failedAt: sha, conflicts: status.conflicted };
        }
        throw new Error(`cherry-pick failed on ${sha}`);
      }
    }
    return { success: true, applied, conflicts: [] };
  }

  async cherryPickAbort(): Promise<void> {
    await this.git.raw(['cherry-pick', '--abort']);
  }

  async cherryPickContinue(): Promise<void> {
    await this.git.raw(['cherry-pick', '--continue']);
  }

  // ─── Conflict Branch Management ───────────────────────────────────

  async createConflictBranch(prefix: string, label: string): Promise<string> {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const branchName = `${prefix}/${label}-${ts}`;
    await this.git.checkoutLocalBranch(branchName);
    return branchName;
  }

  // ─── Conflict Inspection ──────────────────────────────────────────

  async getConflictedFiles(): Promise<ConflictFile[]> {
    const status = await this.git.status();
    const files: ConflictFile[] = [];

    for (const filePath of status.conflicted) {
      const fullPath = join(this.repoPath, filePath);
      let content = '';
      try {
        content = readFileSync(fullPath, 'utf-8');
      } catch { continue; }

      const { ours, theirs, base } = this.parseConflictMarkers(content);
      files.push({ path: filePath, oursContent: ours, theirsContent: theirs, baseContent: base });
    }
    return files;
  }

  private parseConflictMarkers(content: string): { ours: string; theirs: string; base: string } {
    const lines = content.split('\n');
    let ours = '', theirs = '', base = '';
    let section: 'none' | 'ours' | 'base' | 'theirs' = 'none';

    for (const line of lines) {
      if (line.startsWith('<<<<<<<')) section = 'ours';
      else if (line.startsWith('|||||||')) section = 'base';
      else if (line.startsWith('=======')) section = 'theirs';
      else if (line.startsWith('>>>>>>>')) section = 'none';
      else if (section === 'ours') ours += line + '\n';
      else if (section === 'base') base += line + '\n';
      else if (section === 'theirs') theirs += line + '\n';
    }
    return { ours: ours.trimEnd(), theirs: theirs.trimEnd(), base: base.trimEnd() };
  }

  // ─── Resolution ───────────────────────────────────────────────────

  async resolveFile(filePath: string, content: string): Promise<void> {
    writeFileSync(join(this.repoPath, filePath), content, 'utf-8');
    await this.git.add(filePath);
  }

  async resolveUseOurs(filePath: string): Promise<void> {
    await this.git.raw(['checkout', '--ours', filePath]);
    await this.git.add(filePath);
  }

  async resolveUseTheirs(filePath: string): Promise<void> {
    await this.git.raw(['checkout', '--theirs', filePath]);
    await this.git.add(filePath);
  }

  async commitResolution(message?: string): Promise<string> {
    await this.git.commit(message ?? `Resolve conflicts via ${APP_NAME}`);
    const log = await this.git.log({ maxCount: 1 });
    return log.latest?.hash ?? 'unknown';
  }

  async abortMerge(): Promise<void> {
    await this.git.merge(['--abort']);
  }

  // ─── Commit Listing ───────────────────────────────────────────────

  async listCommits(
    branch: string,
    maxCount = 50,
  ): Promise<Array<{ hash: string; date: string; message: string; author: string }>> {
    const log = await this.git.log({ maxCount, from: branch });
    return log.all.map((c) => ({
      hash: c.hash, date: c.date, message: c.message, author: c.author_name,
    }));
  }

  // ─── Branch Operations ────────────────────────────────────────────

  async branchExists(name: string): Promise<boolean> {
    try {
      await this.git.raw(['rev-parse', '--verify', name]);
      return true;
    } catch { return false; }
  }

  async checkout(branch: string): Promise<void> {
    await this.git.checkout(branch);
  }

  async push(remote = 'origin', branch?: string): Promise<void> {
    const b = branch ?? (await this.getCurrentBranch());
    await this.git.push(remote, b, ['--set-upstream']);
  }

  async stash(): Promise<boolean> {
    const result = await this.git.stash();
    return !result.includes('No local changes');
  }

  async stashPop(): Promise<void> {
    await this.git.stash(['pop']);
  }

  /** Expose the underlying simple-git instance for advanced operations. */
  get instance(): SimpleGit {
    return this.git;
  }
}

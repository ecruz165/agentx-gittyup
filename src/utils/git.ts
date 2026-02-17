import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { CONFIG_PARENT_DIR, CONFIG_DIR_NAME } from '../config/branding.js';

/**
 * Detect the git repository root for the given directory.
 * Returns null if not inside a git repository.
 * Uses execFileSync so it can be called during ManifestManager construction.
 */
export function detectGitRoot(cwd?: string): string | null {
  try {
    const stdout = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: cwd ?? process.cwd(),
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Returns the repo-local config home directory path.
 * e.g. {gitRoot}/.agentx/gittyup/
 */
export function getRepoConfigHome(gitRoot: string): string {
  return join(gitRoot, CONFIG_PARENT_DIR, CONFIG_DIR_NAME);
}

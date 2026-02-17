import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  CONFIG_PARENT_DIR,
  CONFIG_DIR_NAME,
  ENV_CONFIG_OVERRIDE,
} from '../config/branding.js';

/**
 * Returns the root config directory (e.g. ~/.agentx).
 * Respects the AGENTX_HOME env var override.
 */
export function getConfigRoot(): string {
  return process.env[ENV_CONFIG_OVERRIDE] ?? join(homedir(), CONFIG_PARENT_DIR);
}

/**
 * Returns the global tool-specific home directory path.
 * e.g. ~/.agentx/gittyup/
 */
export function getGittyupHome(): string {
  return join(getConfigRoot(), CONFIG_DIR_NAME);
}

/**
 * Returns the path to a specific file within the global tool home directory.
 */
export function getHomePath(filename: string): string {
  return join(getGittyupHome(), filename);
}

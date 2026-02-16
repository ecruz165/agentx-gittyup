import { join } from 'node:path';
import { homedir } from 'node:os';

// ─── Root Brand Primitives ──────────────────────────────────────────
// These two values drive all branding. The rebrand script updates them.

/** Umbrella suite/org name (e.g., agentx → ~/.agentx/). */
export const APP_GROUP_NAME = 'agentx';

/** This tool's name (CLI command, config subdir, manifest filename). */
export const APP_NAME = 'gittyup';

// ─── Derived Brand Constants ────────────────────────────────────────

/** Parent directory under $HOME for config/cache/auth: .agentx */
export const CONFIG_PARENT_DIR = `.${APP_GROUP_NAME}`;

/** Subdirectory under CONFIG_PARENT_DIR for this tool: gittyup */
export const CONFIG_DIR_NAME = APP_NAME;

/** GitHub repository URL (PR footer, docs). */
export const APP_REPO_URL = `https://github.com/ecruz165/agentx-${APP_NAME}`;

// ─── Derived Values ─────────────────────────────────────────────────

/** Manifest filename: gittyup.yaml */
export const MANIFEST_FILENAME = `${APP_NAME}.yaml`;

/** Config directory: ~/.agentx/gittyup */
export const APP_CONFIG_DIR = join(homedir(), CONFIG_PARENT_DIR, CONFIG_DIR_NAME);

/** Auth file: ~/.agentx/gittyup/auth.json */
export const APP_AUTH_FILE = join(APP_CONFIG_DIR, 'auth.json');

/** Cache directory: ~/.agentx/gittyup/cache */
export const APP_CACHE_DIR = join(APP_CONFIG_DIR, 'cache');

/** Human-readable config dir path for messages (uses ~ instead of absolute path). */
export const APP_CONFIG_DIR_DISPLAY = `~/${CONFIG_PARENT_DIR}/${CONFIG_DIR_NAME}`;

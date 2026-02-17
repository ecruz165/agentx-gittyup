import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { dirname } from 'node:path';
import chalk from 'chalk';
import { getHomePath } from '../utils/home.js';
import { CLI_BIN_NAME, APP_CONFIG_DIR_DISPLAY } from '../config/branding.js';
import {
  AuthCredentialsSchema,
  AuthFileSchema,
  COPILOT_TOKEN_URL,
  COPILOT_CHAT_URL,
  COPILOT_MODELS_URL,
  EDITOR_VERSION,
  TOKEN_REFRESH_THRESHOLD,
  type AuthCredentials,
  type AuthFile,
  type CopilotTokenResponse,
  type ChatCompletionMessage,
  type ChatCompletionResponse,
  type TokenSource,
  type CopilotModelEntry,
} from './types.js';

const AUTH_FILE = 'auth.json';

function getAuthPath(): string {
  return getHomePath(AUTH_FILE);
}

/**
 * Read and parse auth.json. Returns null if file is missing or invalid.
 */
export async function readAuthCredentials(): Promise<AuthCredentials | null> {
  const authPath = getAuthPath();
  if (!existsSync(authPath)) {
    return null;
  }
  try {
    const raw = await readFile(authPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return AuthCredentialsSchema.parse(parsed);
  } catch {
    return null;
  }
}

/**
 * Write credentials to auth.json. Creates parent directory if needed.
 */
export async function writeAuthCredentials(creds: AuthCredentials): Promise<void> {
  const authPath = getAuthPath();
  const dir = dirname(authPath);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  await writeFile(authPath, JSON.stringify(creds, null, 2), 'utf-8');
}

/**
 * Delete auth.json.
 */
export async function deleteAuthCredentials(): Promise<void> {
  const authPath = getAuthPath();
  if (existsSync(authPath)) {
    await unlink(authPath);
  }
}

// --- Multi-provider auth file (new format) ---

/**
 * Read auth.json in the new multi-provider format.
 * Auto-migrates from legacy flat format (Copilot-only) if detected.
 * Returns a valid AuthFile — empty providers if file is missing.
 */
export async function readAuthFile(): Promise<AuthFile> {
  const authPath = getAuthPath();
  if (!existsSync(authPath)) {
    return { active_provider: 'copilot' };
  }

  try {
    const raw = await readFile(authPath, 'utf-8');
    const parsed = JSON.parse(raw);

    // Detect legacy flat format: has github_token at top level, no active_provider
    if (parsed.github_token && !parsed.active_provider) {
      // Auto-migrate: wrap under copilot key
      const migrated: AuthFile = {
        active_provider: 'copilot',
        copilot: {
          github_token: parsed.github_token,
          copilot_token: parsed.copilot_token,
          copilot_token_expires_at: parsed.copilot_token_expires_at,
          username: parsed.username,
        },
      };
      // Persist the migrated format
      await writeAuthFile(migrated);
      return migrated;
    }

    return AuthFileSchema.parse(parsed);
  } catch {
    return { active_provider: 'copilot' };
  }
}

/**
 * Write auth.json in multi-provider format. Creates parent directory if needed.
 */
export async function writeAuthFile(authFile: AuthFile): Promise<void> {
  const authPath = getAuthPath();
  const dir = dirname(authPath);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  await writeFile(authPath, JSON.stringify(authFile, null, 2), 'utf-8');
}

/**
 * Resolve the GitHub OAuth token from environment variables or auth.json.
 * Precedence: COPILOT_GITHUB_TOKEN > GITHUB_TOKEN > auth.json
 * Returns token and its source, or null if no token is available.
 */
export async function resolveGitHubToken(): Promise<TokenSource | null> {
  const copilotEnv = process.env.COPILOT_GITHUB_TOKEN;
  if (copilotEnv) {
    return { token: copilotEnv, source: 'env:COPILOT_GITHUB_TOKEN' };
  }

  const githubEnv = process.env.GITHUB_TOKEN;
  if (githubEnv) {
    return { token: githubEnv, source: 'env:GITHUB_TOKEN' };
  }

  const creds = await readAuthCredentials();
  if (creds?.github_token) {
    return { token: creds.github_token, source: 'auth.json' };
  }

  return null;
}

/**
 * Fetch a Copilot API token using the GitHub OAuth token.
 * Caches the result in auth.json. Proactively refreshes if < 5 min remaining.
 */
export async function getCopilotToken(githubToken: string): Promise<string> {
  // Check cached token
  const creds = await readAuthCredentials();
  if (creds?.copilot_token && creds.copilot_token_expires_at) {
    const now = Math.floor(Date.now() / 1000);
    const remaining = creds.copilot_token_expires_at - now;
    if (remaining > TOKEN_REFRESH_THRESHOLD) {
      return creds.copilot_token;
    }
  }

  // Fetch new Copilot token
  const response = await fetch(COPILOT_TOKEN_URL, {
    headers: {
      Authorization: `token ${githubToken}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `Failed to get Copilot token (${response.status}): ${body || response.statusText}`,
    );
  }

  const data = (await response.json()) as CopilotTokenResponse;

  // Cache in auth.json
  const updatedCreds: AuthCredentials = {
    ...(creds ?? { github_token: githubToken }),
    github_token: githubToken,
    copilot_token: data.token,
    copilot_token_expires_at: data.expires_at,
  };
  await writeAuthCredentials(updatedCreds);

  return data.token;
}

/**
 * General-purpose Copilot API call. Handles authentication, token refresh, and 401 retry.
 * This is the reusable entry point for T-7 (expansion) and T-9 (skill inference).
 */
export async function callCopilot(
  messages: ChatCompletionMessage[],
  model: string,
): Promise<ChatCompletionResponse> {
  const tokenSource = await resolveGitHubToken();
  if (!tokenSource) {
    throw new Error(`Not authenticated. Run "${CLI_BIN_NAME} auth login" first.`);
  }

  const doRequest = async (copilotToken: string): Promise<Response> => {
    return fetch(COPILOT_CHAT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${copilotToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'GithubCopilot/1.155.0',
        'Editor-Version': EDITOR_VERSION,
        'Editor-Plugin-Version': 'copilot.vim/1.16.0',
        'Copilot-Integration-Id': 'vscode-chat',
        'Openai-Intent': 'conversation-panel',
      },
      body: JSON.stringify({ model, messages, stream: false }),
    });
  };

  let copilotToken = await getCopilotToken(tokenSource.token);
  let response = await doRequest(copilotToken);

  // Reactive retry on 401 (token may have been revoked or clock skew)
  if (response.status === 401) {
    // Invalidate cached token and fetch a new one
    const creds = await readAuthCredentials();
    if (creds) {
      creds.copilot_token = undefined;
      creds.copilot_token_expires_at = undefined;
      await writeAuthCredentials(creds);
    }
    copilotToken = await getCopilotToken(tokenSource.token);
    response = await doRequest(copilotToken);
  }

  // Handle rate limiting (429)
  if (response.status === 429) {
    const retryAfter = response.headers.get('retry-after');
    const waitSeconds = retryAfter ? parseInt(retryAfter, 10) : 10;
    await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
    response = await doRequest(copilotToken);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `Copilot API error (${response.status}): ${body || response.statusText}`,
    );
  }

  return (await response.json()) as ChatCompletionResponse;
}

/**
 * Fetch the list of models available to the authenticated user from the Copilot API.
 * Returns an array of model entries with IDs and capability metadata.
 * Returns null if not authenticated or the API call fails.
 */
export async function fetchCopilotModels(): Promise<CopilotModelEntry[] | null> {
  const tokenSource = await resolveGitHubToken();
  if (!tokenSource) {
    return null;
  }

  try {
    const copilotToken = await getCopilotToken(tokenSource.token);
    const response = await fetch(COPILOT_MODELS_URL, {
      headers: {
        Authorization: `Bearer ${copilotToken}`,
        'User-Agent': 'GithubCopilot/1.155.0',
        'Editor-Version': EDITOR_VERSION,
        'Editor-Plugin-Version': 'copilot.vim/1.16.0',
        'Copilot-Integration-Id': 'vscode-chat',
      },
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json() as { data?: CopilotModelEntry[] };
    return Array.isArray(data.data) ? data.data : null;
  } catch {
    return null;
  }
}

// --- Gittyup-specific helpers (not in taskmaster base) ---

/**
 * Run a shell command and return stdout. Returns null on failure.
 */
function runCommand(cmd: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 5000 }, (err, stdout) => {
      resolve(err ? null : stdout.trim() || null);
    });
  });
}

/**
 * Resolve a GitHub token, throwing if none is found.
 * Extended cascade: env vars → auth.json → gh CLI → git credentials.
 */
export async function requireGitHubToken(): Promise<TokenSource> {
  // First try the standard resolution
  const source = await resolveGitHubToken();
  if (source) return source;

  // Try GitHub CLI
  const ghToken = await runCommand('gh', ['auth', 'token']);
  if (ghToken) {
    return { token: ghToken, source: 'auth.json' as const };
  }

  // Try git credential helper
  const gitToken = await new Promise<string | null>((resolve) => {
    const child = execFile(
      'git',
      ['credential', 'fill'],
      { timeout: 5000 },
      (err, stdout) => {
        if (err) { resolve(null); return; }
        const match = stdout.match(/password=(.+)/);
        resolve(match ? match[1].trim() : null);
      },
    );
    child.stdin?.write('protocol=https\nhost=github.com\n\n');
    child.stdin?.end();
  });

  if (gitToken) {
    return { token: gitToken, source: 'auth.json' as const };
  }

  throw new Error(
    `No GitHub token found. Run "${CLI_BIN_NAME} auth login" or set GITHUB_TOKEN.`,
  );
}

/**
 * Print authentication status to console.
 */
export async function printAuthStatus(): Promise<void> {
  const tokenSource = await resolveGitHubToken();

  if (tokenSource) {
    console.log(chalk.green(`    GitHub Token: ✓ (source: ${tokenSource.source})`));
    console.log(chalk.dim(`    Config: ${APP_CONFIG_DIR_DISPLAY}/auth.json`));

    // Check Copilot access
    try {
      await getCopilotToken(tokenSource.token);
      console.log(chalk.green('    Copilot:      ✓ accessible'));
    } catch {
      console.log(chalk.yellow('    Copilot:      ✗ not accessible'));
    }
  } else {
    console.log(chalk.red('    GitHub Token: ✗ not found'));
    console.log(chalk.dim(`    Run "${CLI_BIN_NAME} auth login" to authenticate.`));
  }
}

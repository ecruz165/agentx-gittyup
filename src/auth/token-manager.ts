import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { execSync } from 'node:child_process';
import chalk from 'chalk';
import {
  AuthCredentialsSchema,
  COPILOT_TOKEN_URL,
  COPILOT_CHAT_URL,
  COPILOT_MODELS_URL,
  EDITOR_VERSION,
  TOKEN_REFRESH_THRESHOLD,
  type AuthCredentials,
  type CopilotTokenResponse,
  type ChatCompletionMessage,
  type ChatCompletionResponse,
  type TokenSource,
  type CopilotModelEntry,
} from './types.js';
import { APP_NAME, APP_CONFIG_DIR, APP_APP_AUTH_FILE, APP_CONFIG_DIR_DISPLAY } from '../config/branding.js';

// ─── Credential Storage ─────────────────────────────────────────────

/** Read and parse auth.json. Returns null if missing or invalid. */
export async function readAuthCredentials(): Promise<AuthCredentials | null> {
  if (!existsSync(APP_AUTH_FILE)) return null;
  try {
    const raw = await readFile(APP_AUTH_FILE, 'utf-8');
    return AuthCredentialsSchema.parse(JSON.parse(raw));
  } catch { return null; }
}

/** Write credentials to auth.json. Creates parent directory if needed. */
export async function writeAuthCredentials(creds: AuthCredentials): Promise<void> {
  if (!existsSync(APP_CONFIG_DIR)) await mkdir(APP_CONFIG_DIR, { recursive: true });
  await writeFile(APP_AUTH_FILE, JSON.stringify(creds, null, 2), 'utf-8');
}

/** Delete auth.json. */
export async function deleteAuthCredentials(): Promise<void> {
  if (existsSync(APP_AUTH_FILE)) await unlink(APP_AUTH_FILE);
}

// ─── GitHub Token Resolution ────────────────────────────────────────
// Cascading lookup:
//   1. $GITHUB_TOKEN / $GH_TOKEN  (env var override)
//   2. auth.json                   (device flow login)
//   3. `gh auth token`             (GitHub CLI)
//   4. `git credential fill`       (git credential helper)

/**
 * Resolve a GitHub OAuth token from all available sources.
 * Returns token and its source, or null if none found.
 */
export async function resolveGitHubToken(): Promise<TokenSource | null> {
  // 1. Env vars
  if (process.env.GITHUB_TOKEN) {
    return { token: process.env.GITHUB_TOKEN, source: 'env:GITHUB_TOKEN' };
  }
  if (process.env.GH_TOKEN) {
    return { token: process.env.GH_TOKEN, source: 'env:GH_TOKEN' };
  }

  // 2. auth.json (from device flow login)
  const creds = await readAuthCredentials();
  if (creds?.github_token) {
    return { token: creds.github_token, source: 'auth.json' };
  }

  // 3. GitHub CLI
  const ghToken = tryGhAuthToken();
  if (ghToken) return { token: ghToken, source: 'gh-cli' };

  // 4. Git credential helper
  const gitToken = tryGitCredentialFill();
  if (gitToken) return { token: gitToken, source: 'git-credential' };

  return null;
}

function tryGhAuthToken(): string | null {
  try {
    const token = execSync('gh auth token', { encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    return token.length > 0 ? token : null;
  } catch { return null; }
}

function tryGitCredentialFill(): string | null {
  try {
    const output = execSync('git credential fill', { input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] });
    const match = output.match(/^password=(.+)$/m);
    return match ? match[1].trim() : null;
  } catch { return null; }
}

/** Resolve token or throw with a helpful error. */
export async function requireGitHubToken(): Promise<TokenSource> {
  const result = await resolveGitHubToken();
  if (result) return result;

  throw new Error(
    [
      'Could not find a GitHub token. Tried:',
      '  1. $GITHUB_TOKEN / $GH_TOKEN env vars',
      `  2. ${APP_CONFIG_DIR_DISPLAY}/auth.json (${APP_NAME} auth login)`,
      '  3. gh auth token (GitHub CLI)',
      '  4. git credential fill (git credential helper)',
      '',
      'To fix, do one of:',
      `  • ${APP_NAME} auth login     (OAuth device flow → Copilot)`,
      '  • gh auth login',
      '  • export GITHUB_TOKEN=ghp_...',
    ].join('\n'),
  );
}

// ─── Copilot Token Management ───────────────────────────────────────

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
    throw new Error(`Failed to get Copilot token (${response.status}): ${body || response.statusText}`);
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

// ─── Copilot API ────────────────────────────────────────────────────

/**
 * General-purpose Copilot chat completion call.
 * Handles authentication, token refresh, 401 retry, and 429 rate limiting.
 */
export async function callCopilot(
  messages: ChatCompletionMessage[],
  model: string,
): Promise<ChatCompletionResponse> {
  const tokenSource = await requireGitHubToken();

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

  // Reactive retry on 401
  if (response.status === 401) {
    const creds = await readAuthCredentials();
    if (creds) {
      creds.copilot_token = undefined;
      creds.copilot_token_expires_at = undefined;
      await writeAuthCredentials(creds);
    }
    copilotToken = await getCopilotToken(tokenSource.token);
    response = await doRequest(copilotToken);
  }

  // Handle 429 rate limiting
  if (response.status === 429) {
    const retryAfter = response.headers.get('retry-after');
    const waitSeconds = retryAfter ? parseInt(retryAfter, 10) : 10;
    await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
    response = await doRequest(copilotToken);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Copilot API error (${response.status}): ${body || response.statusText}`);
  }

  return (await response.json()) as ChatCompletionResponse;
}

/**
 * Fetch the list of models available to the authenticated user.
 * Returns null if not authenticated or the API call fails.
 */
export async function fetchCopilotModels(): Promise<CopilotModelEntry[] | null> {
  const tokenSource = await resolveGitHubToken();
  if (!tokenSource) return null;

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

    if (!response.ok) return null;

    const data = await response.json() as { data?: CopilotModelEntry[] };
    return Array.isArray(data.data) ? data.data : null;
  } catch { return null; }
}

// ─── Status Display ─────────────────────────────────────────────────

/** Print detailed auth status for diagnostics. */
export async function printAuthStatus(): Promise<void> {
  const tokenSource = await resolveGitHubToken();

  if (!tokenSource) {
    console.log(chalk.red('  ✗ No GitHub token found'));
    console.log(chalk.dim(`    Run: ${APP_NAME} auth login  or  gh auth login  or  export GITHUB_TOKEN=ghp_...`));
    return;
  }

  const masked = `${tokenSource.token.substring(0, 8)}...${tokenSource.token.slice(-4)}`;

  const sourceLabels: Record<string, string> = {
    'env:GITHUB_TOKEN': 'environment variable ($GITHUB_TOKEN)',
    'env:GH_TOKEN': 'environment variable ($GH_TOKEN)',
    'auth.json': `${APP_NAME} auth login (device flow)`,
    'gh-cli': 'gh auth (GitHub CLI)',
    'git-credential': 'git credential helper',
  };

  console.log(chalk.green(`  ✓ GitHub token: ${sourceLabels[tokenSource.source]}`));
  console.log(chalk.dim(`    ${masked}`));

  // Check Copilot access
  const creds = await readAuthCredentials();
  if (creds?.copilot_token && creds.copilot_token_expires_at) {
    const now = Math.floor(Date.now() / 1000);
    const remaining = creds.copilot_token_expires_at - now;
    if (remaining > 0) {
      const mins = Math.floor(remaining / 60);
      console.log(chalk.green(`  ✓ Copilot token: valid (${mins}m remaining)`));
    } else {
      console.log(chalk.yellow('  ⟳ Copilot token: expired (will refresh on next use)'));
    }
  } else {
    console.log(chalk.dim('  ○ Copilot token: not yet obtained (will fetch on first AI call)'));
  }

  if (creds?.username) {
    console.log(chalk.dim(`  ○ User: ${creds.username}`));
  }
}

import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import chalk from 'chalk';
import type { AIProvider, AIModelEntry } from '../provider.js';
import type {
  ChatCompletionMessage,
  ChatCompletionResponse,
  OAuthCredentials,
  TokenUsage,
} from '../types.js';
import { readAuthFile, writeAuthFile } from '../token-manager.js';
import {
  generateCodeChallenge,
  openBrowser,
} from '../oauth-pkce.js';
import { CLI_BIN_NAME } from '../../config/branding.js';

// --- Anthropic OAuth constants ---
const ANTHROPIC_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const ANTHROPIC_AUTH_URL = 'https://claude.ai/oauth/authorize';
const ANTHROPIC_TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token';
const ANTHROPIC_REDIRECT_URI = 'https://console.anthropic.com/oauth/code/callback';
const ANTHROPIC_SCOPES = 'org:create_api_key user:profile user:inference';

// --- Anthropic API constants ---
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODELS_URL = 'https://api.anthropic.com/v1/models';

/** Models available via Anthropic Max subscription. */
const ANTHROPIC_KNOWN_MODELS: AIModelEntry[] = [
  {
    id: 'claude-sonnet-4-20250514',
    name: 'Claude Sonnet 4',
    description: '200K in / 16K out — balanced speed and capability',
    capabilities: { type: 'chat', limits: { max_prompt_tokens: 200_000, max_output_tokens: 16_384 } },
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: '200K in / 32K out — most capable',
    capabilities: { type: 'chat', limits: { max_prompt_tokens: 200_000, max_output_tokens: 32_768 } },
  },
  {
    id: 'claude-haiku-4-20250514',
    name: 'Claude Haiku 4',
    description: '200K in / 8K out — fast, low cost',
    capabilities: { type: 'chat', limits: { max_prompt_tokens: 200_000, max_output_tokens: 8_192 } },
  },
];

/**
 * Anthropic Claude provider.
 *
 * Authentication priority:
 * 1. ANTHROPIC_API_KEY env var
 * 2. auth.json stored credentials (from previous login)
 * 3. OAuth PKCE flow (copy-paste code from browser)
 */
export class AnthropicProvider implements AIProvider {
  readonly name = 'anthropic' as const;

  async login(opts?: { force?: boolean }): Promise<{ displayName: string }> {
    const force = opts?.force ?? false;

    if (!force) {
      // Strategy 1: Check for ANTHROPIC_API_KEY env var
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (apiKey) {
        const creds: OAuthCredentials = {
          access_token: apiKey,
          display_name: 'API Key User',
        };
        const authFile = await readAuthFile();
        authFile.active_provider = 'anthropic';
        authFile.anthropic = creds;
        await writeAuthFile(authFile);

        console.log(chalk.green('\n  Using ANTHROPIC_API_KEY from environment.'));
        return { displayName: 'API Key User' };
      }
    }

    // OAuth PKCE flow (copy-paste approach)
    console.log();
    console.log(chalk.bold('  Login with Anthropic Claude'));
    console.log(`  Starting OAuth authorization flow...`);

    return this.oauthLogin();
  }

  async resolveAuth(): Promise<{ source: string } | null> {
    if (process.env.ANTHROPIC_API_KEY) {
      return { source: 'env:ANTHROPIC_API_KEY' };
    }

    const authFile = await readAuthFile();
    if (authFile.anthropic?.access_token) {
      return { source: 'auth.json (anthropic)' };
    }

    return null;
  }

  async callAI(
    messages: ChatCompletionMessage[],
    model: string,
  ): Promise<ChatCompletionResponse> {
    const accessToken = await this.resolveAccessToken();

    if (!accessToken) {
      throw new Error('Anthropic: Not authenticated. Run "auth login --provider anthropic" first.');
    }

    // Translate OpenAI-style messages to Anthropic Messages API format
    const systemMessages = messages.filter((m) => m.role === 'system');
    const nonSystemMessages = messages.filter((m) => m.role !== 'system');

    const anthropicMessages = nonSystemMessages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    const body: Record<string, unknown> = {
      model,
      messages: anthropicMessages,
      max_tokens: 128000,
    };

    if (systemMessages.length > 0) {
      body.system = systemMessages.map((m) => m.content).join('\n\n');
    }

    const headers = this.buildHeaders(accessToken);

    // OAuth tokens require ?beta=true on the messages endpoint
    const apiUrl = accessToken.startsWith('sk-ant-oat')
      ? `${ANTHROPIC_API_URL}?beta=true`
      : ANTHROPIC_API_URL;

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    // Handle rate limiting
    if (response.status === 429) {
      const retryAfter = response.headers.get('retry-after');
      const waitSeconds = retryAfter ? parseInt(retryAfter, 10) : 10;
      await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
      const retryResponse = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      return this.normalizeResponse(retryResponse);
    }

    return this.normalizeResponse(response);
  }

  async listModels(): Promise<AIModelEntry[] | null> {
    const accessToken = await this.resolveAccessToken();
    if (!accessToken) return null;

    try {
      const response = await fetch(ANTHROPIC_MODELS_URL, {
        headers: this.buildHeaders(accessToken),
      });

      if (!response.ok) {
        return ANTHROPIC_KNOWN_MODELS;
      }

      const data = (await response.json()) as { data?: Array<{ id: string; display_name?: string }> };
      if (Array.isArray(data.data) && data.data.length > 0) {
        return data.data.map((m) => ({
          id: m.id,
          name: m.display_name ?? m.id,
        }));
      }
      return ANTHROPIC_KNOWN_MODELS;
    } catch {
      return ANTHROPIC_KNOWN_MODELS;
    }
  }

  async logout(): Promise<void> {
    const authFile = await readAuthFile();
    delete authFile.anthropic;
    await writeAuthFile(authFile);
  }

  // --- Internal helpers ---

  /**
   * OAuth PKCE login flow — opens browser to Anthropic's authorize page,
   * user copies the code from the callback page and pastes it back.
   *
   * Anthropic's OAuth client uses a server-side redirect URI
   * (console.anthropic.com/oauth/code/callback) that displays the code
   * in {code}#{state} format for the user to copy-paste.
   */
  private async oauthLogin(): Promise<{ displayName: string }> {
    const verifier = randomBytes(64).toString('base64url');
    const challenge = generateCodeChallenge(verifier);
    const state = randomBytes(64).toString('base64url');

    const params = new URLSearchParams({
      response_type: 'code',
      code: 'true',
      client_id: ANTHROPIC_CLIENT_ID,
      redirect_uri: ANTHROPIC_REDIRECT_URI,
      scope: ANTHROPIC_SCOPES,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
      originator: CLI_BIN_NAME,
    });

    const authorizeUrl = `${ANTHROPIC_AUTH_URL}?${params.toString()}`;

    console.log(chalk.dim(`  If the browser doesn't open, visit:`));
    console.log(chalk.cyan(`  ${authorizeUrl}`));
    console.log();

    openBrowser(authorizeUrl);

    console.log(chalk.bold('  After authorizing, copy the code from the browser page.'));
    console.log(chalk.dim('  The code looks like: {code}#{state}\n'));

    const pasted = await this.promptForCode();

    // Parse "code#state" format
    const hashIndex = pasted.indexOf('#');
    if (hashIndex === -1) {
      throw new Error('Invalid code format. Expected {code}#{state} — copy the full string from the browser.');
    }

    const code = pasted.slice(0, hashIndex);
    const pastedState = pasted.slice(hashIndex + 1);

    if (pastedState !== state) {
      throw new Error('OAuth state mismatch — possible CSRF attack.');
    }

    // Exchange code for tokens
    const tokenResponse = await fetch(ANTHROPIC_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: ANTHROPIC_CLIENT_ID,
        code,
        state: pastedState,
        redirect_uri: ANTHROPIC_REDIRECT_URI,
        code_verifier: verifier,
      }),
    });

    if (!tokenResponse.ok) {
      const body = await tokenResponse.text().catch(() => '');
      throw new Error(`Anthropic token exchange failed (${tokenResponse.status}): ${body}`);
    }

    const tokenData = (await tokenResponse.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    const creds: OAuthCredentials = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      token_expires_at: tokenData.expires_in
        ? Math.floor(Date.now() / 1000) + tokenData.expires_in
        : undefined,
      display_name: 'Claude User',
    };

    const authFile = await readAuthFile();
    authFile.active_provider = 'anthropic';
    authFile.anthropic = creds;
    await writeAuthFile(authFile);

    console.log(chalk.green(`\n  OAuth authentication successful.`));
    return { displayName: creds.display_name ?? 'Claude User' };
  }

  /**
   * Prompt the user to paste the OAuth code from their browser.
   */
  private promptForCode(): Promise<string> {
    return new Promise((resolve, reject) => {
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      rl.question('  Paste code: ', (answer) => {
        rl.close();
        const trimmed = answer.trim();
        if (!trimmed) {
          reject(new Error('No code provided.'));
        } else {
          resolve(trimmed);
        }
      });
    });
  }

  /**
   * Resolve the access token from multiple sources (priority order):
   * 1. ANTHROPIC_API_KEY env var
   * 2. auth.json anthropic credentials (with auto-refresh if expired)
   */
  private async resolveAccessToken(): Promise<string | null> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) return apiKey;

    const authFile = await readAuthFile();
    if (authFile.anthropic?.access_token) {
      // Auto-refresh if token is expired and we have a refresh token
      if (authFile.anthropic.token_expires_at && authFile.anthropic.refresh_token) {
        const nowSec = Math.floor(Date.now() / 1000);
        if (nowSec >= authFile.anthropic.token_expires_at) {
          const refreshed = await this.refreshToken(authFile.anthropic.refresh_token);
          if (refreshed) return refreshed;
        }
      }
      return authFile.anthropic.access_token;
    }

    return null;
  }

  /**
   * Refresh an expired OAuth access token using the refresh token.
   * Updates auth.json with the new tokens. Returns null on failure.
   */
  private async refreshToken(refreshToken: string): Promise<string | null> {
    try {
      const response = await fetch(ANTHROPIC_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: ANTHROPIC_CLIENT_ID,
        }),
      });

      if (!response.ok) return null;

      const data = (await response.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };

      const authFile = await readAuthFile();
      if (authFile.anthropic) {
        authFile.anthropic.access_token = data.access_token;
        if (data.refresh_token) authFile.anthropic.refresh_token = data.refresh_token;
        authFile.anthropic.token_expires_at = data.expires_in
          ? Math.floor(Date.now() / 1000) + data.expires_in
          : undefined;
        await writeAuthFile(authFile);
      }

      return data.access_token;
    } catch {
      return null;
    }
  }

  /**
   * Build request headers. OAuth tokens (sk-ant-oat) require Claude Code-compatible
   * headers; standard API keys use x-api-key.
   */
  private buildHeaders(accessToken: string): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    };

    if (accessToken.startsWith('sk-ant-oat')) {
      // OAuth token — requires Claude Code-compatible request shape
      headers['Authorization'] = `Bearer ${accessToken}`;
      headers['User-Agent'] = 'claude-cli/2.1.7 (external, cli)';
      headers['x-app'] = 'cli';
      headers['anthropic-dangerous-direct-browser-access'] = 'true';
      headers['anthropic-beta'] = 'oauth-2025-04-20,interleaved-thinking-2025-05-14,output-128k-2025-02-19';
    } else {
      // Standard API key
      headers['x-api-key'] = accessToken;
      headers['anthropic-beta'] = 'output-128k-2025-02-19';
    }

    return headers;
  }

  private async normalizeResponse(response: Response): Promise<ChatCompletionResponse> {
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `Anthropic API error (${response.status}): ${body || response.statusText}`,
      );
    }

    const data = (await response.json()) as {
      content?: Array<{ type: string; text?: string; thinking?: string }>;
      usage?: { input_tokens: number; output_tokens: number };
    };

    // Normalize Anthropic response → OpenAI ChatCompletionResponse shape
    const text = data.content?.find((c) => c.type === 'text')?.text ?? '';

    // Extract usage and content types
    let usage: TokenUsage | undefined;
    if (data.usage) {
      const contentTypes = data.content
        ? [...new Set(data.content.map((c) => c.type))]
        : [];
      const thinkingTokens = data.content
        ?.filter((c) => c.type === 'thinking')
        .reduce((sum, c) => sum + (c.thinking?.length ?? 0), 0) ?? 0;

      usage = {
        input_tokens: data.usage.input_tokens,
        output_tokens: data.usage.output_tokens,
        thinking_tokens: thinkingTokens > 0 ? thinkingTokens : undefined,
        total_tokens: data.usage.input_tokens + data.usage.output_tokens,
        content_types: contentTypes.length > 0 ? contentTypes : undefined,
      };
    }

    return {
      choices: [{ message: { content: text } }],
      usage,
    };
  }
}

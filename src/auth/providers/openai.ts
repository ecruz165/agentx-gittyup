import { randomBytes } from 'node:crypto';
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
  generateCodeVerifier,
  generateCodeChallenge,
  waitForCallback,
  openBrowser,
} from '../oauth-pkce.js';
import { CLI_BIN_NAME } from '../../config/branding.js';

// --- OpenAI OAuth constants (matches Codex CLI's registered client) ---
const OPENAI_AUTH_URL = 'https://auth.openai.com/oauth/authorize';
const OPENAI_TOKEN_URL = 'https://auth.openai.com/oauth/token';
const OPENAI_REVOKE_URL = 'https://auth.openai.com/oauth/revoke';
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODELS_URL = 'https://api.openai.com/v1/models';
const OPENAI_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const OPENAI_REDIRECT_PORT = 1455;
const OPENAI_REDIRECT_URI = `http://localhost:${OPENAI_REDIRECT_PORT}/auth/callback`;
const OPENAI_SCOPES = 'openid profile email offline_access';

/** Known OpenAI models for fallback. */
const OPENAI_KNOWN_MODELS: AIModelEntry[] = [
  {
    id: 'gpt-4.1',
    name: 'GPT-4.1',
    description: '1M in / 32K out — best for large docs',
    capabilities: { type: 'chat', limits: { max_prompt_tokens: 1_000_000, max_output_tokens: 32_768 } },
  },
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: '128K in / 16K out — fast, capable',
    capabilities: { type: 'chat', limits: { max_prompt_tokens: 128_000, max_output_tokens: 16_384 } },
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '128K in / 16K out — low cost',
    capabilities: { type: 'chat', limits: { max_prompt_tokens: 128_000, max_output_tokens: 16_384 } },
  },
  {
    id: 'o3-mini',
    name: 'o3-mini',
    description: '200K in / 100K out — reasoning model',
    capabilities: { type: 'chat', limits: { max_prompt_tokens: 200_000, max_output_tokens: 100_000 } },
  },
];

/**
 * OpenAI provider — supports OPENAI_API_KEY env var and OAuth PKCE login.
 *
 * Authentication priority:
 * 1. OPENAI_API_KEY env var (standard API key)
 * 2. auth.json stored credentials (from previous OAuth login, with auto-refresh)
 * 3. OAuth PKCE flow (same flow as OpenAI's Codex CLI)
 */
export class OpenAIProvider implements AIProvider {
  readonly name = 'openai' as const;

  async login(): Promise<{ displayName: string }> {
    // Strategy 1: Check for OPENAI_API_KEY env var
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey) {
      const creds: OAuthCredentials = {
        access_token: apiKey,
        display_name: 'API Key User',
      };
      const authFile = await readAuthFile();
      authFile.active_provider = 'openai';
      authFile.openai = creds;
      await writeAuthFile(authFile);

      console.log(chalk.green('\n  Using OPENAI_API_KEY from environment.'));
      return { displayName: 'API Key User' };
    }

    // Strategy 2: OAuth PKCE flow (same as Codex CLI / OpenCode)
    // Use 32 random bytes for both verifier and state — base64url without
    // truncation produces the 43-char format OpenAI's auth server expects.
    const verifier = randomBytes(32).toString('base64url');
    const challenge = generateCodeChallenge(verifier);
    const state = randomBytes(32).toString('base64url');

    // originator identifies the client in OpenAI's auth session.
    // Codex CLI uses codex_cli_rs, OpenCode uses opencode — we use our brand.
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: OPENAI_CLIENT_ID,
      redirect_uri: OPENAI_REDIRECT_URI,
      scope: OPENAI_SCOPES,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      id_token_add_organizations: 'true',
      codex_cli_simplified_flow: 'true',
      state,
      originator: CLI_BIN_NAME,
    });

    const authorizeUrl = `${OPENAI_AUTH_URL}?${params.toString()}`;

    console.log();
    console.log(chalk.bold('  Login with OpenAI'));
    console.log();
    console.log(`  Opening browser to authorize...`);
    console.log(chalk.dim(`  If the browser doesn't open, visit:`));
    console.log(chalk.cyan(`  ${authorizeUrl}`));
    console.log();

    openBrowser(authorizeUrl);

    const callbackResult = await waitForCallback(OPENAI_REDIRECT_PORT);

    if (callbackResult.state !== state) {
      throw new Error('OAuth state mismatch — possible CSRF attack.');
    }

    // Exchange code for tokens (OAuth spec: application/x-www-form-urlencoded)
    const tokenBody = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: OPENAI_CLIENT_ID,
      code: callbackResult.code,
      redirect_uri: OPENAI_REDIRECT_URI,
      code_verifier: verifier,
    });

    const tokenResponse = await fetch(OPENAI_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenBody.toString(),
    });

    if (!tokenResponse.ok) {
      const body = await tokenResponse.text().catch(() => '');
      throw new Error(`OpenAI token exchange failed (${tokenResponse.status}): ${body}`);
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
      display_name: 'OpenAI User',
    };

    const authFile = await readAuthFile();
    authFile.active_provider = 'openai';
    authFile.openai = creds;
    await writeAuthFile(authFile);

    console.log(chalk.green(`\n  OAuth authentication successful.`));
    return { displayName: creds.display_name ?? 'OpenAI User' };
  }

  async resolveAuth(): Promise<{ source: string } | null> {
    if (process.env.OPENAI_API_KEY) {
      return { source: 'env:OPENAI_API_KEY' };
    }

    const authFile = await readAuthFile();
    if (authFile.openai?.access_token) {
      return { source: 'auth.json (openai)' };
    }
    return null;
  }

  async callAI(
    messages: ChatCompletionMessage[],
    model: string,
  ): Promise<ChatCompletionResponse> {
    const accessToken = await this.resolveAccessToken();

    if (!accessToken) {
      throw new Error('OpenAI: Not authenticated. Run "auth login --provider openai" first.');
    }

    const response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ model, messages, stream: false }),
    });

    // Handle rate limiting
    if (response.status === 429) {
      const retryAfter = response.headers.get('retry-after');
      const waitSeconds = retryAfter ? parseInt(retryAfter, 10) : 10;
      await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
      const retryResponse = await fetch(OPENAI_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ model, messages, stream: false }),
      });
      if (!retryResponse.ok) {
        const body = await retryResponse.text().catch(() => '');
        throw new Error(
          `OpenAI API error (${retryResponse.status}): ${body || retryResponse.statusText}`,
        );
      }
      return this.normalizeResponse(retryResponse);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `OpenAI API error (${response.status}): ${body || response.statusText}`,
      );
    }

    return this.normalizeResponse(response);
  }

  /**
   * Normalize OpenAI response and extract token usage.
   * Maps prompt_tokens → input_tokens, completion_tokens → output_tokens.
   */
  private async normalizeResponse(response: Response): Promise<ChatCompletionResponse> {
    const data = (await response.json()) as ChatCompletionResponse & {
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };

    let usage: TokenUsage | undefined;
    if (data.usage) {
      usage = {
        input_tokens: data.usage.prompt_tokens,
        output_tokens: data.usage.completion_tokens,
        total_tokens: data.usage.total_tokens,
      };
    }

    return {
      choices: data.choices,
      usage,
    };
  }

  async listModels(): Promise<AIModelEntry[] | null> {
    const accessToken = await this.resolveAccessToken();
    if (!accessToken) return null;

    try {
      const response = await fetch(OPENAI_MODELS_URL, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        return OPENAI_KNOWN_MODELS;
      }

      const data = (await response.json()) as { data?: Array<{ id: string }> };
      if (Array.isArray(data.data) && data.data.length > 0) {
        // Filter to chat models (gpt-*, o1*, o3*, codex*)
        const chatModels = data.data.filter(
          (m) =>
            m.id.startsWith('gpt-') ||
            m.id.startsWith('o1') ||
            m.id.startsWith('o3') ||
            m.id.startsWith('codex'),
        );
        return chatModels.map((m) => ({
          id: m.id,
          name: m.id,
        }));
      }
      return OPENAI_KNOWN_MODELS;
    } catch {
      return OPENAI_KNOWN_MODELS;
    }
  }

  async logout(): Promise<void> {
    const authFile = await readAuthFile();
    const creds = authFile.openai;

    // Attempt token revocation if we have a refresh token
    if (creds?.refresh_token) {
      try {
        await fetch(OPENAI_REVOKE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: OPENAI_CLIENT_ID,
            token: creds.refresh_token,
          }).toString(),
        });
      } catch {
        // Best effort — continue with local cleanup even if revocation fails
      }
    }

    delete authFile.openai;
    await writeAuthFile(authFile);
  }

  // --- Internal helpers ---

  /**
   * Resolve the access token from multiple sources (priority order):
   * 1. OPENAI_API_KEY env var
   * 2. auth.json openai credentials (with auto-refresh if expired)
   */
  private async resolveAccessToken(): Promise<string | null> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey) return apiKey;

    const authFile = await readAuthFile();
    if (authFile.openai?.access_token) {
      // Auto-refresh if token is expired and we have a refresh token
      if (authFile.openai.token_expires_at && authFile.openai.refresh_token) {
        const nowSec = Math.floor(Date.now() / 1000);
        const bufferSec = 5 * 60; // 5 minutes before expiry
        if (nowSec >= authFile.openai.token_expires_at - bufferSec) {
          const refreshed = await this.refreshToken(authFile.openai.refresh_token);
          if (refreshed) return refreshed;
          // Refresh failed — try stored token anyway (might still work)
        }
      }
      return authFile.openai.access_token;
    }

    return null;
  }

  /**
   * Refresh an expired OAuth access token using the refresh token.
   * Updates auth.json with the new tokens. Returns null on failure.
   */
  private async refreshToken(refreshToken: string): Promise<string | null> {
    try {
      const response = await fetch(OPENAI_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: OPENAI_CLIENT_ID,
        }).toString(),
      });

      if (!response.ok) return null;

      const data = (await response.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };

      const authFile = await readAuthFile();
      if (authFile.openai) {
        authFile.openai.access_token = data.access_token;
        if (data.refresh_token) authFile.openai.refresh_token = data.refresh_token;
        authFile.openai.token_expires_at = data.expires_in
          ? Math.floor(Date.now() / 1000) + data.expires_in
          : undefined;
        await writeAuthFile(authFile);
      }

      return data.access_token;
    } catch {
      return null;
    }
  }
}

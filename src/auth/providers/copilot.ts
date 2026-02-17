import type { AIProvider, AIModelEntry } from '../provider.js';
import type {
  ChatCompletionMessage,
  ChatCompletionResponse,
  CopilotCredentials,
  CopilotTokenResponse,
  TokenUsage,
} from '../types.js';
import {
  COPILOT_TOKEN_URL,
  COPILOT_CHAT_URL,
  COPILOT_MODELS_URL,
  EDITOR_VERSION,
  TOKEN_REFRESH_THRESHOLD,
} from '../types.js';
import { login as deviceFlowLogin } from '../device-flow.js';
import { readAuthFile, writeAuthFile } from '../token-manager.js';

/**
 * GitHub Copilot provider — wraps the existing device-flow + token-manager logic
 * behind the AIProvider interface.
 */
export class CopilotProvider implements AIProvider {
  readonly name = 'copilot' as const;

  async login(): Promise<{ displayName: string }> {
    const result = await deviceFlowLogin();

    // Persist under the new multi-provider structure
    const authFile = await readAuthFile();
    authFile.active_provider = 'copilot';
    // The device flow already wrote credentials via writeAuthCredentials,
    // but we also update the new structure
    authFile.copilot = {
      github_token: (await this.resolveGitHubToken())?.token ?? '',
      username: result.username,
    };
    await writeAuthFile(authFile);

    return { displayName: `@${result.username}` };
  }

  async resolveAuth(): Promise<{ source: string } | null> {
    const source = await this.resolveGitHubToken();
    return source ? { source: source.source } : null;
  }

  async callAI(
    messages: ChatCompletionMessage[],
    model: string,
  ): Promise<ChatCompletionResponse> {
    const tokenSource = await this.resolveGitHubToken();
    if (!tokenSource) {
      throw new Error('Copilot: Not authenticated. Run "auth login --provider copilot" first.');
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

    let copilotToken = await this.getCopilotToken(tokenSource.token);
    let response = await doRequest(copilotToken);

    // Reactive retry on 401
    if (response.status === 401) {
      await this.invalidateCopilotToken();
      copilotToken = await this.getCopilotToken(tokenSource.token);
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

    return this.normalizeResponse(response);
  }

  /**
   * Normalize Copilot response and extract token usage.
   * Copilot uses OpenAI-compatible format (prompt_tokens, completion_tokens).
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
    const tokenSource = await this.resolveGitHubToken();
    if (!tokenSource) return null;

    try {
      const copilotToken = await this.getCopilotToken(tokenSource.token);
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

      const data = (await response.json()) as { data?: AIModelEntry[] };
      return Array.isArray(data.data) ? data.data : null;
    } catch {
      return null;
    }
  }

  async logout(): Promise<void> {
    const authFile = await readAuthFile();
    delete authFile.copilot;
    if (authFile.active_provider === 'copilot') {
      authFile.active_provider = 'copilot'; // reset to default
    }
    await writeAuthFile(authFile);
  }

  // --- Internal helpers ---

  private async resolveGitHubToken(): Promise<{ token: string; source: string } | null> {
    const copilotEnv = process.env.COPILOT_GITHUB_TOKEN;
    if (copilotEnv) {
      return { token: copilotEnv, source: 'env:COPILOT_GITHUB_TOKEN' };
    }

    const githubEnv = process.env.GITHUB_TOKEN;
    if (githubEnv) {
      return { token: githubEnv, source: 'env:GITHUB_TOKEN' };
    }

    const authFile = await readAuthFile();
    if (authFile.copilot?.github_token) {
      return { token: authFile.copilot.github_token, source: 'auth.json' };
    }

    return null;
  }

  private async getCopilotToken(githubToken: string): Promise<string> {
    const authFile = await readAuthFile();
    const creds = authFile.copilot;

    if (creds?.copilot_token && creds.copilot_token_expires_at) {
      const now = Math.floor(Date.now() / 1000);
      const remaining = creds.copilot_token_expires_at - now;
      if (remaining > TOKEN_REFRESH_THRESHOLD) {
        return creds.copilot_token;
      }
    }

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

    // Cache in auth file
    const updated = await readAuthFile();
    updated.copilot = {
      ...(updated.copilot ?? { github_token: githubToken }),
      github_token: githubToken,
      copilot_token: data.token,
      copilot_token_expires_at: data.expires_at,
    };
    await writeAuthFile(updated);

    return data.token;
  }

  private async invalidateCopilotToken(): Promise<void> {
    const authFile = await readAuthFile();
    if (authFile.copilot) {
      delete authFile.copilot.copilot_token;
      delete authFile.copilot.copilot_token_expires_at;
      await writeAuthFile(authFile);
    }
  }
}

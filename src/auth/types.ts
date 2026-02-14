import { z } from 'zod';

// ─── Constants ──────────────────────────────────────────────────────

/** GitHub OAuth App client ID used by Copilot integrations (VS Code, OpenCode, etc.) */
export const COPILOT_CLIENT_ID = 'Iv1.b507a08c87ecfe98';

export const GITHUB_DEVICE_CODE_URL = 'https://github.com/login/device/code';
export const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
export const GITHUB_USER_URL = 'https://api.github.com/user';
export const COPILOT_TOKEN_URL = 'https://api.github.com/copilot_internal/v2/token';
export const COPILOT_CHAT_URL = 'https://api.githubcopilot.com/chat/completions';
export const COPILOT_MODELS_URL = 'https://api.githubcopilot.com/models';

export const EDITOR_VERSION = 'vscode/1.100.0';

/** Proactive refresh threshold in seconds (5 minutes). */
export const TOKEN_REFRESH_THRESHOLD = 5 * 60;

/** Maximum polling timeout for device flow in milliseconds (15 minutes). */
export const DEVICE_FLOW_TIMEOUT_MS = 15 * 60 * 1000;

// ─── Zod Schemas ────────────────────────────────────────────────────

export const AuthCredentialsSchema = z.object({
  github_token: z.string(),
  copilot_token: z.string().optional(),
  copilot_token_expires_at: z.number().optional(),
  username: z.string().optional(),
});

export type AuthCredentials = z.infer<typeof AuthCredentialsSchema>;

// ─── Interfaces ─────────────────────────────────────────────────────

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface CopilotTokenResponse {
  token: string;
  expires_at: number;
}

export interface ChatCompletionMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

export interface TokenSource {
  token: string;
  source: 'env:GITHUB_TOKEN' | 'env:GH_TOKEN' | 'gh-cli' | 'git-credential' | 'auth.json';
}

export interface CopilotModelEntry {
  id: string;
  name: string;
  version: string;
  capabilities?: {
    type?: string;
    limits?: {
      max_prompt_tokens?: number;
      max_output_tokens?: number;
    };
  };
}

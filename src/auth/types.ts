import { z } from 'zod';

// --- Constants ---

export const COPILOT_CLIENT_ID = 'Iv1.b507a08c87ecfe98';

export const GITHUB_DEVICE_CODE_URL = 'https://github.com/login/device/code';
export const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
export const GITHUB_USER_URL = 'https://api.github.com/user';
export const COPILOT_TOKEN_URL = 'https://api.github.com/copilot_internal/v2/token';
export const COPILOT_CHAT_URL = 'https://api.githubcopilot.com/chat/completions';
export const COPILOT_MODELS_URL = 'https://api.githubcopilot.com/models';

export const EDITOR_VERSION = 'AgentX-Gittyup/0.1.0';

/** Proactive refresh threshold in seconds (5 minutes). */
export const TOKEN_REFRESH_THRESHOLD = 5 * 60;

/** Maximum polling timeout for device flow in milliseconds (15 minutes). */
export const DEVICE_FLOW_TIMEOUT_MS = 15 * 60 * 1000;

export const COPILOT_MODELS = {
  default: ['gpt-4o', 'gpt-4.1'],
  pro_plus: ['gpt-4o', 'gpt-4.1', 'o1', 'o3-mini', 'claude-sonnet-4', 'claude-opus-4'],
} as const;

// --- Zod schemas ---

/** Legacy flat format (pre-multi-provider). Kept for auto-migration. */
export const AuthCredentialsSchema = z.object({
  github_token: z.string(),
  copilot_token: z.string().optional(),
  copilot_token_expires_at: z.number().optional(),
  username: z.string().optional(),
});

export type AuthCredentials = z.infer<typeof AuthCredentialsSchema>;

// --- Multi-provider auth file schemas ---

/** Copilot-specific credentials stored under the "copilot" key. */
export const CopilotCredentialsSchema = z.object({
  github_token: z.string(),
  copilot_token: z.string().optional(),
  copilot_token_expires_at: z.number().optional(),
  username: z.string().optional(),
});

export type CopilotCredentials = z.infer<typeof CopilotCredentialsSchema>;

/** OAuth-based credentials for Anthropic / OpenAI. */
export const OAuthCredentialsSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  token_expires_at: z.number().optional(),
  display_name: z.string().optional(),
});

export type OAuthCredentials = z.infer<typeof OAuthCredentialsSchema>;

/** New multi-provider auth.json structure. */
export const AuthFileSchema = z.object({
  active_provider: z.enum(['copilot', 'anthropic', 'openai']).default('copilot'),
  copilot: CopilotCredentialsSchema.optional(),
  anthropic: OAuthCredentialsSchema.optional(),
  openai: OAuthCredentialsSchema.optional(),
});

export type AuthFile = z.infer<typeof AuthFileSchema>;

// --- Interfaces ---

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

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  thinking_tokens?: number;
  total_tokens: number;
  content_types?: string[];
}

export interface ChatCompletionResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
  usage?: TokenUsage;
}

export interface TokenSource {
  token: string;
  source: 'env:COPILOT_GITHUB_TOKEN' | 'env:GITHUB_TOKEN' | 'auth.json';
}

/** Shape returned by the Copilot /models endpoint. */
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

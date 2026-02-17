import { z } from 'zod';
import type { ChatCompletionMessage, ChatCompletionResponse } from './types.js';

// --- Provider names (single source of truth) ---

export const AI_PROVIDERS = ['copilot', 'anthropic', 'openai'] as const;

export const AIProviderNameSchema = z.enum(AI_PROVIDERS);

export type AIProviderName = (typeof AI_PROVIDERS)[number];

// --- Model entry ---

export interface AIModelEntry {
  id: string;
  name: string;
  description?: string;
  capabilities?: {
    type?: string;
    limits?: {
      max_prompt_tokens?: number;
      max_output_tokens?: number;
    };
  };
}

// --- Provider interface ---

export interface AIProvider {
  readonly name: AIProviderName;

  /** Run the OAuth login flow for this provider. Returns display name on success.
   *  When force is true, skip cached credentials and go straight to interactive auth. */
  login(opts?: { force?: boolean }): Promise<{ displayName: string }>;

  /** Check if valid credentials exist. Returns source info or null. */
  resolveAuth(): Promise<{ source: string } | null>;

  /** Send a chat completion request. */
  callAI(messages: ChatCompletionMessage[], model: string): Promise<ChatCompletionResponse>;

  /** List available models for the authenticated user. Returns null if unavailable. */
  listModels(): Promise<AIModelEntry[] | null>;

  /** Revoke / delete stored credentials for this provider. */
  logout(): Promise<void>;
}

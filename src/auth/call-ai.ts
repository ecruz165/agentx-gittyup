import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import chalk from 'chalk';
import type { ChatCompletionMessage, ChatCompletionResponse } from './types.js';
import type { AIProviderName } from './provider.js';
import { getProvider } from './provider-registry.js';
import { readAuthFile } from './token-manager.js';
import { getGittyupHome } from '../utils/home.js';

/**
 * Unified AI call dispatcher. Resolves the provider and calls its AI endpoint.
 * Logs provider/model info and token usage to both console and a JSONL file.
 *
 * @param messages - Chat completion messages
 * @param model - Model identifier (e.g. 'gpt-4o', 'claude-sonnet-4')
 * @param providerName - Explicit provider override; if omitted, reads from auth.json active_provider
 * @param caller - Identifies the call site (e.g. 'parser', 'scorer', 'skills', 'expander')
 */
export async function callAI(
  messages: ChatCompletionMessage[],
  model: string,
  providerName?: AIProviderName,
  caller?: string,
): Promise<ChatCompletionResponse> {
  const name = providerName ?? (await readAuthFile()).active_provider;
  const provider = getProvider(name);

  // Pre-call console output
  console.error(chalk.dim(`  [${name}:${model}] sending ${messages.length} message(s)...`));

  const startMs = Date.now();
  const response = await provider.callAI(messages, model);
  const latencyMs = Date.now() - startMs;

  // Post-call console output
  const usage = response.usage;
  if (usage) {
    const latencyStr = latencyMs >= 1000
      ? `${(latencyMs / 1000).toFixed(1)}s`
      : `${latencyMs}ms`;
    console.error(chalk.dim(`  [${name}:${model}] ${usage.input_tokens} in / ${usage.output_tokens} out (${latencyStr})`));
  }

  // Append to JSONL log (best-effort, never throws)
  logUsage(name, model, messages.length, usage, latencyMs, caller);

  return response;
}

/**
 * Append a usage entry to the JSONL log file.
 * Failures are silently ignored — telemetry must never break the caller.
 */
function logUsage(
  provider: string,
  model: string,
  messageCount: number,
  usage: ChatCompletionResponse['usage'],
  latencyMs: number,
  caller?: string,
): void {
  try {
    const logPath = `${getGittyupHome()}/ai-usage.jsonl`;

    // Ensure directory exists
    const dir = dirname(logPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const entry = {
      timestamp: new Date().toISOString(),
      provider,
      model,
      caller: caller ?? 'unknown',
      input_tokens: usage?.input_tokens ?? 0,
      output_tokens: usage?.output_tokens ?? 0,
      thinking_tokens: usage?.thinking_tokens ?? 0,
      total_tokens: usage?.total_tokens ?? 0,
      latency_ms: latencyMs,
      status: 'ok',
      content_types: usage?.content_types ?? ['text'],
    };

    appendFileSync(logPath, JSON.stringify(entry) + '\n');
  } catch {
    // Telemetry must never break the caller
  }
}

/**
 * Check whether the active (or specified) provider has valid credentials.
 * Drop-in replacement for resolveGitHubToken() — works across all providers.
 *
 * @returns `{ source: string }` if authenticated, `null` otherwise.
 */
export async function resolveActiveAuth(
  providerName?: AIProviderName,
): Promise<{ source: string } | null> {
  const name = providerName ?? (await readAuthFile()).active_provider;
  const provider = getProvider(name);
  return provider.resolveAuth();
}

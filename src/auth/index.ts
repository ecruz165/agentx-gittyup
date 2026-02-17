// --- Legacy exports (kept for backward compatibility) ---
export { login, requestDeviceCode, pollForToken } from './device-flow.js';

export {
  readAuthCredentials,
  writeAuthCredentials,
  deleteAuthCredentials,
  resolveGitHubToken,
  requireGitHubToken,
  getCopilotToken,
  callCopilot,
  fetchCopilotModels,
  readAuthFile,
  writeAuthFile,
  printAuthStatus,
} from './token-manager.js';

// --- Multi-provider exports ---
export { callAI, resolveActiveAuth } from './call-ai.js';
export { getProvider, clearProviders } from './provider-registry.js';

export type { AIProvider, AIProviderName, AIModelEntry } from './provider.js';
export { AI_PROVIDERS, AIProviderNameSchema } from './provider.js';

// --- Types ---
export type {
  AuthCredentials,
  AuthFile,
  CopilotCredentials,
  OAuthCredentials,
  DeviceCodeResponse,
  CopilotTokenResponse,
  ChatCompletionMessage,
  ChatCompletionResponse,
  TokenSource,
  CopilotModelEntry,
} from './types.js';

export {
  AuthCredentialsSchema,
  AuthFileSchema,
  CopilotCredentialsSchema,
  OAuthCredentialsSchema,
  COPILOT_CLIENT_ID,
  COPILOT_MODELS,
  EDITOR_VERSION,
} from './types.js';

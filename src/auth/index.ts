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
  printAuthStatus,
} from './token-manager.js';

export type {
  AuthCredentials,
  DeviceCodeResponse,
  CopilotTokenResponse,
  ChatCompletionMessage,
  ChatCompletionResponse,
  TokenSource,
  CopilotModelEntry,
} from './types.js';

export {
  AuthCredentialsSchema,
  COPILOT_CLIENT_ID,
  EDITOR_VERSION,
} from './types.js';

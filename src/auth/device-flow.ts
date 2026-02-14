import chalk from 'chalk';
import {
  COPILOT_CLIENT_ID,
  GITHUB_DEVICE_CODE_URL,
  GITHUB_TOKEN_URL,
  GITHUB_USER_URL,
  DEVICE_FLOW_TIMEOUT_MS,
  type DeviceCodeResponse,
} from './types.js';
import { writeAuthCredentials } from './token-manager.js';

/**
 * Request a device code from GitHub for the OAuth device flow.
 */
export async function requestDeviceCode(): Promise<DeviceCodeResponse> {
  const clientId = process.env.GITHUB_COPILOT_CLIENT_ID ?? COPILOT_CLIENT_ID;

  const response = await fetch(GITHUB_DEVICE_CODE_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: clientId,
      scope: 'read:user',
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Failed to request device code (${response.status}): ${body || response.statusText}`);
  }

  return (await response.json()) as DeviceCodeResponse;
}

/**
 * Poll GitHub for the OAuth token after the user has entered the device code.
 * Handles: authorization_pending, slow_down, expired_token, access_denied.
 */
export async function pollForToken(
  deviceCode: string,
  interval: number,
  expiresIn: number,
): Promise<string> {
  const clientId = process.env.GITHUB_COPILOT_CLIENT_ID ?? COPILOT_CLIENT_ID;
  const deadline = Date.now() + Math.min(expiresIn * 1000, DEVICE_FLOW_TIMEOUT_MS);
  let pollInterval = interval;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollInterval * 1000));

    const response = await fetch(GITHUB_TOKEN_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });

    const data = (await response.json()) as Record<string, string>;

    if (data.access_token) {
      return data.access_token;
    }

    switch (data.error) {
      case 'authorization_pending':
        continue;
      case 'slow_down':
        pollInterval += 5;
        continue;
      case 'expired_token':
        throw new Error('Device code expired. Please try again.');
      case 'access_denied':
        throw new Error('Authorization denied by user.');
      default:
        if (data.error) {
          throw new Error(`OAuth error: ${data.error} — ${data.error_description ?? ''}`);
        }
    }
  }

  throw new Error('Authorization timed out. Please try again.');
}

/**
 * Fetch the authenticated user's GitHub username.
 */
async function fetchUsername(githubToken: string): Promise<string> {
  const response = await fetch(GITHUB_USER_URL, {
    headers: {
      Authorization: `token ${githubToken}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) return 'unknown';

  const data = (await response.json()) as { login?: string };
  return data.login ?? 'unknown';
}

/**
 * Run the full OAuth device flow login:
 * 1. Request device code
 * 2. Display user_code and verification_uri
 * 3. Poll for token
 * 4. Fetch username
 * 5. Store credentials
 */
export async function login(): Promise<{ username: string }> {
  const deviceCode = await requestDeviceCode();

  console.log();
  console.log(chalk.bold('  Login with GitHub Copilot'));
  console.log();
  console.log(`  Open: ${chalk.cyan(deviceCode.verification_uri)}`);
  console.log(`  Enter code: ${chalk.bold.yellow(deviceCode.user_code)}`);
  console.log();
  console.log(chalk.dim('  Waiting for authorization...'));

  const githubToken = await pollForToken(
    deviceCode.device_code,
    deviceCode.interval,
    deviceCode.expires_in,
  );

  const username = await fetchUsername(githubToken);

  await writeAuthCredentials({
    github_token: githubToken,
    username,
  });

  return { username };
}

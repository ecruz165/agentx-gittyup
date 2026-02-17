import { randomBytes, createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { execFile } from 'node:child_process';
import { platform } from 'node:os';

/**
 * Generate a cryptographically random PKCE code verifier (43-128 chars, RFC 7636).
 */
export function generateCodeVerifier(length = 64): string {
  return randomBytes(length).toString('base64url').slice(0, length);
}

/**
 * Derive the S256 code challenge from a code verifier.
 */
export function generateCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/**
 * Open a URL in the system's default browser.
 * Uses execFile (not exec) to avoid shell injection.
 */
export function openBrowser(url: string): void {
  const cmd =
    platform() === 'darwin'
      ? 'open'
      : platform() === 'win32'
        ? 'start'
        : 'xdg-open';

  execFile(cmd, [url]);
}

/**
 * Start a temporary local HTTP server to capture an OAuth redirect callback.
 * Returns the authorization code from the redirect's query string.
 * Only responds to the expected callback path (default: /auth/callback);
 * ignores unrelated browser requests (favicon, etc.) so they don't
 * consume the single-use handler prematurely.
 */
export function waitForCallback(
  port: number,
  callbackPath = '/auth/callback',
): Promise<{ code: string; state?: string }> {
  return new Promise((resolve, reject) => {
    let server: Server;

    const timeout = setTimeout(() => {
      server?.close();
      reject(new Error('OAuth callback timed out (5 minutes).'));
    }, 5 * 60 * 1000);

    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${port}`);

      // Ignore requests that aren't the OAuth callback (e.g. /favicon.ico)
      if (url.pathname !== callbackPath) {
        res.writeHead(404);
        res.end();
        return;
      }

      clearTimeout(timeout);

      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      const state = url.searchParams.get('state') ?? undefined;

      if (error) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body><h2>Authorization failed.</h2><p>You can close this tab.</p></body></html>');
        server.close();
        reject(new Error(`OAuth error: ${error} — ${url.searchParams.get('error_description') ?? ''}`));
        return;
      }

      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<html><body><h2>Missing authorization code.</h2></body></html>');
        server.close();
        reject(new Error('OAuth callback missing authorization code.'));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body><h2>Authorization successful!</h2><p>You can close this tab and return to the terminal.</p></body></html>');
      server.close();
      resolve({ code, state });
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timeout);
      if (err.code === 'EADDRINUSE') {
        reject(new Error(
          `Port ${port} is already in use. Kill the process with: lsof -ti :${port} | xargs kill -9`,
        ));
      } else {
        reject(err);
      }
    });

    // Listen on all interfaces (IPv4 + IPv6) so the callback works
    // regardless of whether the browser resolves localhost to 127.0.0.1 or ::1.
    server.listen(port);
  });
}

import { describe, it, expect } from 'vitest';
import {
  ManifestSchema,
  RepoConfigSchema,
  AiModeSchema,
  ManifestSettingsSchema,
} from '../../src/config/schema.js';

describe('RepoConfig schema', () => {
  it('validates a minimal repo', () => {
    const result = RepoConfigSchema.safeParse({
      name: 'web-app',
      path: './web-app',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.remote).toBe('origin');
      expect(result.data.branches).toEqual({ dev: 'develop', staging: 'staging', prod: 'main' });
    }
  });

  it('validates a full repo config', () => {
    const result = RepoConfigSchema.safeParse({
      name: 'api-server',
      path: './api-server',
      remote: 'upstream',
      url: 'https://github.com/org/api-server.git',
      branches: { dev: 'develop', staging: 'release', prod: 'main' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing name', () => {
    const result = RepoConfigSchema.safeParse({ path: './app' });
    expect(result.success).toBe(false);
  });
});

describe('AiMode schema', () => {
  it('accepts valid modes', () => {
    expect(AiModeSchema.safeParse('auto').success).toBe(true);
    expect(AiModeSchema.safeParse('suggest').success).toBe(true);
    expect(AiModeSchema.safeParse('manual').success).toBe(true);
  });

  it('rejects invalid mode', () => {
    expect(AiModeSchema.safeParse('turbo').success).toBe(false);
  });
});

describe('ManifestSettings schema', () => {
  it('applies defaults', () => {
    const result = ManifestSettingsSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ai_mode).toBe('suggest');
      expect(result.data.github.token_env).toBe('GITHUB_TOKEN');
      expect(result.data.conflict_branch_prefix).toBe('conflict-resolution');
    }
  });
});

describe('Manifest schema', () => {
  it('validates empty manifest with defaults', () => {
    const result = ManifestSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.workspace).toBe('.');
      expect(result.data.groups).toEqual({});
      expect(result.data.settings.ai_mode).toBe('suggest');
    }
  });

  it('validates a full manifest', () => {
    const result = ManifestSchema.safeParse({
      workspace: '~/projects',
      groups: {
        frontend: {
          description: 'Client apps',
          repos: [
            { name: 'web-app', path: './web-app', remote: 'origin', branches: { dev: 'develop', prod: 'main' } },
          ],
        },
        services: {
          repos: [
            { name: 'api', path: './api', branches: { dev: 'dev' } },
          ],
        },
      },
      settings: {
        ai_mode: 'auto',
        github: { token_env: 'GH_TOKEN', default_org: 'myorg' },
        conflict_branch_prefix: 'fix',
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.groups.frontend.repos).toHaveLength(1);
      expect(result.data.settings.ai_mode).toBe('auto');
    }
  });
});

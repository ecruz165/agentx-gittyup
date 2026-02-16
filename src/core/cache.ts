import { readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import chalk from 'chalk';
import { APP_APP_CACHE_DIR } from '../config/branding.js';
const DEFAULT_TTL_MS = 5 * 60 * 1000;

interface CacheEntry<T> {
  key: string;
  command: string;
  args: string[];
  timestamp: number;
  expiresAt: number;
  data: T;
}

/**
 * File-based CLI result cache with configurable TTL.
 * Cache is keyed on a SHA-256 hash of command + args.
 * Stored under APP_CACHE_DIR (see branding.ts).
 */
export class CliCache {
  private cacheDir: string;
  private ttlMs: number;

  constructor(ttlMs = DEFAULT_TTL_MS) {
    this.cacheDir = APP_CACHE_DIR;
    this.ttlMs = ttlMs;
    if (!existsSync(this.cacheDir)) mkdirSync(this.cacheDir, { recursive: true });
  }

  /** Build a deterministic cache key from command name and args. */
  static buildKey(command: string, args: Record<string, unknown>): string {
    const normalized = JSON.stringify({ command, ...sortKeys(args) }, null, 0);
    return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
  }

  private filePath(key: string): string {
    return join(this.cacheDir, `${key}.json`);
  }

  get<T>(key: string): { hit: true; data: T; ageMs: number } | { hit: false } {
    const fp = this.filePath(key);
    if (!existsSync(fp)) return { hit: false };

    try {
      const entry = JSON.parse(readFileSync(fp, 'utf-8')) as CacheEntry<T>;
      const now = Date.now();
      if (now > entry.expiresAt) { unlinkSync(fp); return { hit: false }; }
      return { hit: true, data: entry.data, ageMs: now - entry.timestamp };
    } catch {
      try { unlinkSync(fp); } catch {}
      return { hit: false };
    }
  }

  set<T>(key: string, data: T, meta: { command: string; args: string[] }): void {
    const now = Date.now();
    const entry: CacheEntry<T> = {
      key, command: meta.command, args: meta.args,
      timestamp: now, expiresAt: now + this.ttlMs, data,
    };
    writeFileSync(this.filePath(key), JSON.stringify(entry, null, 2), 'utf-8');
  }

  /** Remove expired entries. Returns count removed. */
  prune(): number {
    let removed = 0;
    if (!existsSync(this.cacheDir)) return 0;
    const now = Date.now();
    for (const file of readdirSync(this.cacheDir)) {
      if (!file.endsWith('.json')) continue;
      const fp = join(this.cacheDir, file);
      try {
        const entry = JSON.parse(readFileSync(fp, 'utf-8')) as CacheEntry<unknown>;
        if (now > entry.expiresAt) { unlinkSync(fp); removed++; }
      } catch { unlinkSync(fp); removed++; }
    }
    return removed;
  }

  /** Clear all cache entries. Returns count removed. */
  clear(): number {
    let removed = 0;
    if (!existsSync(this.cacheDir)) return 0;
    for (const file of readdirSync(this.cacheDir)) {
      if (!file.endsWith('.json')) continue;
      unlinkSync(join(this.cacheDir, file));
      removed++;
    }
    return removed;
  }

  /** Print a notice that the result came from cache. */
  static printCacheNotice(ageMs: number): void {
    const ageSec = Math.floor(ageMs / 1000);
    const remaining = Math.max(0, 300 - ageSec);
    console.log(chalk.dim(`  ⚡ Cached result (${ageSec}s ago, expires in ${remaining}s). Use -f to force refresh.\n`));
  }
}

function sortKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    if (obj[key] !== undefined && obj[key] !== null && obj[key] !== false) sorted[key] = obj[key];
  }
  return sorted;
}

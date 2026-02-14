import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import yaml from 'js-yaml';
import { ManifestSchema } from './schema.js';
import type { Manifest, RepoConfig, RepoGroup } from './schema.js';

const DEFAULT_MANIFEST_NAME = 'gittyup.yaml';

const DEFAULT_PR_TEMPLATE = [
  '## {{operation}} from `{{source_branch}}` → `{{target_branch}}`',
  '',
  '**Repo:** {{repo_name}}',
  '**Operation:** {{operation}}',
  '**Commits:** {{commit_count}}',
  '',
  '---',
  '_Created by [gittyup](https://github.com/ecruz165/gittyup)_',
].join('\n');

/**
 * Manages the gittyup.yaml manifest file.
 * Handles loading, validation (via Zod), saving, and repo/group CRUD.
 */
export class ManifestManager {
  private manifest: Manifest;
  private filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath ?? this.findManifest();
    this.manifest = this.load();
  }

  // ─── Discovery ─────────────────────────────────────────────────────

  private findManifest(): string {
    let dir = process.cwd();
    while (true) {
      const candidate = join(dir, DEFAULT_MANIFEST_NAME);
      if (existsSync(candidate)) return candidate;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return join(process.cwd(), DEFAULT_MANIFEST_NAME);
  }

  // ─── Load / Save ──────────────────────────────────────────────────

  private load(): Manifest {
    if (!existsSync(this.filePath)) {
      return ManifestSchema.parse({
        settings: { pr_template: DEFAULT_PR_TEMPLATE },
      });
    }
    const raw = readFileSync(this.filePath, 'utf-8');
    const parsed = yaml.load(raw);
    return ManifestSchema.parse(parsed);
  }

  /** Write the manifest back to disk as YAML. */
  save(): void {
    const content = yaml.dump(this.manifest, {
      indent: 2,
      lineWidth: 100,
      noRefs: true,
    });
    writeFileSync(this.filePath, content, 'utf-8');
  }

  get data(): Manifest {
    return this.manifest;
  }

  get manifestPath(): string {
    return this.filePath;
  }

  // ─── Init ─────────────────────────────────────────────────────────

  /** Create a new manifest file. Throws if one already exists. */
  static init(dir?: string): ManifestManager {
    const targetDir = dir ?? process.cwd();
    const filePath = join(targetDir, DEFAULT_MANIFEST_NAME);

    if (existsSync(filePath)) {
      throw new Error(`Manifest already exists at ${filePath}`);
    }

    const manifest = ManifestSchema.parse({
      workspace: targetDir,
      settings: { pr_template: DEFAULT_PR_TEMPLATE },
    });

    const content = yaml.dump(manifest, { indent: 2, lineWidth: 100 });
    writeFileSync(filePath, content, 'utf-8');

    return new ManifestManager(filePath);
  }

  // ─── Workspace Resolution ─────────────────────────────────────────

  /** Resolve a repo path relative to the workspace root. */
  resolveRepoPath(repoPath: string): string {
    if (isAbsolute(repoPath)) return repoPath;
    const ws = this.manifest.workspace;
    const base = ws.startsWith('~')
      ? ws.replace('~', homedir())
      : isAbsolute(ws)
        ? ws
        : resolve(dirname(this.filePath), ws);
    return resolve(base, repoPath);
  }

  // ─── Repo Management ──────────────────────────────────────────────

  /** Add a repo to a group. Creates the group if it doesn't exist. */
  addRepo(groupName: string, repo: RepoConfig, groupDescription?: string): void {
    if (!this.manifest.groups[groupName]) {
      this.manifest.groups[groupName] = { repos: [], description: groupDescription };
    }
    const group = this.manifest.groups[groupName];
    if (group.repos.find((r) => r.name === repo.name)) {
      throw new Error(`Repo "${repo.name}" already exists in group "${groupName}"`);
    }
    group.repos.push(repo);
  }

  /** Remove a repo from a group by name. */
  removeRepo(groupName: string, repoName: string): void {
    const group = this.manifest.groups[groupName];
    if (!group) throw new Error(`Group "${groupName}" not found`);
    const idx = group.repos.findIndex((r) => r.name === repoName);
    if (idx === -1) throw new Error(`Repo "${repoName}" not found in group "${groupName}"`);
    group.repos.splice(idx, 1);
  }

  // ─── Group Management ─────────────────────────────────────────────

  /** Get a single group by name, or undefined. */
  getGroup(name: string): RepoGroup | undefined {
    const g = this.manifest.groups[name];
    if (!g) return undefined;
    return { name, repos: g.repos, description: g.description };
  }

  /** Get all groups as resolved RepoGroup objects. */
  getGroups(): RepoGroup[] {
    return Object.entries(this.manifest.groups).map(([name, g]) => ({
      name,
      repos: g.repos,
      description: g.description,
    }));
  }

  /** Flatten all repos across groups, each annotated with its group name. */
  getAllRepos(): Array<RepoConfig & { group: string }> {
    const repos: Array<RepoConfig & { group: string }> = [];
    for (const [groupName, group] of Object.entries(this.manifest.groups)) {
      for (const repo of group.repos) {
        repos.push({ ...repo, group: groupName });
      }
    }
    return repos;
  }

  /** Create a new empty group. Throws if it already exists. */
  createGroup(name: string, description?: string): void {
    if (this.manifest.groups[name]) {
      throw new Error(`Group "${name}" already exists`);
    }
    this.manifest.groups[name] = { repos: [], description };
  }

  /** Remove a group entirely. Throws if not found. */
  removeGroup(name: string): void {
    if (!this.manifest.groups[name]) {
      throw new Error(`Group "${name}" not found`);
    }
    delete this.manifest.groups[name];
  }

  // ─── Settings ──────────────────────────────────────────────────────

  /** Merge partial settings into the current settings. */
  updateSettings(updates: Partial<Manifest['settings']>): void {
    this.manifest.settings = { ...this.manifest.settings, ...updates };
  }
}

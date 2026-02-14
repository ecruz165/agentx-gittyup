import { z } from 'zod';

// ─── AI Resolution Mode ────────────────────────────────────────────

export const AiModeSchema = z.enum(['auto', 'suggest', 'manual']);

export type AiMode = z.infer<typeof AiModeSchema>;

// ─── Branch Map ────────────────────────────────────────────────────

/** Maps branch aliases to actual branch names (e.g. { dev: "develop", prod: "main" }). */
export const BranchMapSchema = z.record(z.string(), z.string()).default({
  dev: 'develop',
  staging: 'staging',
  prod: 'main',
});

export type BranchMap = z.infer<typeof BranchMapSchema>;

// ─── Repo Config ───────────────────────────────────────────────────

export const RepoConfigSchema = z.object({
  name: z.string(),
  path: z.string(),
  remote: z.string().default('origin'),
  url: z.string().optional(),
  branches: BranchMapSchema,
});

export type RepoConfig = z.infer<typeof RepoConfigSchema>;

// ─── Group Config ──────────────────────────────────────────────────

export const GroupConfigSchema = z.object({
  repos: z.array(RepoConfigSchema).default([]),
  description: z.string().optional(),
});

export type GroupConfig = z.infer<typeof GroupConfigSchema>;

// ─── GitHub Settings ───────────────────────────────────────────────

export const GitHubSettingsSchema = z.object({
  token_env: z.string().default('GITHUB_TOKEN'),
  default_org: z.string().optional(),
});

export type GitHubSettings = z.infer<typeof GitHubSettingsSchema>;

// ─── Manifest Settings ─────────────────────────────────────────────

export const ManifestSettingsSchema = z.object({
  ai_mode: AiModeSchema.default('suggest'),
  github: GitHubSettingsSchema.default(() => GitHubSettingsSchema.parse({})),
  conflict_branch_prefix: z.string().default('conflict-resolution'),
  pr_template: z.string().optional(),
});

export type ManifestSettings = z.infer<typeof ManifestSettingsSchema>;

// ─── Root Manifest ─────────────────────────────────────────────────

export const ManifestSchema = z.object({
  workspace: z.string().default('.'),
  groups: z.record(z.string(), GroupConfigSchema).default({}),
  settings: ManifestSettingsSchema.default(() => ManifestSettingsSchema.parse({})),
});

export type Manifest = z.infer<typeof ManifestSchema>;

// ─── Repo Group (resolved) ─────────────────────────────────────────

/** Resolved group with its name attached. */
export interface RepoGroup {
  name: string;
  repos: RepoConfig[];
  description?: string;
}

// ─── Operation Types ───────────────────────────────────────────────

export interface MergeTarget {
  repo: RepoConfig;
  sourceBranch: string;
  targetBranch: string;
}

export interface CherryPickTarget {
  repo: RepoConfig;
  commits: string[];
  sourceBranch: string;
  targetBranch: string;
}

// ─── Repo State (dashboard) ────────────────────────────────────────

export interface RepoBranchState {
  branch: string;
  ahead: number;
  behind: number;
  hasConflicts: boolean;
  isDirty: boolean;
  lastCommit: string;
  lastCommitDate: string;
  trackingBranch?: string;
}

export interface RepoState {
  name: string;
  group: string;
  path: string;
  currentBranch: string;
  branches: Record<string, RepoBranchState>;
  hasUnresolved: boolean;
  error?: string;
}

// ─── Conflict Types ────────────────────────────────────────────────

export interface ConflictFile {
  path: string;
  oursContent: string;
  theirsContent: string;
  baseContent: string;
  mergedContent?: string;
}

export interface ConflictSession {
  repo: RepoConfig;
  operation: 'merge' | 'cherry-pick';
  sourceBranch: string;
  targetBranch: string;
  conflictBranch: string;
  files: ConflictFile[];
  resolvedFiles: string[];
  status: 'pending' | 'in-progress' | 'resolved' | 'escalated';
}

// ─── Operation Results ─────────────────────────────────────────────

export type OperationStatus = 'success' | 'conflict' | 'error' | 'skipped';

export interface OperationResult {
  repo: string;
  status: OperationStatus;
  message: string;
  conflictSession?: ConflictSession;
  prUrl?: string;
}

// ─── PR Types ──────────────────────────────────────────────────────

export interface PullRequestConfig {
  repo: string;
  owner: string;
  title: string;
  body: string;
  head: string;
  base: string;
  draft?: boolean;
  labels?: string[];
  reviewers?: string[];
}

export interface PullRequestResult {
  repo: string;
  number: number;
  url: string;
  status: 'created' | 'updated' | 'error';
  message?: string;
}

// ─── Compare Types ─────────────────────────────────────────────────

export interface BranchSideInfo {
  lastCommitDate: string;
  author: string;
  sinceDays: number;
  commitCount: number;
}

export interface PRInfo {
  number: number;
  state: 'open' | 'closed' | 'merged';
  url: string;
  date?: string;
}

export interface CompareRow {
  repo: RepoConfig & { group: string };
  hasConflicts: boolean;
  left: BranchSideInfo | null;
  right: BranchSideInfo | null;
  pr: PRInfo | null;
  error?: string;
}

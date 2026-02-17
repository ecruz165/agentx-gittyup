# Gittyup — Architecture

## High-Level Structure

```
src/
├── cli.ts                  Entry point — Commander setup, postAction hook
├── config/                 Configuration layer
│   ├── branding.ts         Brand primitives (names, paths, constants)
│   ├── schema.ts           Zod schemas (Manifest, Repo, Group, Settings)
│   ├── manifest.ts         ManifestManager — YAML load/save/discovery
│   └── index.ts
├── core/                   Business logic
│   ├── orchestrator.ts     Merge/cherry-pick coordinator
│   ├── repo-manager.ts     Repo access layer (wraps GitOperations)
│   ├── git-operations.ts   Low-level git wrapper (simple-git)
│   ├── conflict-resolver.ts Interactive conflict resolution
│   ├── cache.ts            File-based TTL cache
│   ├── repo-finder.ts      Recursive repo discovery
│   └── index.ts
├── commands/               CLI command handlers (14 commands)
│   ├── init.ts             Workspace init + context install
│   ├── repo.ts             Repo CRUD + tagging
│   ├── find.ts             Interactive repo discovery
│   ├── merge.ts            Multi-repo merge
│   ├── pick.ts             Multi-repo cherry-pick
│   ├── compare.ts          Branch comparison + caching
│   ├── status.ts           Dashboard
│   ├── fetch.ts            Multi-repo fetch
│   ├── prs.ts              PR listing
│   ├── auth.ts             Auth management
│   ├── config.ts           Settings
│   ├── cache.ts            Cache management
│   ├── group.ts            Group management
│   ├── rebrand.ts          Branding updates
│   └── index.ts
├── auth/                   Authentication & AI providers
│   ├── provider.ts         AIProvider interface
│   ├── provider-registry.ts Provider factory
│   ├── providers/          Implementations (copilot, anthropic, openai)
│   ├── token-manager.ts    Token lifecycle & GitHub token cascade
│   ├── device-flow.ts      OAuth device flow
│   ├── call-ai.ts          Unified AI dispatch + usage logging
│   ├── types.ts            Auth schemas & constants
│   └── index.ts
├── ui/                     Terminal UI
│   ├── dashboard.ts        Branch state tables (cli-table3)
│   ├── compare.ts          Side-by-side branch analysis
│   ├── prompts.ts          Custom @inquirer prompts with back navigation
│   └── index.ts
├── github/                 GitHub API
│   ├── client.ts           GitHubClient (Octokit wrapper)
│   └── index.ts
├── context/                AI tool context bundling
│   ├── index.ts            Registry + installContext()
│   ├── agents/             Bundled agent markdown files
│   └── commands/           Bundled command markdown files
└── utils/                  Utilities
    ├── git.ts              detectGitRoot(), getRepoConfigHome()
    ├── home.ts             Config directory resolution
    └── location.ts         ConfigLocation type, ResolvedConfig interface
```

## Layer Diagram

```
┌──────────────────────────────────────────────────────────┐
│  CLI Layer (cli.ts + commands/)                          │
│  Commander program, command handlers, postAction hook    │
├──────────────────────────────────────────────────────────┤
│  UI Layer (ui/)                                          │
│  Dashboard tables, compare rendering, custom prompts     │
├──────────────────────────────────────────────────────────┤
│  Core Layer (core/)                                      │
│  Orchestrator → RepoManager → GitOperations              │
│  ConflictResolver, CliCache, RepoFinder                  │
├──────────────────────────────────────────────────────────┤
│  Config Layer (config/)              Auth Layer (auth/)   │
│  ManifestManager, Schema,            Provider registry,   │
│  Branding                            Token manager,       │
│                                      AI call dispatch     │
├──────────────────────────────────────────────────────────┤
│  Integration Layer                                        │
│  github/ (Octokit)    simple-git     context/ (bundling)  │
├──────────────────────────────────────────────────────────┤
│  Utils (utils/)                                           │
│  Git detection, home paths, location types                │
└──────────────────────────────────────────────────────────┘
```

## Key Data Flows

### Merge Flow

```
User: gittyup merge dev staging --group frontend --push --pr
  │
  ▼
Command Handler (commands/merge.ts)
  │ Creates ManifestManager, Orchestrator
  │ Resolves group → repos, builds MergeTarget[]
  │ Shows merge plan, prompts for confirmation
  │
  ▼
Orchestrator.executeMerge()
  │ For each repo:
  │   ├─ fetch (if enabled)
  │   ├─ GitOperations.merge(source, target)
  │   │
  │   ├─ Success → push (if --push) → attach PR (if --pr)
  │   │
  │   └─ Conflict → ConflictResolver.startSession()
  │       │ For each conflicted file:
  │       │   ├─ Use ours / Use theirs
  │       │   ├─ AI resolve (callCopilot / callAI)
  │       │   ├─ Manual editor
  │       │   └─ Escalate to conflict branch
  │       │
  │       └─ Commit resolution or escalate
  │
  ▼
Dashboard.renderResults(results)
PostAction hook: config: <path> [repo|home]
```

### Config Discovery

```
ManifestManager constructor
  │
  ▼
resolveManifestPath()
  │
  ├─ detectGitRoot() → git rev-parse --show-toplevel
  │   │
  │   └─ If in git repo:
  │       Check <gitRoot>/.agentx/gittyup/gittyup.yaml
  │       Found? → location: 'repo'
  │
  ├─ Walk up from CWD looking for bare gittyup.yaml
  │   Found? → location: 'home' (backwards compat)
  │
  └─ Fall back to ~/.agentx/gittyup/gittyup.yaml
      → location: 'home'
```

### Auth Token Cascade (GitHub/Copilot)

```
resolveGitHubToken()
  │
  ├─ 1. COPILOT_GITHUB_TOKEN env var
  ├─ 2. GITHUB_TOKEN env var
  ├─ 3. auth.json (copilot.github_token)
  ├─ 4. gh auth token (gh CLI)
  └─ 5. git credential fill (git credential manager)
```

## Core Types

### Manifest (root config)

```typescript
interface Manifest {
  workspace: string;                              // Base path for relative repo paths
  groups: Record<string, GroupConfig>;            // Named repo groups
  settings: {
    ai_mode: 'auto' | 'suggest' | 'manual';     // AI conflict resolution mode
    github: { token_env: string; default_org?: string };
    conflict_branch_prefix: string;               // e.g. "conflict-resolution"
    pr_template?: string;                         // Mustache-style PR body
  };
}
```

### RepoConfig (per-repo)

```typescript
interface RepoConfig {
  name: string;                                   // Unique identifier
  path: string;                                   // Filesystem path (absolute or relative)
  remote: string;                                 // Git remote name (default: "origin")
  url?: string;                                   // GitHub clone URL (for PR features)
  branches: Record<string, string>;               // Aliases → actual names
  tags: string[];                                 // Arbitrary tags for filtering
}
```

### ConfigLocation

```typescript
type ConfigLocation = 'home' | 'repo';

interface ResolvedConfig {
  location: ConfigLocation;
  configDir: string;          // e.g. ~/.agentx/gittyup or <repo>/.agentx/gittyup
  manifestPath: string;       // Full path to gittyup.yaml
  gitRoot: string | null;
}
```

## Design Patterns

**Lazy Initialization** — RepoManager lazily creates GitOperations instances per repo, caching them for reuse within a session.

**Branch Aliasing** — Users operate on logical names (`dev`, `staging`, `prod`). Each repo maps these to actual branch names, allowing heterogeneous repos (one uses `develop`, another uses `dev`) to work under the same commands.

**Pluggable Resolution** — ConflictResolver accepts a `ResolutionCallbacks` interface. The Orchestrator injects AI-powered callbacks, but the resolver itself is AI-agnostic.

**Multi-Provider Auth** — The auth system uses a provider registry pattern. Each provider (copilot, anthropic, openai) implements the `AIProvider` interface. A single `auth.json` stores credentials for all providers with an `active_provider` field.

**Context Bundling** — Agent and command markdown files live in `src/context/` as source-of-truth. The `installContext()` function wraps and copies them into target projects formatted for the chosen AI coding tool.

## Dependencies

| Category | Package | Purpose |
|----------|---------|---------|
| CLI framework | commander | Command parsing, options, hooks |
| Prompts | @inquirer/prompts | Interactive selection, checkbox, input |
| Git | simple-git | Git operations (merge, cherry-pick, fetch) |
| GitHub | octokit | GitHub REST API (PRs, repos) |
| UI | chalk, cli-table3, ora | Colors, tables, spinners |
| Config | js-yaml, zod | YAML parsing, schema validation |
| Build | tsup | ESM bundling |
| Test | vitest | Unit/integration/e2e testing |

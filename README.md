# 🐴 gittyup

Multi-repo orchestration CLI with interactive conflict resolution, built for teams managing 10-20+ repositories with back-publishing and promotion workflows.

## The Problem

You manage many repos that share code, configs, or dependencies. You need to:
- **Sync dev branches** across repos when shared code changes (merge flow)
- **Promote specific commits** from dev → staging → prod within each repo (cherry-pick flow)
- **Resolve conflicts** interactively with AI assistance when things don't merge cleanly
- **Monitor branch state** across all repos from one dashboard

Tools like `gita` and `gitopolis` manage multiple repos, but don't handle the orchestrated merge/cherry-pick/conflict-resolution workflow you need for back-publishing.

## Installation

```bash
git clone https://github.com/yourorg/gittyup.git
cd gittyup
npm install
npm run build
npm link  # makes `gittyup` available globally
```

## Quick Start

```bash
# 1. Initialize a workspace
gittyup init

# 2. Add repos to groups
gittyup repo add frontend web-app ./web-app --url https://github.com/org/web-app.git
gittyup repo add frontend mobile-app ./mobile-app --url https://github.com/org/mobile-app.git
gittyup repo add services api-server ./api-server --url https://github.com/org/api-server.git

# 3. Check status across all repos
gittyup status --fetch

# 4. Compare branches side-by-side with conflict detection
gittyup compare develop project/d8-tide --fetch --pr

# 5. Sync dev branches (merge flow)
gittyup merge origin/main dev --group frontend --push

# 5. Promote specific commits (cherry-pick flow)
gittyup pick -g services -s dev -t staging --interactive --push --pr
```

## Concepts

### Manifest (`gittyup.yaml`)

The manifest is your source of truth. It defines your workspace, repo groups, branch aliases, and settings.

```yaml
workspace: ~/projects
groups:
  frontend:
    description: Client apps
    repos:
      - name: web-app
        path: ./web-app
        remote: origin
        url: https://github.com/org/web-app.git
        branches:
          dev: develop
          staging: staging
          prod: main
settings:
  ai_mode: suggest
  github:
    token_env: GITHUB_TOKEN
```

See `gittyup.example.yaml` for a full example.

### Branch Aliases

Instead of remembering that repo A uses `develop` while repo B uses `dev`, define aliases:

```yaml
branches:
  dev: develop      # "dev" always resolves to the actual branch name
  staging: staging
  prod: main
```

Then use aliases in commands: `gittyup merge origin/main dev` resolves `dev` → `develop` per repo.

### Groups

Groups let you target operations at subsets of repos:

```bash
gittyup status --group frontend     # only frontend repos
gittyup merge main dev -g services  # only services
gittyup fetch --group shared        # fetch only shared libs
```

## Commands

### `gittyup status` / `gittyup dash`

Dashboard showing branch state across all repos.

```bash
gittyup status                  # all repos
gittyup status -g frontend      # specific group
gittyup status -r web-app       # specific repo
gittyup status --fetch          # fetch first
gittyup status --compact        # condensed view
```

Output shows per-branch: ahead/behind counts, dirty state, conflicts, last commit.

### `gittyup compare` / `gittyup cmp` — Branch Comparison

Side-by-side branch comparison across all repos with conflict detection. Shows each repo's state on both branches including last commit date, author, staleness, commit count, and PR status. Repo names link to GitHub, PR numbers link to the PR.

```bash
# Compare develop vs a project branch (PRs included by default)
gittyup compare develop project/d8-tide --fetch

# Compare with branch aliases
gittyup compare dev staging -g frontend

# Quick check without conflict detection (faster)
gittyup compare dev prod --no-conflicts

# Skip PR lookup
gittyup compare dev staging --no-pr

# Force fresh data (bypass 5-minute cache)
gittyup compare develop project/d8-tide -f
```

**Caching:** Results are cached for 5 minutes keyed on the exact command arguments. Running the same compare again within 5 minutes returns instantly from cache with a notice. Use `-f` / `--force` to bypass, or `--fetch` (which always forces fresh data). Use `gittyup cache clear` to wipe all cached results.

Output splits repos into two sections:
- **🔴 WITH CONFLICTS** — repos where merging right → left would produce conflicts
- **✅ NO CONFLICTS** — repos where a clean merge is expected

Each row shows both branches side-by-side: last commit date, author, days since last commit, total commits, and PR number. Repository names and PR numbers are clickable terminal hyperlinks (supported in iTerm2, Kitty, WezTerm, Windows Terminal, GNOME Terminal, etc.).

### `gittyup merge` — Dev Sync

Merge a branch across multiple repos. Used for syncing dev environments.

```bash
# Merge origin/main into each repo's dev branch
gittyup merge origin/main dev --group frontend

# With options
gittyup merge origin/main dev -g services --push --pr --ai suggest
```

**Flow:**
1. Fetch remotes (unless `--no-fetch`)
2. For each repo: merge source → target
3. If conflicts: enter interactive resolution session
4. Optionally push and/or create PRs

### `gittyup pick` — Promotion (Cherry-Pick)

Cherry-pick selected commits from one branch to another **within each repo**, orchestrated across many repos.

```bash
# Interactive: select commits per repo
gittyup pick -g frontend -s dev -t staging --interactive

# Explicit commits (same SHAs applied to all repos in group)
gittyup pick -g services -s dev -t prod -c abc1234,def5678

# With push and PR creation
gittyup pick -r web-app -s dev -t staging -i --push --pr
```

**Flow:**
1. For each repo: list commits on source branch
2. User selects commits (interactive) or provides SHAs
3. Cherry-pick onto target branch
4. If conflicts: enter interactive resolution session
5. Optionally push and/or create PRs

### `gittyup repo` — Repo Management

```bash
gittyup repo add <group> <name> <path> [options]
gittyup repo remove <group> <name>
gittyup repo list
```

Options for `add`:
- `-r, --remote <name>` — Git remote (default: `origin`)
- `-u, --url <url>` — GitHub clone URL (enables PR features)
- `--branches <json>` — Branch alias map as JSON
- `--group-desc <text>` — Description for new group

### `gittyup group` — Group Management

```bash
gittyup group create <name> [-d "description"]
gittyup group remove <name>
```

### `gittyup fetch`

Fetch all remotes across repos.

```bash
gittyup fetch              # all repos
gittyup fetch -g frontend  # specific group
```

### `gittyup prs`

List open PRs across repos.

```bash
gittyup prs              # all repos with GitHub URLs
gittyup prs -g services  # specific group
```

### `gittyup cache` — Cache Management

```bash
gittyup cache clear   # wipe all cached results
gittyup cache prune   # remove only expired entries
```

### `gittyup config`

View or update settings.

```bash
gittyup config --show
gittyup config --ai auto      # set AI mode
```

## Conflict Resolution

When a merge or cherry-pick hits conflicts, gittyup drops you into an **interactive resolution session**:

```
╔══════════════════════════════════════════════════════════════╗
║  CONFLICT RESOLUTION SESSION                                ║
╚══════════════════════════════════════════════════════════════╝
  Repo:      web-app
  Operation: merge origin/main → develop
  Files:     3 conflicted
  AI Mode:   suggest

─── File 1/3: src/config.ts ───
  <<<< OURS (current branch):
    export const API_URL = "https://dev.api.example.com";
  >>>> THEIRS (incoming):
    export const API_URL = "https://api.example.com";

? How to resolve src/config.ts?
  🤖 AI auto-resolve (Claude merges both sides)
  💡 AI suggest (Claude proposes, you approve)
  ⬅️  Keep OURS (current branch version)
  ➡️  Keep THEIRS (incoming version)
  ✏️  Manual edit
  👁️  View full conflict
  ⏭️  Skip this file
```

### AI Modes

| Mode | Behavior |
|------|----------|
| `auto` | Claude attempts merge automatically. Falls back to manual on failure. |
| `suggest` | Claude proposes a resolution. You accept, edit, or reject. |
| `manual` | Standard manual resolution. AI options available on request. |

Set the mode globally (`gittyup config --ai suggest`) or per-operation (`--ai auto`).

### Escalation

If you can't resolve conflicts now, you can **escalate** — gittyup creates a `conflict-resolution/<repo>-<branch>-<timestamp>` branch so you (or another dev) can return to it later.

## Authentication

Gittyup resolves your GitHub token from the first available source:

1. **Environment variables**: `$GITHUB_TOKEN` or `$GH_TOKEN`
2. **Device flow login**: `gittyup auth login` (OAuth → GitHub Copilot)
3. **GitHub CLI**: `gh auth token` (if you've run `gh auth login`)
4. **Git credential helper**: `git credential fill` (osxkeychain, manager-core, store, etc.)

No extra configuration needed if you already use `gh` or have git credentials stored.

### Copilot Integration (AI Conflict Resolution)

If you have a GitHub Copilot subscription (Pro, Pro+, Business, or Enterprise), gittyup can use it for AI-assisted conflict resolution — no separate API key needed:

```bash
# One-time login via OAuth device flow (same flow as VS Code, OpenCode)
gittyup auth login

#   Login with GitHub Copilot
#   Open: https://github.com/login/device
#   Enter code: AB12-CD34
#   Waiting for authorization...

# Check what's connected
gittyup auth status

# See available models
gittyup auth models

# Logout
gittyup auth logout
```

After login, AI conflict resolution modes (`auto` and `suggest`) will use Copilot's chat completions API automatically. The token is cached in `~/.gittyup/auth.json` and refreshes transparently.

| Variable | Purpose |
|----------|---------|
| `GITHUB_TOKEN` | Override: explicitly set a GitHub PAT |
| `ANTHROPIC_API_KEY` | Not required — Copilot is used for AI resolution |

## Project Structure

```
src/
├── cli.ts                     # CLI entry point (Commander.js)
├── auth/
│   ├── types.ts               # Zod schemas, Copilot constants
│   ├── device-flow.ts         # OAuth device flow login
│   ├── token-manager.ts       # Token cascade, Copilot API, credential storage
│   └── index.ts               # Barrel export
├── config/
│   ├── schema.ts              # Zod schemas → inferred types
│   ├── manifest.ts            # YAML manifest loader/manager
│   └── index.ts               # Barrel export
├── core/
│   ├── git-operations.ts      # Git merge, cherry-pick, conflict detection
│   ├── repo-manager.ts        # Multi-repo loading and grouping
│   ├── conflict-resolver.ts   # Interactive conflict resolution session
│   ├── orchestrator.ts        # Merge/cherry-pick flow coordination
│   ├── cache.ts               # File-based CLI result cache (5min TTL)
│   └── index.ts               # Barrel export
├── github/
│   ├── client.ts              # Octokit wrapper for PR operations
│   └── index.ts               # Barrel export
├── ui/
│   ├── dashboard.ts           # TUI status dashboard
│   ├── compare.ts             # Side-by-side branch comparison view
│   └── index.ts               # Barrel export
```

## License

MIT

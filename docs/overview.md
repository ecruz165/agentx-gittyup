# Gittyup — Overview

Gittyup is a multi-repo orchestration CLI that manages branch flow across groups of git repositories. It handles merges, cherry-picks, conflict resolution, and PR creation across an entire fleet of repos from a single command.

## What It Does

Teams working across multiple repositories face a recurring problem: promoting changes from `dev` to `staging` to `prod` across 5, 10, or 50 repos is tedious and error-prone. Gittyup solves this by:

- **Grouping repos** into logical sets (frontend, backend, services)
- **Branch aliasing** — `dev`, `staging`, `prod` map to actual branch names per repo
- **Batch operations** — merge or cherry-pick across an entire group in one command
- **Conflict resolution** — interactive UI with AI-assisted resolution (Copilot, Anthropic, OpenAI)
- **PR automation** — create PRs across repos after operations
- **Dashboard** — see branch state, drift, and conflicts at a glance

## Quick Start

```bash
# Initialize (inside a git repo for project-local config, or globally)
agentx-gittyup init

# Discover and add repos
agentx-gittyup find ~/projects

# Check the state of all repos
agentx-gittyup status --fetch

# Compare branches before merging
agentx-gittyup compare dev staging

# Merge dev into staging across a group
agentx-gittyup merge dev staging --group frontend --push --pr
```

## Configuration

Gittyup is driven by a `gittyup.yaml` manifest that defines repo groups, branch mappings, and settings.

**Config discovery order:**
1. Repo-local: `<git-root>/.agentx/gittyup/gittyup.yaml`
2. Walk-up: bare `gittyup.yaml` in any parent directory
3. Global: `~/.agentx/gittyup/gittyup.yaml`

**Example manifest:**

```yaml
workspace: .
groups:
  frontend:
    description: UI applications
    repos:
      - name: web-app
        path: ./packages/web-app
        remote: origin
        url: https://github.com/org/web-app.git
        branches:
          dev: develop
          staging: staging
          prod: main
        tags: [ui, react]
  backend:
    repos:
      - name: api
        path: ./services/api
        branches: { dev: develop, staging: staging, prod: main }
        tags: [api, node]
settings:
  ai_mode: suggest
  github:
    token_env: GITHUB_TOKEN
  pr_template: |
    ## {{operation}} from `{{source_branch}}` to `{{target_branch}}`
    **Repo:** {{repo_name}}
```

## Commands

| Command | Alias | Purpose |
|---------|-------|---------|
| `init` | | Initialize a workspace (project-local or global) |
| `find <dir>` | | Discover git repos and add them interactively |
| `repo add/remove/list/tag` | | Manage repos and groups |
| `group create/remove` | | Manage groups |
| `status` | `dash` | Dashboard — branch states across all repos |
| `fetch` | | Fetch all remotes |
| `compare <left> <right>` | `cmp` | Compare branches with conflict detection |
| `merge <source> <target>` | | Merge a branch across repos |
| `pick` | `cherry-pick` | Cherry-pick commits between branches |
| `prs` | | List open PRs across repos |
| `auth login/status/logout` | | Manage AI provider authentication |
| `config` | | View and update settings |
| `cache clear/prune` | | Manage result cache |

## AI Integration

Gittyup uses AI for conflict resolution during merges and cherry-picks. Three providers are supported:

- **GitHub Copilot** — OAuth device flow, uses Copilot chat completions
- **Anthropic** — API key-based, Claude models
- **OpenAI** — API key-based, GPT models

AI modes:
- `auto` — automatically resolve conflicts using AI
- `suggest` — show AI suggestion, user decides
- `manual` — open editor for manual resolution

## AI Tool Context

Gittyup ships bundled context files for AI coding tools. During `init`, you can install:

- **Claude Code** — agents to `.claude/agents/`, commands to `.claude/commands/ax/gittyup/`
- **GitHub Copilot** — instructions to `.github/instructions/`, prompts to `.github/prompts/`
- **OpenAI Codex** — combined `AGENTS.md` at project root

These give AI agents awareness of gittyup commands and workflows.

## Part of AgentX

Gittyup belongs to the **agentx** suite. Config lives under `~/.agentx/gittyup/` (or per-repo at `<repo>/.agentx/gittyup/`). The `AGENTX_HOME` environment variable can override the config root.

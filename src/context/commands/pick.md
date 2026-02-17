Cherry-pick specific commits from one branch to another across repos.

Arguments: $ARGUMENTS

If no arguments are provided, ask the user for the source branch, target branch, and commits or whether to use interactive selection.

Run the following command:

```
agentx-gittyup pick --group <name> --source <branch> --target <branch> --interactive
```

Required: Either `--group <name>` or `--repo <name>` must be specified, plus `--source` and `--target`.

Commit selection (one required):
- `--interactive` — Interactively select commits from the source branch
- `--commits <sha1> <sha2> ...` — Specific commit SHAs to cherry-pick

Options:
- `--push` — Push to remote after cherry-pick
- `--pr` — Create PRs after cherry-pick
- `--ai auto|suggest|manual` — AI conflict resolution mode
- `--no-fetch` — Skip fetching before operation

**Important:** This command performs actual git cherry-picks. It shows a plan and asks for confirmation. If conflicts arise, gittyup enters interactive conflict resolution.

Use this for hotfix backports or selectively promoting changes between branches.

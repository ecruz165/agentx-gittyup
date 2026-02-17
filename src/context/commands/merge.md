Merge a source branch into a target branch across multiple repos.

Arguments: $ARGUMENTS

If no arguments are provided, ask the user for the source branch, target branch, and group/repo scope before proceeding.

Run the following command:

```
agentx-gittyup merge <source> <target> --group <name>
```

Where `<source>` and `<target>` are branch names or aliases (e.g., `dev`, `staging`, `prod`).

Required: Either `--group <name>` or `--repo <name>` must be specified.

Options:
- `--push` — Push to remote after successful merge
- `--pr` — Create PRs after merge
- `--ai auto|suggest|manual` — AI conflict resolution mode
- `--no-fetch` — Skip fetching before merge

**Important:** This command performs actual git merges across repos. It will show a merge plan and ask for confirmation before proceeding. If conflicts arise, gittyup enters interactive conflict resolution.

Before running, consider using `/ax:gittyup:compare` first to check for conflicts.

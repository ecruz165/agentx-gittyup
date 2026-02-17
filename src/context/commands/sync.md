Fetch all remotes and show the current state of all repos.

Run the following commands in sequence:

```
agentx-gittyup fetch
agentx-gittyup status --compact
```

Options:
- Add `--group <name>` to both commands to scope to a specific group

This is a daily hygiene command. It fetches the latest remote state and then shows a compact dashboard so you can see what's drifted.

After showing results, summarize:
1. Any repos that failed to fetch (network issues, auth problems)
2. Repos that are behind their remote (need pull/merge)
3. Repos with uncommitted changes (dirty working tree)

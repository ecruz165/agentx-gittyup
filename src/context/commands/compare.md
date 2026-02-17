Compare two branches across all repos to check for drift, conflicts, and open PRs.

Arguments: $ARGUMENTS

If no arguments are provided, default to comparing `dev` and `prod`.

Run the following command:

```
agentx-gittyup compare <left> <right> --fetch
```

Where `<left>` and `<right>` are branch names or aliases defined in the manifest (e.g., `dev`, `staging`, `prod`).

Options:
- Add `--group <name>` to scope to a specific group
- Add `--no-conflicts` to skip conflict detection (faster)
- Add `--no-pr` to skip GitHub PR lookup
- Add `-f` to bypass cache and get fresh data

The output shows a side-by-side comparison: commit counts, last commit dates, conflict status, and linked PRs for each repo.

Summarize the results by calling out:
1. Repos with conflicts (need attention before merge)
2. Repos significantly ahead/behind (drift)
3. Repos with existing open PRs

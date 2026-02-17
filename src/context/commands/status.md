Show the branch state dashboard for all repos managed by gittyup.

Run the following command and report the results:

```
agentx-gittyup status --fetch
```

Options:
- Add `--group <name>` to filter by a specific repo group
- Add `--repo <name>` to filter by a single repo
- Add `--compact` for a condensed view

The output shows each repo's current branch, ahead/behind counts, dirty state, and tracking info. Use this to get situational awareness before merges or releases.

If any repos show conflicts or are behind their remote, flag them prominently and suggest next steps (fetch, merge, or manual resolution).

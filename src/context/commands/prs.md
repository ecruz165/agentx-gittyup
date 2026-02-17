List all open pull requests across repos managed by gittyup.

Run the following command:

```
agentx-gittyup prs
```

Options:
- Add `--group <name>` to filter by a specific repo group

The output shows open PRs for each repo that has a GitHub URL configured, including PR number, title, head/base branches, and URL.

Only repos with a `url` field pointing to github.com will be included. If no repos have GitHub URLs, the command will report that.

Summarize the results by grouping PRs by status and highlighting any that look stale or blocked.

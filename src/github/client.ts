import { Octokit } from 'octokit';
import { requireGitHubToken } from '../auth/token-manager.js';
import type { PullRequestConfig, PullRequestResult } from '../config/schema.js';

/**
 * GitHub API client for PR operations.
 * Wraps Octokit with methods for creating, finding, and listing PRs.
 * Token is resolved automatically from env vars, auth.json, gh CLI, or git credentials.
 */
export class GitHubClient {
  private octokit: Octokit;

  private constructor(token: string) {
    this.octokit = new Octokit({ auth: token });
  }

  static async create(token?: string): Promise<GitHubClient> {
    const resolvedToken = token ?? (await requireGitHubToken()).token;
    return new GitHubClient(resolvedToken);
  }

  async createPR(config: PullRequestConfig): Promise<PullRequestResult> {
    try {
      const { data } = await this.octokit.rest.pulls.create({
        owner: config.owner, repo: config.repo, title: config.title,
        body: config.body, head: config.head, base: config.base, draft: config.draft ?? false,
      });
      if (config.labels?.length) {
        await this.octokit.rest.issues.addLabels({ owner: config.owner, repo: config.repo, issue_number: data.number, labels: config.labels });
      }
      if (config.reviewers?.length) {
        await this.octokit.rest.pulls.requestReviewers({ owner: config.owner, repo: config.repo, pull_number: data.number, reviewers: config.reviewers });
      }
      return { repo: config.repo, number: data.number, url: data.html_url, status: 'created' };
    } catch (err: any) {
      if (err.status === 422) {
        const existing = await this.findExistingPR(config.owner, config.repo, config.head, config.base);
        if (existing) return { repo: config.repo, number: existing.number, url: existing.html_url, status: 'updated', message: 'PR already exists' };
      }
      return { repo: config.repo, number: 0, url: '', status: 'error', message: err.message ?? String(err) };
    }
  }

  async findExistingPR(
    owner: string, repo: string, head: string, base: string,
  ): Promise<{ number: number; html_url: string; created_at: string } | null> {
    const { data } = await this.octokit.rest.pulls.list({ owner, repo, head: `${owner}:${head}`, base, state: 'open' });
    return data.length > 0 ? { number: data[0].number, html_url: data[0].html_url, created_at: data[0].created_at } : null;
  }

  async listOpenPRs(owner: string, repo: string): Promise<Array<{ number: number; title: string; url: string; head: string; base: string; author: string }>> {
    const { data } = await this.octokit.rest.pulls.list({ owner, repo, state: 'open', per_page: 100 });
    return data.map((pr) => ({ number: pr.number, title: pr.title, url: pr.html_url, head: pr.head.ref, base: pr.base.ref, author: pr.user?.login ?? 'unknown' }));
  }

  /** Parse owner/repo from a GitHub clone URL. */
  async getRepoOwner(repoUrl: string): Promise<{ owner: string; repo: string }> {
    const httpsMatch = repoUrl.match(/github\.com\/([^/]+)\/([^/.]+)/);
    if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] };
    const sshMatch = repoUrl.match(/github\.com:([^/]+)\/([^/.]+)/);
    if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };
    throw new Error(`Could not parse GitHub owner/repo from URL: ${repoUrl}`);
  }
}

import { Command } from 'commander';
import { existsSync } from 'node:fs';
import chalk from 'chalk';
import { confirm, checkbox, input, select, Separator } from '@inquirer/prompts';
import { selectWithBack, checkboxWithBack, BACK } from './ui/prompts.js';
import ora from 'ora';
import { ManifestManager } from './config/manifest.js';
import { Orchestrator } from './core/orchestrator.js';
import { CliCache } from './core/cache.js';
import { RepoFinder, type DiscoveredRepo } from './core/repo-finder.js';
import { Dashboard } from './ui/dashboard.js';
import { gatherCompareData, renderCompare } from './ui/compare.js';
import { GitHubClient } from './github/client.js';
import type { AiMode, MergeTarget, CherryPickTarget, RepoConfig, PRInfo } from './config/schema.js';

const program = new Command();

program
  .name('gittyup')
  .description('Multi-repo orchestration CLI with interactive conflict resolution')
  .version('0.1.0');

// ═══════════════════════════════════════════════════════════════════════
// init
// ═══════════════════════════════════════════════════════════════════════

program
  .command('init')
  .description('Initialize a new gittyup workspace')
  .option('-d, --dir <path>', 'Directory for the manifest', '.')
  .action(async (opts: { dir: string }) => {
    try {
      const mgr = ManifestManager.init(opts.dir);
      console.log(chalk.green(`✓ Created ${mgr.manifestPath}`));
      console.log(chalk.dim('  Edit the manifest to add your repos, or use:'));
      console.log(chalk.dim('    gittyup repo add <group> <name> <path>'));
    } catch (err: any) {
      console.error(chalk.red(err.message));
      process.exit(1);
    }
  });

// ═══════════════════════════════════════════════════════════════════════
// repo
// ═══════════════════════════════════════════════════════════════════════

const repoCmd = program.command('repo').description('Manage repos and groups');

repoCmd
  .command('add <group> <name> <path>')
  .description('Add a repo to a group')
  .option('-r, --remote <remote>', 'Git remote name', 'origin')
  .option('-u, --url <url>', 'GitHub clone URL')
  .option('--branches <json>', 'Branch aliases as JSON')
  .option('--group-desc <desc>', 'Description for a new group')
  .action(async (group: string, name: string, repoPath: string, opts: { remote: string; url?: string; branches?: string; groupDesc?: string }) => {
    const manifest = new ManifestManager();
    const branches = opts.branches ? JSON.parse(opts.branches) : { dev: 'develop', staging: 'staging', prod: 'main' };
    const repo: RepoConfig = { name, path: repoPath, remote: opts.remote, url: opts.url, branches };
    manifest.addRepo(group, repo, opts.groupDesc);
    manifest.save();
    console.log(chalk.green(`✓ Added ${name} to group "${group}"`));
  });

repoCmd
  .command('remove <group> <name>')
  .description('Remove a repo from a group')
  .action(async (group: string, name: string) => {
    const manifest = new ManifestManager();
    manifest.removeRepo(group, name);
    manifest.save();
    console.log(chalk.green(`✓ Removed ${name} from group "${group}"`));
  });

repoCmd
  .command('list')
  .description('List all repos and groups')
  .option('--tags', 'Show tags for each repo')
  .action(async (opts: { tags?: boolean }) => {
    const manifest = new ManifestManager();
    const groups = manifest.getGroups();
    if (groups.length === 0) {
      console.log(chalk.yellow('No repos configured. Use: gittyup repo add <group> <name> <path>'));
      return;
    }
    for (const group of groups) {
      console.log(chalk.blue.bold(`\n  ${group.name}`) + (group.description ? chalk.dim(` — ${group.description}`) : ''));
      for (const repo of group.repos) {
        const branchStr = Object.entries(repo.branches).map(([a, b]) => `${a}:${b}`).join(', ');
        const tagStr = opts.tags && repo.tags.length > 0 ? chalk.magenta(` [${repo.tags.join(', ')}]`) : '';
        console.log(`    ${chalk.white(repo.name)} ${chalk.dim(repo.path)} ${chalk.dim(`[${branchStr}]`)}${tagStr}`);
      }
    }
    console.log();
  });

repoCmd
  .command('tag')
  .description('Add or remove tags from repos (interactive)')
  .option('-g, --group <name>', 'Filter by group')
  .option('-a, --add <tags>', 'Tags to add (comma-separated)')
  .option('-r, --remove <tags>', 'Tags to remove (comma-separated)')
  .action(async (opts: { group?: string; add?: string; remove?: string }) => {
    const manifest = new ManifestManager();
    const allRepos = opts.group
      ? manifest.getGroup(opts.group)?.repos.map((r) => ({ ...r, group: opts.group! })) ?? []
      : manifest.getAllRepos();

    if (allRepos.length === 0) {
      console.log(chalk.yellow('No repos found.'));
      return;
    }

    // If no --add or --remove, go interactive
    if (!opts.add && !opts.remove) {
      // Show repos with current tags for selection
      const choices = allRepos.map((r) => ({
        name: `${r.name} ${r.tags.length > 0 ? chalk.magenta(`[${r.tags.join(', ')}]`) : chalk.dim('(no tags)')}`,
        value: r,
        checked: false,
      }));

      console.log(chalk.dim('\n  Select repos to tag. Shortcuts: Space=toggle, A=all, I=invert\n'));

      const selectedRepos = await checkbox({
        message: 'Select repos to modify tags:',
        pageSize: 15,
        loop: false,
        choices,
        shortcuts: { all: 'a', invert: 'i' },
      });

      if (selectedRepos.length === 0) {
        console.log(chalk.yellow('\n  No repos selected.\n'));
        return;
      }

      // Ask what to do
      const action = await select({
        message: 'What would you like to do?',
        choices: [
          { name: 'Add tags', value: 'add' },
          { name: 'Remove tags', value: 'remove' },
          { name: 'Replace all tags', value: 'replace' },
          { name: 'Cancel', value: 'cancel' },
        ],
      });

      if (action === 'cancel') {
        console.log(chalk.yellow('\n  Cancelled.\n'));
        return;
      }

      const tagsInput = await input({
        message: action === 'remove' ? 'Tags to remove (comma-separated):' : 'Tags (comma-separated):',
      });

      const tags = tagsInput.split(',').map((t) => t.trim()).filter((t) => t.length > 0);

      if (tags.length === 0) {
        console.log(chalk.yellow('\n  No tags specified.\n'));
        return;
      }

      // Apply changes
      for (const repo of selectedRepos) {
        const group = manifest.data.groups[repo.group];
        const repoConfig = group?.repos.find((r) => r.name === repo.name);
        if (!repoConfig) continue;

        if (action === 'add') {
          const newTags = new Set([...repoConfig.tags, ...tags]);
          repoConfig.tags = Array.from(newTags);
        } else if (action === 'remove') {
          repoConfig.tags = repoConfig.tags.filter((t) => !tags.includes(t));
        } else if (action === 'replace') {
          repoConfig.tags = tags;
        }
      }

      manifest.save();
      console.log(chalk.green(`\n  ✓ Updated tags for ${selectedRepos.length} repo(s)\n`));
    } else {
      // Non-interactive: apply to all repos in scope
      const addTags = opts.add?.split(',').map((t) => t.trim()).filter((t) => t) ?? [];
      const removeTags = opts.remove?.split(',').map((t) => t.trim()).filter((t) => t) ?? [];

      for (const repo of allRepos) {
        const group = manifest.data.groups[repo.group];
        const repoConfig = group?.repos.find((r) => r.name === repo.name);
        if (!repoConfig) continue;

        if (addTags.length > 0) {
          const newTags = new Set([...repoConfig.tags, ...addTags]);
          repoConfig.tags = Array.from(newTags);
        }
        if (removeTags.length > 0) {
          repoConfig.tags = repoConfig.tags.filter((t) => !removeTags.includes(t));
        }
      }

      manifest.save();
      console.log(chalk.green(`✓ Updated tags for ${allRepos.length} repo(s)`));
      if (addTags.length > 0) console.log(chalk.dim(`  Added: ${addTags.join(', ')}`));
      if (removeTags.length > 0) console.log(chalk.dim(`  Removed: ${removeTags.join(', ')}`));
    }
  });

repoCmd
  .command('tags')
  .description('List all tags in use')
  .action(async () => {
    const manifest = new ManifestManager();
    const allRepos = manifest.getAllRepos();
    const tagCounts = new Map<string, number>();

    for (const repo of allRepos) {
      for (const tag of repo.tags) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      }
    }

    if (tagCounts.size === 0) {
      console.log(chalk.yellow('\n  No tags defined. Use: gittyup repo tag\n'));
      return;
    }

    console.log(chalk.bold('\n  Tags:\n'));
    for (const [tag, count] of Array.from(tagCounts.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
      console.log(`    ${chalk.magenta(tag)} ${chalk.dim(`(${count} repo${count > 1 ? 's' : ''})`)}`);
    }
    console.log();
  });

// ═══════════════════════════════════════════════════════════════════════
// find
// ═══════════════════════════════════════════════════════════════════════

program
  .command('find')
  .description('Find git repos recursively and add them to the manifest')
  .argument('[directory]', 'Directory to search (default: current directory)', '.')
  .option('-d, --depth <n>', 'Maximum search depth', '5')
  .option('--no-metadata', 'Skip fetching repo metadata (faster)')
  .action(async (directory: string, opts: { depth: string; metadata?: boolean }) => {
    const searchDir = directory.startsWith('/') ? directory : process.cwd() + '/' + directory;

    if (!existsSync(searchDir)) {
      console.error(chalk.red(`No such file or directory: ${directory}`));
      process.exit(1);
    }

    const spinner = ora('Scanning for git repositories...').start();

    const finder = new RepoFinder(searchDir, {
      maxDepth: parseInt(opts.depth, 10),
      includeMetadata: opts.metadata !== false,
    });

    const repos = await finder.find((path) => {
      spinner.text = `Found: ${path}`;
    });

    spinner.stop();

    if (repos.length === 0) {
      console.log(chalk.yellow('\n  No git repositories found.\n'));
      return;
    }

    // Group repos by parent folder
    const groupByFolder = (repoList: DiscoveredRepo[]): Map<string, DiscoveredRepo[]> => {
      const groups = new Map<string, DiscoveredRepo[]>();
      for (const repo of repoList) {
        const parts = repo.relativePath.split('/');
        const folder = parts.length > 1 ? parts.slice(0, -1).join('/') : '.';
        if (!groups.has(folder)) groups.set(folder, []);
        groups.get(folder)!.push(repo);
      }
      return groups;
    };

    const folderGroups = groupByFolder(repos);
    const folderCount = folderGroups.size;

    console.log(chalk.bold(`\n  Found ${repos.length} git repositories in ${folderCount} folder(s):\n`));
    for (const [folder, folderRepos] of folderGroups) {
      console.log(chalk.blue.bold(`  📁 ${folder}/`) + chalk.dim(` (${folderRepos.length})`));
      for (const repo of folderRepos) {
        const dirty = repo.isDirty ? chalk.yellow(' *') : '';
        const branch = repo.currentBranch ? chalk.dim(` [${repo.currentBranch}]`) : '';
        console.log(`      ${chalk.white(repo.name)}${branch}${dirty}`);
      }
    }
    console.log();

    // State machine for selection flow with back navigation
    type State = 'mode' | 'select' | 'group' | 'tags' | 'done' | 'cancel';
    let state: State = 'mode';
    let selectionMode: 'all' | 'folder' | 'individual' = 'all';
    let selected: DiscoveredRepo[] = [];
    let groupName = '';
    let repoTags = new Map<string, string[]>();
    const manifest = new ManifestManager();

    // Type for individual repo selection values
    type RepoChoice = { repo: DiscoveredRepo };

    while (state !== 'done' && state !== 'cancel') {
      switch (state) {
          case 'mode': {
            const choice = await selectWithBack({
              message: `How would you like to select from ${repos.length} repositories?`,
              choices: [
                { name: `Add all ${repos.length} repositories`, value: 'all' as const },
                { name: `Select by folder (${folderCount} folders)`, value: 'folder' as const },
                { name: 'Select individually (checkbox)', value: 'individual' as const },
                { name: chalk.dim('Cancel'), value: 'cancel' as const },
              ],
            });

            if (choice === BACK || choice === 'cancel') {
              state = 'cancel';
            } else if (choice === 'all') {
              selectionMode = 'all';
              selected = repos;
              console.log(chalk.dim(`\n  Selected all ${repos.length} repositories.\n`));
              state = 'group';
            } else {
              selectionMode = choice;
              state = 'select';
            }
            break;
          }

          case 'select': {
            selected = [];

            if (selectionMode === 'folder') {
              const folderChoices = Array.from(folderGroups.entries()).map(([folder, folderRepos]) => ({
                name: `📁 ${folder}/ ${chalk.dim(`(${folderRepos.length} repos)`)}`,
                value: folder,
                checked: false,
              }));

              const result = await checkboxWithBack({
                message: 'Select folders to add:',
                pageSize: 15,
                loop: false,
                choices: folderChoices,
                shortcuts: { all: 'a', invert: 'i' },
              });

              if (result === BACK) {
                state = 'mode';
                break;
              }

              const selectedFolders = result as string[];
              for (const folder of selectedFolders) {
                const folderRepos = folderGroups.get(folder);
                if (folderRepos) selected.push(...folderRepos);
              }

              if (selected.length > 0) {
                console.log(chalk.dim(`\n  Selected ${selected.length} repositories from ${selectedFolders.length} folder(s).\n`));
              }
            } else {
              // Individual selection
              const choices: Array<{ name: string; value: RepoChoice; checked: boolean; group?: string } | Separator> = [];
              for (const [folder, folderRepos] of folderGroups) {
                choices.push(new Separator(chalk.blue(`── ${folder}/ ──`)));
                for (const r of folderRepos) {
                  const dirty = r.isDirty ? chalk.yellow(' *') : '';
                  choices.push({
                    name: `${r.name}${dirty} ${chalk.dim(r.currentBranch ? `[${r.currentBranch}]` : '')}`,
                    value: { repo: r } as RepoChoice,
                    checked: false,
                    group: folder,
                  });
                }
              }

              const result = await checkboxWithBack({
                message: 'Select repositories to add:',
                pageSize: 15,
                loop: false,
                choices,
                shortcuts: { all: 'a', invert: 'i', folder: 'f' },
              });

              if (result === BACK) {
                state = 'mode';
                break;
              }

              const rawSelected = result as RepoChoice[];
              selected = rawSelected.map((item) => item.repo);
            }

            if (selected.length === 0) {
              // If nothing selected, offer to go back
              const emptyAction = await selectWithBack({
                message: 'No repositories selected.',
                choices: [
                  { name: 'Back to selection mode', value: 'back' },
                  { name: 'Cancel', value: 'cancel' },
                ],
              });
              state = emptyAction === BACK || emptyAction === 'back' ? 'mode' : 'cancel';
            } else {
              state = 'group';
            }
            break;
          }

          case 'group': {
            const existingGroups = manifest.getGroups().map((g) => g.name);

            if (existingGroups.length > 0) {
              const groupChoice = await selectWithBack({
                message: 'Add to which group?',
                choices: [
                  ...existingGroups.map((g) => ({ name: g, value: g })),
                  { name: chalk.green('+ Create new group'), value: '__NEW__' },
                ],
              });

              if (groupChoice === BACK) {
                state = selectionMode === 'all' ? 'mode' : 'select';
                break;
              }

              if (groupChoice === '__NEW__') {
                groupName = await input({ message: 'New group name:' });
                if (!groupName.trim()) {
                  console.log(chalk.yellow('  Group name required.'));
                  break; // Stay in group state
                }
                const groupDesc = await input({ message: 'Group description (optional):' });
                try {
                  manifest.createGroup(groupName, groupDesc || undefined);
                } catch {
                  // Group might already exist, that's ok
                }
              } else {
                groupName = groupChoice as string;
              }
            } else {
              const backOrCreate = await selectWithBack({
                message: 'No groups exist yet.',
                choices: [
                  { name: 'Create a new group', value: 'create' },
                ],
              });

              if (backOrCreate === BACK) {
                state = selectionMode === 'all' ? 'mode' : 'select';
                break;
              }

              groupName = await input({ message: 'Group name:', default: 'default' });
              const groupDesc = await input({ message: 'Group description (optional):' });
              try {
                manifest.createGroup(groupName, groupDesc || undefined);
              } catch {
                // Group might already exist
              }
            }

            state = 'tags';
            break;
          }

          case 'tags': {
            const tagMode = await selectWithBack({
              message: 'How would you like to tag these repos?',
              choices: [
                { name: 'Same tags for all', value: 'same' },
                { name: 'Tag by folder (use folder name as tag)', value: 'folder' },
                { name: 'No tags', value: 'none' },
              ],
            });

            if (tagMode === BACK) {
              state = 'group';
              break;
            }

            repoTags = new Map<string, string[]>();

            if (tagMode === 'same') {
              const tagsInput = await input({ message: 'Tags (comma-separated):' });
              const tags = tagsInput.split(',').map((t) => t.trim()).filter((t) => t.length > 0);
              for (const repo of selected) {
                repoTags.set(repo.name, tags);
              }
            } else if (tagMode === 'folder') {
              for (const repo of selected) {
                const parts = repo.relativePath.split('/');
                const folder = parts.length > 1 ? parts[0] : 'root';
                const folderTag = folder.toLowerCase().replace(/[^a-z0-9-]/g, '-');
                repoTags.set(repo.name, [folderTag]);
              }
              const folderTags = new Set(Array.from(repoTags.values()).flat());
              console.log(chalk.dim(`\n  Will apply folder tags: ${Array.from(folderTags).join(', ')}`));

              const additionalTags = await input({ message: 'Additional tags for all (comma-separated, or empty):' });
              if (additionalTags.trim()) {
                const extra = additionalTags.split(',').map((t) => t.trim()).filter((t) => t.length > 0);
                for (const [name, tags] of repoTags) {
                  repoTags.set(name, [...tags, ...extra]);
                }
              }
            } else {
              for (const repo of selected) {
                repoTags.set(repo.name, []);
              }
            }

            state = 'done';
            break;
          }
        }
    }

    if (state === 'cancel') {
      console.log(chalk.yellow('\n  Cancelled.\n'));
      return;
    }

    // Add repos to manifest
    let added = 0;
    for (const repo of selected) {
      const repoConfig: RepoConfig = {
        name: repo.name,
        path: repo.relativePath,
        remote: 'origin',
        url: repo.remoteUrl,
        branches: { dev: 'develop', staging: 'staging', prod: 'main' },
        tags: repoTags.get(repo.name) ?? [],
      };

      try {
        manifest.addRepo(groupName, repoConfig);
        added++;
      } catch (err: any) {
        console.log(chalk.yellow(`  ⚠ Skipped ${repo.name}: ${err.message}`));
      }
    }

    manifest.save();
    console.log(chalk.green(`\n  ✓ Added ${added} repo(s) to group "${groupName}"`));

    const allTags = new Set(Array.from(repoTags.values()).flat());
    if (allTags.size > 0) {
      console.log(chalk.dim(`    Tags applied: ${Array.from(allTags).join(', ')}`));
    }
    console.log();
  });

// ═══════════════════════════════════════════════════════════════════════
// group
// ═══════════════════════════════════════════════════════════════════════

const groupCmd = program.command('group').description('Manage groups');

groupCmd
  .command('create <name>')
  .description('Create a new empty group')
  .option('-d, --desc <description>', 'Group description')
  .action(async (name: string, opts: { desc?: string }) => {
    const manifest = new ManifestManager();
    manifest.createGroup(name, opts.desc);
    manifest.save();
    console.log(chalk.green(`✓ Created group "${name}"`));
  });

groupCmd
  .command('remove <name>')
  .description('Remove a group')
  .action(async (name: string) => {
    const manifest = new ManifestManager();
    manifest.removeGroup(name);
    manifest.save();
    console.log(chalk.green(`✓ Removed group "${name}"`));
  });

// ═══════════════════════════════════════════════════════════════════════
// status / dash
// ═══════════════════════════════════════════════════════════════════════

program
  .command('status')
  .alias('dash')
  .description('Show dashboard with branch states across all repos')
  .option('-g, --group <name>', 'Filter by group')
  .option('-r, --repo <name>', 'Filter by repo')
  .option('-c, --compact', 'Compact view')
  .option('--fetch', 'Fetch from remotes first', false)
  .action(async (opts: { group?: string; repo?: string; compact?: boolean; fetch?: boolean }) => {
    const manifest = new ManifestManager();
    const orchestrator = new Orchestrator(manifest);
    const target = opts.group ?? opts.repo;

    if (opts.fetch) {
      const spinner = ora('Fetching from remotes...').start();
      await orchestrator.repos.fetchAll(target);
      spinner.succeed('Fetched');
    }

    const states = await orchestrator.repos.getStates(target);
    Dashboard.render(states, { compact: opts.compact });
  });

// ═══════════════════════════════════════════════════════════════════════
// fetch
// ═══════════════════════════════════════════════════════════════════════

program
  .command('fetch')
  .description('Fetch all remotes across repos')
  .option('-g, --group <name>', 'Filter by group')
  .action(async (opts: { group?: string }) => {
    const manifest = new ManifestManager();
    const orchestrator = new Orchestrator(manifest);
    const results = await orchestrator.repos.fetchAll(opts.group, (repo, status) => {
      console.log(chalk.dim(`  ${repo}: ${status}`));
    });
    const failed = results.filter((r) => !r.success);
    console.log(failed.length === 0
      ? chalk.green(`\n✓ Fetched ${results.length} repos`)
      : chalk.yellow(`\n⚠ ${failed.length}/${results.length} failed`),
    );
  });

// ═══════════════════════════════════════════════════════════════════════
// compare
// ═══════════════════════════════════════════════════════════════════════

program
  .command('compare')
  .alias('cmp')
  .description('Compare two branches side-by-side with conflict detection')
  .argument('<left>', 'Left branch (or alias)')
  .argument('<right>', 'Right branch (or alias)')
  .option('-g, --group <name>', 'Filter by group')
  .option('-r, --repo <name>', 'Filter by repo')
  .option('--fetch', 'Fetch from remotes first', false)
  .option('--no-conflicts', 'Skip conflict detection')
  .option('--no-pr', 'Skip PR lookup from GitHub')
  .option('-f, --force', 'Bypass cache and force fresh data', false)
  .action(async (left: string, right: string, opts: { group?: string; repo?: string; fetch?: boolean; conflicts?: boolean; pr?: boolean; force?: boolean }) => {
    const manifest = new ManifestManager();
    const orchestrator = new Orchestrator(manifest);
    const target = opts.group ?? opts.repo;

    // Cache check
    const cache = new CliCache();
    cache.prune();

    const cacheKey = CliCache.buildKey('compare', { left, right, group: opts.group, repo: opts.repo, conflicts: opts.conflicts, pr: opts.pr });

    if (!opts.force && !opts.fetch) {
      const cached = cache.get<{ rows: any[]; prData: Record<string, any> | null }>(cacheKey);
      if (cached.hit) {
        CliCache.printCacheNotice(cached.ageMs);
        const prMap = cached.data.prData ? new Map(Object.entries(cached.data.prData)) as Map<string, PRInfo> : undefined;
        renderCompare(cached.data.rows, left, right, prMap);
        return;
      }
    }

    const rows = await gatherCompareData(manifest, orchestrator.repos, target, left, right, { fetch: opts.fetch, checkConflicts: opts.conflicts });

    // PR lookup (on by default)
    let prData: Map<string, PRInfo> | undefined;
    if (opts.pr !== false) {
      try {
        const gh = await GitHubClient.create();
        prData = new Map();
        for (const row of rows) {
          if (!row.repo.url?.includes('github.com')) continue;
          try {
            const { owner, repo: repoName } = await gh.getRepoOwner(row.repo.url!);
            const rightRef = row.repo.branches[right] ?? right;
            const leftRef = row.repo.branches[left] ?? left;
            const existing = await gh.findExistingPR(owner, repoName, rightRef, leftRef);
            if (existing) prData.set(row.repo.name, { number: existing.number, state: 'open', url: existing.html_url, date: existing.created_at.slice(0, 10) });
          } catch {}
        }
      } catch (err: any) { console.log(chalk.yellow(`  Could not fetch PR data: ${err.message}`)); }
    }

    // Cache result
    cache.set(cacheKey, { rows, prData: prData ? Object.fromEntries(prData.entries()) : null }, { command: 'compare', args: [left, right] });

    renderCompare(rows, left, right, prData);
  });

// ═══════════════════════════════════════════════════════════════════════
// merge
// ═══════════════════════════════════════════════════════════════════════

program
  .command('merge')
  .description('Merge a branch across repos (dev sync)')
  .argument('<source>', 'Source branch (or alias)')
  .argument('[target]', 'Target branch (or alias)', 'dev')
  .option('-g, --group <name>', 'Target group')
  .option('-r, --repo <name>', 'Target single repo')
  .option('--ai <mode>', 'AI mode: auto | suggest | manual')
  .option('--push', 'Push after successful merge', false)
  .option('--pr', 'Create PRs after merge', false)
  .option('--no-fetch', 'Skip fetching before merge')
  .action(async (source: string, target: string, opts: { group?: string; repo?: string; ai?: string; push?: boolean; pr?: boolean; fetch?: boolean }) => {
    const manifest = new ManifestManager();
    const orchestrator = new Orchestrator(manifest);
    const scope = opts.group ?? opts.repo;
    if (!scope) { console.error(chalk.red('Specify --group or --repo')); process.exit(1); }

    const repos = orchestrator.repos.getReposForTarget(scope);
    const targets: MergeTarget[] = repos.map((repo) => ({
      repo, sourceBranch: repo.branches[source] ?? source, targetBranch: repo.branches[target] ?? target,
    }));

    console.log(chalk.bold('\n  Merge Plan:'));
    for (const t of targets) console.log(chalk.dim(`    ${t.repo.name}: ${t.sourceBranch} → ${t.targetBranch}`));

    const ok = await confirm({ message: `Proceed with merge across ${targets.length} repo(s)?`, default: true });
    if (!ok) return;

    await orchestrator.executeMerge(targets, { aiMode: (opts.ai as AiMode) ?? undefined, push: opts.push, createPR: opts.pr, fetch: opts.fetch });
  });

// ═══════════════════════════════════════════════════════════════════════
// pick (cherry-pick)
// ═══════════════════════════════════════════════════════════════════════

program
  .command('pick')
  .alias('cherry-pick')
  .description('Cherry-pick commits between branches within repos')
  .option('-g, --group <name>', 'Target group')
  .option('-r, --repo <name>', 'Target single repo')
  .option('-s, --source <branch>', 'Source branch (or alias)')
  .option('-t, --target <branch>', 'Target branch (or alias)')
  .option('-c, --commits <shas...>', 'Specific commit SHAs')
  .option('-i, --interactive', 'Interactively select commits', false)
  .option('--ai <mode>', 'AI mode: auto | suggest | manual')
  .option('--push', 'Push after cherry-pick', false)
  .option('--pr', 'Create PRs', false)
  .option('--no-fetch', 'Skip fetching')
  .action(async (opts: { group?: string; repo?: string; source?: string; target?: string; commits?: string[]; interactive?: boolean; ai?: string; push?: boolean; pr?: boolean; fetch?: boolean }) => {
    const manifest = new ManifestManager();
    const orchestrator = new Orchestrator(manifest);
    const scope = opts.group ?? opts.repo;
    if (!scope) { console.error(chalk.red('Specify --group or --repo')); process.exit(1); }
    if (!opts.source || !opts.target) { console.error(chalk.red('Specify --source and --target branches')); process.exit(1); }

    const repos = orchestrator.repos.getReposForTarget(scope);
    const targets: CherryPickTarget[] = [];

    for (const repo of repos) {
      const sourceBranch = repo.branches[opts.source!] ?? opts.source!;
      const targetBranch = repo.branches[opts.target!] ?? opts.target!;

      let commits: string[];
      if (opts.commits) {
        commits = opts.commits;
      } else if (opts.interactive) {
        console.log(chalk.bold(`\nSelect commits for ${repo.name}:`));
        commits = await orchestrator.selectCommits(repo, sourceBranch);
        if (commits.length === 0) { console.log(chalk.yellow(`  Skipping ${repo.name}`)); continue; }
      } else {
        console.error(chalk.red('Specify --commits or use --interactive')); process.exit(1);
      }
      targets.push({ repo, commits, sourceBranch, targetBranch });
    }

    if (targets.length === 0) { console.log(chalk.yellow('No targets configured.')); return; }

    console.log(chalk.bold('\n  Cherry-Pick Plan:'));
    for (const t of targets) {
      console.log(chalk.dim(`    ${t.repo.name}: ${t.commits.length} commit(s) ${t.sourceBranch} → ${t.targetBranch}`));
      for (const c of t.commits) console.log(chalk.dim(`      ${c.substring(0, 8)}`));
    }

    const ok = await confirm({ message: `Proceed with cherry-pick across ${targets.length} repo(s)?`, default: true });
    if (!ok) return;

    await orchestrator.executeCherryPick(targets, { aiMode: (opts.ai as AiMode) ?? undefined, push: opts.push, createPR: opts.pr, fetch: opts.fetch });
  });

// ═══════════════════════════════════════════════════════════════════════
// prs
// ═══════════════════════════════════════════════════════════════════════

program
  .command('prs')
  .description('List open PRs across repos')
  .option('-g, --group <name>', 'Filter by group')
  .action(async (opts: { group?: string }) => {
    const manifest = new ManifestManager();
    const orchestrator = new Orchestrator(manifest);
    const repos = opts.group ? orchestrator.repos.getReposForTarget(opts.group) : orchestrator.repos.getAllRepos();
    const ghRepos = repos.filter((r) => r.url?.includes('github.com'));
    if (ghRepos.length === 0) { console.log(chalk.yellow('No repos with GitHub URLs configured.')); return; }

    const gh = await GitHubClient.create();
    for (const repo of ghRepos) {
      try {
        const { owner, repo: repoName } = await gh.getRepoOwner(repo.url!);
        const prs = await gh.listOpenPRs(owner, repoName);
        console.log(chalk.blue.bold(`\n  ${repo.name}`) + chalk.dim(` (${prs.length} open)`));
        for (const pr of prs.slice(0, 10)) console.log(`    #${pr.number} ${pr.title} ${chalk.dim(`(${pr.head} → ${pr.base})`)} ${chalk.blue(pr.url)}`);
      } catch (err: any) { console.log(chalk.red(`  ${repo.name}: ${err.message}`)); }
    }
    console.log();
  });

// ═══════════════════════════════════════════════════════════════════════
// cache
// ═══════════════════════════════════════════════════════════════════════

const cacheCmd = program.command('cache').description('Manage result cache');

cacheCmd
  .command('clear')
  .description('Clear all cached results')
  .action(async () => { const c = new CliCache(); console.log(chalk.green(`✓ Cleared ${c.clear()} cached result(s)`)); });

cacheCmd
  .command('prune')
  .description('Remove expired cache entries')
  .action(async () => { const c = new CliCache(); console.log(chalk.green(`✓ Pruned ${c.prune()} expired entry/entries`)); });

// ═══════════════════════════════════════════════════════════════════════
// auth
// ═══════════════════════════════════════════════════════════════════════

const authCmd = program.command('auth').description('GitHub / Copilot authentication');

authCmd
  .command('login')
  .description('Authenticate with GitHub Copilot via OAuth device flow')
  .action(async () => {
    const { login } = await import('./auth/device-flow.js');
    try {
      const { username } = await login();
      console.log(chalk.green(`\n  ✓ Authenticated as ${chalk.bold(username)}`));
      console.log(chalk.dim('  Copilot token will be fetched on first AI call.\n'));
    } catch (err: any) {
      console.error(chalk.red(`  ✗ ${err.message}`));
      process.exit(1);
    }
  });

authCmd
  .command('status')
  .description('Show authentication status and token source')
  .action(async () => {
    const { printAuthStatus } = await import('./auth/token-manager.js');
    console.log(chalk.bold('\n  Auth Status:\n'));
    await printAuthStatus();
    console.log();
  });

authCmd
  .command('logout')
  .description('Remove stored credentials')
  .action(async () => {
    const { deleteAuthCredentials } = await import('./auth/token-manager.js');
    await deleteAuthCredentials();
    console.log(chalk.green('  ✓ Credentials removed'));
  });

authCmd
  .command('models')
  .description('List available Copilot models')
  .action(async () => {
    const { fetchCopilotModels } = await import('./auth/token-manager.js');
    const models = await fetchCopilotModels();
    if (!models) {
      console.log(chalk.yellow('  Could not fetch models. Run "gittyup auth login" first.'));
      return;
    }
    console.log(chalk.bold(`\n  Available Copilot Models (${models.length}):\n`));
    for (const m of models) {
      const limits = m.capabilities?.limits;
      const info = limits ? chalk.dim(` (${limits.max_prompt_tokens ?? '?'}/${limits.max_output_tokens ?? '?'} tokens)`) : '';
      console.log(`    ${chalk.white(m.id)}${info}`);
    }
    console.log();
  });

// ═══════════════════════════════════════════════════════════════════════
// config
// ═══════════════════════════════════════════════════════════════════════

program
  .command('config')
  .description('View or update settings')
  .option('--ai <mode>', 'Set AI mode: auto | suggest | manual')
  .option('--show', 'Show current config')
  .action(async (opts: { ai?: string; show?: boolean }) => {
    const manifest = new ManifestManager();
    if (opts.ai) {
      manifest.updateSettings({ ai_mode: opts.ai as AiMode });
      manifest.save();
      console.log(chalk.green(`✓ AI mode set to: ${opts.ai}`));
    }
    if (opts.show || !opts.ai) {
      const { resolveGitHubToken } = await import('./auth/token-manager.js');
      const settings = manifest.data.settings;
      const hasToken = (await resolveGitHubToken()) !== null;
      console.log(chalk.bold('\n  Current Settings:'));
      console.log(chalk.dim(`    AI Mode:         ${settings.ai_mode}`));
      console.log(chalk.dim(`    GitHub Token:     ${hasToken ? chalk.green('✓ detected') : chalk.red('✗ not found')}`));
      console.log(chalk.dim(`    Conflict Prefix:  ${settings.conflict_branch_prefix}`));
      console.log(chalk.dim(`    Manifest:         ${manifest.manifestPath}\n`));
    }
  });

// ═══════════════════════════════════════════════════════════════════════

program.parse();

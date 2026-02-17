import type { Command } from 'commander';
import { existsSync } from 'node:fs';
import chalk from 'chalk';
import { Separator } from '@inquirer/prompts';
import { input } from '@inquirer/prompts';
import { selectWithBack, checkboxWithBack, groupAssigner, tagAssigner, BACK, type NewGroupRequest, type NewTagRequest } from '../ui/prompts.js';
import ora from 'ora';
import { ManifestManager } from '../config/manifest.js';
import { RepoFinder, type DiscoveredRepo } from '../core/repo-finder.js';
import type { RepoConfig } from '../config/schema.js';

export function registerFind(program: Command): void {
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
      let repoGroupMap = new Map<string, string>();
      let repoTags = new Map<string, string[]>();
      const manifest = new ManifestManager();

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
              const existingGroupNames = manifest.getGroups().map((g) => g.name);
              const groupsList = ['Undefined', ...existingGroupNames];
              let currentAssignments: Map<string, string> | undefined =
                repoGroupMap.size > 0 ? repoGroupMap : undefined;

              let wentBack = false;

              while (true) {
                const result = await groupAssigner({
                  message: 'Assign repos to groups (press 0-9 to assign):',
                  repos: selected.map((r) => ({ name: r.name, path: r.relativePath })),
                  groups: groupsList,
                  assignments: currentAssignments,
                  pageSize: 20,
                });

                if (result === BACK) {
                  wentBack = true;
                  state = selectionMode === 'all' ? 'mode' : 'select';
                  break;
                }

                if (typeof result === 'object' && 'action' in result && result.action === 'new_group') {
                  const req = result as NewGroupRequest;
                  currentAssignments = req.assignments;
                  const newName = await input({ message: 'New group name:' });
                  if (!newName.trim()) {
                    console.log(chalk.yellow('  Group name required.'));
                    continue;
                  }
                  const groupDesc = await input({ message: 'Group description (optional):' });
                  try {
                    manifest.createGroup(newName, groupDesc || undefined);
                  } catch {
                    // Group might already exist, that's ok
                  }
                  groupsList.push(newName);
                  continue;
                }

                repoGroupMap = result as Map<string, string>;
                break;
              }

              if (wentBack) break;
              state = 'tags';
              break;
            }

            case 'tags': {
              const existingTags = manifest.getAllTags();
              const folderTags = new Set<string>();
              for (const repo of selected) {
                const parts = repo.relativePath.split('/');
                const folder = parts.length > 1 ? parts[0] : 'root';
                folderTags.add(folder.toLowerCase().replace(/[^a-z0-9-]/g, '-'));
              }
              const tagsList = [...new Set([...existingTags, ...folderTags])];

              let currentTagAssignments: Map<string, string[]> | undefined =
                repoTags.size > 0 ? repoTags : undefined;

              let wentBack = false;

              while (true) {
                const result = await tagAssigner({
                  message: 'Assign tags to repos (press 0-9 to toggle):',
                  repos: selected.map((r) => ({ name: r.name, path: r.relativePath })),
                  tags: tagsList,
                  assignments: currentTagAssignments,
                  pageSize: 20,
                });

                if (result === BACK) {
                  wentBack = true;
                  state = 'group';
                  break;
                }

                if (typeof result === 'object' && 'action' in result && result.action === 'new_tag') {
                  const req = result as NewTagRequest;
                  currentTagAssignments = req.assignments;

                  const newTagName = await input({ message: 'New tag name:' });
                  const trimmed = newTagName.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
                  if (trimmed && !tagsList.includes(trimmed)) {
                    tagsList.push(trimmed);
                    console.log(chalk.green(`  ✓ Added tag "${trimmed}"`));
                  } else if (tagsList.includes(trimmed)) {
                    console.log(chalk.yellow(`  Tag "${trimmed}" already exists.`));
                  }
                  continue;
                }

                repoTags = result as Map<string, string[]>;
                break;
              }

              if (wentBack) break;
              state = 'done';
              break;
            }
          }
      }

      if (state === 'cancel') {
        console.log(chalk.yellow('\n  Cancelled.\n'));
        return;
      }

      // Add repos to manifest using per-repo group assignments
      let added = 0;
      const groupCounts = new Map<string, number>();
      for (const repo of selected) {
        const targetGroup = repoGroupMap.get(repo.name) ?? 'default';
        const repoConfig: RepoConfig = {
          name: repo.name,
          path: repo.relativePath,
          remote: 'origin',
          url: repo.remoteUrl,
          branches: { dev: 'develop', staging: 'staging', prod: 'main' },
          tags: repoTags.get(repo.name) ?? [],
        };

        try {
          manifest.addRepo(targetGroup, repoConfig);
          added++;
          groupCounts.set(targetGroup, (groupCounts.get(targetGroup) ?? 0) + 1);
        } catch (err: any) {
          console.log(chalk.yellow(`  ⚠ Skipped ${repo.name}: ${err.message}`));
        }
      }

      manifest.save();
      const groupSummary = Array.from(groupCounts.entries())
        .map(([g, n]) => `${g} (${n})`)
        .join(', ');
      console.log(chalk.green(`\n  ✓ Added ${added} repo(s) across groups: ${groupSummary}`));

      const allTags = new Set(Array.from(repoTags.values()).flat());
      if (allTags.size > 0) {
        console.log(chalk.dim(`    Tags applied: ${Array.from(allTags).join(', ')}`));
      }
      console.log();
    });
}

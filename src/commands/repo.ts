import type { Command } from 'commander';
import chalk from 'chalk';
import { checkbox, select, input } from '@inquirer/prompts';
import { ManifestManager } from '../config/manifest.js';
import { APP_NAME } from '../config/branding.js';
import type { RepoConfig } from '../config/schema.js';

export function registerRepo(program: Command): void {
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
      const repo: RepoConfig = { name, path: repoPath, remote: opts.remote, url: opts.url, branches, tags: [] };
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
        console.log(chalk.yellow(`No repos configured. Use: ${APP_NAME} repo add <group> <name> <path>`));
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
        console.log(chalk.yellow(`\n  No tags defined. Use: ${APP_NAME} repo tag\n`));
        return;
      }

      console.log(chalk.bold('\n  Tags:\n'));
      for (const [tag, count] of Array.from(tagCounts.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
        console.log(`    ${chalk.magenta(tag)} ${chalk.dim(`(${count} repo${count > 1 ? 's' : ''})`)}`);
      }
      console.log();
    });
}

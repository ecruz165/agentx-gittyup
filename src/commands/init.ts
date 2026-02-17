import type { Command } from 'commander';
import chalk from 'chalk';
import { select, checkbox } from '@inquirer/prompts';
import { ManifestManager } from '../config/manifest.js';
import { APP_NAME, APP_CONFIG_DIR } from '../config/branding.js';
import { detectGitRoot, getRepoConfigHome } from '../utils/git.js';
import { AGENT_FILES, AI_TOOLING_CHOICES, installContext } from '../context/index.js';
import type { AITooling } from '../context/index.js';

export function registerInit(program: Command): void {
  program
    .command('init')
    .description(`Initialize a new ${APP_NAME} workspace`)
    .action(async () => {
      try {
        const gitRoot = detectGitRoot();
        let targetDir: string;

        if (gitRoot) {
          const repoDir = getRepoConfigHome(gitRoot);
          const location = await select({
            message: 'Where should the config be stored?',
            choices: [
              {
                name: `Project  ${chalk.dim(repoDir)}`,
                value: 'repo' as const,
                description: 'Per-repo defaults for groups, PRs, and tags',
              },
              {
                name: `Global   ${chalk.dim(APP_CONFIG_DIR)}`,
                value: 'home' as const,
                description: 'Shared config across all projects',
              },
            ],
          });
          targetDir = location === 'repo' ? repoDir : APP_CONFIG_DIR;
        } else {
          targetDir = APP_CONFIG_DIR;
        }

        const mgr = ManifestManager.init(targetDir);
        console.log(chalk.green(`\n✓ Created ${mgr.manifestPath}`));

        // ── AI tool context installation ────────────────────────
        if (gitRoot) {
          const tooling = await select<AITooling | 'skip'>({
            message: 'Install agent & command context files for an AI coding tool?',
            choices: [
              ...AI_TOOLING_CHOICES.map((c) => ({
                name: c.label,
                value: c.value,
                description: c.description,
              })),
              {
                name: chalk.dim('Skip'),
                value: 'skip' as const,
                description: 'No context files',
              },
            ],
          });

          if (tooling !== 'skip') {
            const agentIds = await checkbox({
              message: 'Which agent roles to install?',
              choices: AGENT_FILES.map((f) => ({
                name: `${f.label} ${chalk.dim(`— ${f.description}`)}`,
                value: f.id,
                checked: true,
              })),
            });

            if (agentIds.length > 0) {
              const result = await installContext(gitRoot, agentIds, tooling);
              console.log(chalk.green(`✓ Installed ${result.files.length} context file(s):`));
              for (const f of result.files) {
                console.log(chalk.dim(`    ${f}`));
              }
            }
          }
        }

        console.log(chalk.dim('\n  Edit the manifest to add your repos, or use:'));
        console.log(chalk.dim(`    ${APP_NAME} repo add <group> <name> <path>`));
        console.log(chalk.dim(`    ${APP_NAME} find <directory>\n`));
      } catch (err: any) {
        console.error(chalk.red(err.message));
        process.exit(1);
      }
    });
}

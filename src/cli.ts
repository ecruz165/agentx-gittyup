import { Command } from 'commander';
import chalk from 'chalk';
import { APP_NAME } from './config/branding.js';
import { resolveManifestPath } from './config/manifest.js';
import {
  registerInit,
  registerRepo,
  registerFind,
  registerGroup,
  registerStatus,
  registerFetch,
  registerCompare,
  registerMerge,
  registerPick,
  registerPrs,
  registerCache,
  registerAuth,
  registerConfig,
  registerRebrand,
} from './commands/index.js';

const program = new Command();

program
  .name(APP_NAME)
  .description('Multi-repo orchestration CLI with interactive conflict resolution')
  .version('0.1.0');

// ─── Register commands ─────────────────────────────────────────────
registerInit(program);
registerRepo(program);
registerFind(program);
registerGroup(program);
registerStatus(program);
registerFetch(program);
registerCompare(program);
registerMerge(program);
registerPick(program);
registerPrs(program);
registerCache(program);
registerAuth(program);
registerConfig(program);
registerRebrand(program);

// ─── Post-action: display config path ─────────────────────────────
program.hook('postAction', () => {
  const { manifestPath, location } = resolveManifestPath();
  console.log(chalk.dim(`  config: ${manifestPath} [${location}]`));
});

// ─── Parse and execute ─────────────────────────────────────────────
program.parse();

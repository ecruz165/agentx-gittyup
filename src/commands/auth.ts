import type { Command } from 'commander';
import chalk from 'chalk';
import { APP_NAME } from '../config';

export function registerAuth(program: Command): void {
  const authCmd = program.command('auth').description('GitHub / Copilot authentication');

  authCmd
    .command('login')
    .description('Authenticate with GitHub Copilot via OAuth device flow')
    .action(async () => {
      const { login } = await import('../auth/device-flow.js');
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
      const { printAuthStatus } = await import('../auth/token-manager.js');
      console.log(chalk.bold('\n  Auth Status:\n'));
      await printAuthStatus();
      console.log();
    });

  authCmd
    .command('logout')
    .description('Remove stored credentials')
    .action(async () => {
      const { deleteAuthCredentials } = await import('../auth/token-manager.js');
      await deleteAuthCredentials();
      console.log(chalk.green('  ✓ Credentials removed'));
    });

  authCmd
    .command('models')
    .description('List available Copilot models')
    .action(async () => {
      const { fetchCopilotModels } = await import('../auth/token-manager.js');
      const models = await fetchCopilotModels();
      if (!models) {
        console.log(chalk.yellow(`  Could not fetch models. Run "${APP_NAME} auth login" first.`));
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
}

import chalk from 'chalk';
import Table from 'cli-table3';
import type { RepoState } from '../config/schema.js';

/**
 * TUI dashboard for displaying branch state across repos.
 */
export class Dashboard {
  /** Render full dashboard grouped by repo group. */
  static render(states: RepoState[], options?: { compact?: boolean }): void {
    const compact = options?.compact ?? false;

    console.log(chalk.bold.white(`\n  GITTYUP DASHBOARD  │  ${states.length} repo(s)  │  ${new Date().toLocaleString()}\n`));

    const grouped = new Map<string, RepoState[]>();
    for (const s of states) {
      const list = grouped.get(s.group) ?? [];
      list.push(s);
      grouped.set(s.group, list);
    }

    for (const [groupName, repos] of grouped) {
      console.log(chalk.blue.bold(`  ┌─ ${groupName} ─${'─'.repeat(50)}`));

      const table = new Table({
        head: [chalk.dim('Repo'), chalk.dim('Branch'), chalk.dim('↑ Ahead'), chalk.dim('↓ Behind'), chalk.dim('Status'), chalk.dim('Last Commit')],
        chars: {
          top: '', 'top-mid': '', 'top-left': '', 'top-right': '',
          bottom: '', 'bottom-mid': '', 'bottom-left': '', 'bottom-right': '',
          left: chalk.dim('  │ '), 'left-mid': '', mid: '', 'mid-mid': '',
          right: '', 'right-mid': '', middle: chalk.dim(' │ '),
        },
        style: { 'padding-left': 0, 'padding-right': 1 },
      });

      for (const repo of repos) {
        if (repo.error) {
          table.push([chalk.red(repo.name), chalk.red('ERROR'), '-', '-', chalk.red('⚠ ' + repo.error.substring(0, 30)), '-']);
          continue;
        }

        const branchEntries = Object.entries(repo.branches);
        if (compact || branchEntries.length === 0) {
          table.push([chalk.white.bold(repo.name), chalk.cyan(repo.currentBranch), '-', '-', repo.hasUnresolved ? chalk.red('⚡ CONFLICTS') : chalk.green('✓ ok'), '-']);
        } else {
          for (let i = 0; i < branchEntries.length; i++) {
            const [alias, state] = branchEntries[i];
            const repoCol = i === 0 ? chalk.white.bold(repo.name) : '';
            const branchLabel = state.branch === repo.currentBranch ? chalk.cyan.bold(`${alias} (${state.branch}) ●`) : chalk.dim(`${alias} (${state.branch})`);
            const aheadStr = state.ahead > 0 ? chalk.green(`+${state.ahead}`) : chalk.dim('0');
            const behindStr = state.behind > 0 ? chalk.red(`-${state.behind}`) : chalk.dim('0');

            const icons: string[] = [];
            if (state.hasConflicts) icons.push(chalk.red('⚡conflict'));
            if (state.isDirty) icons.push(chalk.yellow('●dirty'));
            if (state.ahead > 0 && state.behind > 0) icons.push(chalk.magenta('↕diverged'));
            if (icons.length === 0) icons.push(chalk.green('✓'));

            table.push([repoCol, branchLabel, aheadStr, behindStr, icons.join(' '), chalk.dim(state.lastCommit)]);
          }
        }
      }

      console.log(table.toString());
      console.log();
    }

    const totalConflicts = states.filter((s) => s.hasUnresolved).length;
    const totalErrors = states.filter((s) => s.error).length;
    const summary: string[] = [];
    if (totalConflicts > 0) summary.push(chalk.red(`${totalConflicts} conflict(s)`));
    if (totalErrors > 0) summary.push(chalk.red(`${totalErrors} error(s)`));
    if (totalConflicts === 0 && totalErrors === 0) summary.push(chalk.green('All clean'));
    console.log(chalk.dim(`  Summary: ${summary.join(' │ ')}\n`));
  }

  /** Render operation results (merge/cherry-pick) as a table. */
  static renderOperationResults(results: Array<{ repo: string; status: string; message: string; prUrl?: string }>, operation: string): void {
    console.log(chalk.bold(`\n  ${operation.toUpperCase()} RESULTS\n`));
    const table = new Table({
      head: [chalk.dim('Repo'), chalk.dim('Status'), chalk.dim('Details')],
      chars: { top: '', 'top-mid': '', 'top-left': '', 'top-right': '', bottom: '', 'bottom-mid': '', 'bottom-left': '', 'bottom-right': '', left: '  ', 'left-mid': '', mid: '', 'mid-mid': '', right: '', 'right-mid': '', middle: chalk.dim(' │ ') },
    });

    for (const r of results) {
      const statusStr = r.status === 'success' ? chalk.green('✓ Success') : r.status === 'conflict' ? chalk.yellow('⚡ Conflict') : r.status === 'error' ? chalk.red('✗ Error') : chalk.dim(r.status);
      const details = r.prUrl ? `${r.message} ${chalk.blue(r.prUrl)}` : r.message;
      table.push([chalk.white(r.repo), statusStr, details]);
    }
    console.log(table.toString() + '\n');
  }
}

import type { Command } from 'commander';
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { load as loadYaml } from 'js-yaml';
import chalk from 'chalk';
import { APP_GROUP_NAME, APP_GROUP_INITIALS, APP_NAME } from '../config/branding.js';

// ── Types ────────────────────────────────────────────────────

interface BrandingConfig {
  appGroupName: string;
  appGroupInitials: string;
  appName: string;
  description?: string;
  version?: string;
  repo_url?: string;
  author?: string;
  license?: string;
  keywords?: string[];
  files_to_update?: string[];
  files_to_rename?: Array<{ from: string; to: string }>;
}

interface DerivedBrand {
  appGroupName: string;
  appGroupInitials: string;
  appName: string;
  cliBinName: string;
  configParentDir: string;
  configDirName: string;
  manifestFilename: string;
  configDirDisplay: string;
  envConfigOverride: string;
}

// ── Helpers ──────────────────────────────────────────────────

function deriveBrand(group: string, initials: string, name: string): DerivedBrand {
  return {
    appGroupName: group,
    appGroupInitials: initials,
    appName: name,
    cliBinName: `${group}-${name}`,
    configParentDir: `.${group}`,
    configDirName: name,
    manifestFilename: `${name}.yaml`,
    configDirDisplay: `~/.${group}/${name}`,
    envConfigOverride: `${group.toUpperCase()}_HOME`,
  };
}

function resolveBranding(yamlPath: string): BrandingConfig {
  const raw = readFileSync(yamlPath, 'utf-8');
  const parsed = loadYaml(raw) as BrandingConfig;

  if (!parsed.appGroupName || !parsed.appName) {
    throw new Error('branding.yaml must define appGroupName and appName');
  }

  // Default initials to first two chars of group name if not specified
  if (!parsed.appGroupInitials) {
    parsed.appGroupInitials = parsed.appGroupName.slice(0, 2);
  }

  return parsed;
}

function buildReplacements(current: DerivedBrand, next: DerivedBrand): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];

  // Order: most specific → most generic to avoid partial matches
  if (current.configDirDisplay !== next.configDirDisplay) {
    pairs.push([current.configDirDisplay, next.configDirDisplay]);
  }
  if (current.cliBinName !== next.cliBinName) {
    pairs.push([current.cliBinName, next.cliBinName]);
  }
  if (current.configParentDir !== next.configParentDir) {
    pairs.push([current.configParentDir, next.configParentDir]);
  }
  if (current.manifestFilename !== next.manifestFilename) {
    pairs.push([current.manifestFilename, next.manifestFilename]);
  }
  if (current.envConfigOverride !== next.envConfigOverride) {
    pairs.push([current.envConfigOverride, next.envConfigOverride]);
  }
  if (current.appGroupInitials !== next.appGroupInitials) {
    pairs.push([current.appGroupInitials, next.appGroupInitials]);
  }
  if (current.appGroupName !== next.appGroupName) {
    pairs.push([current.appGroupName, next.appGroupName]);
  }
  if (current.appName !== next.appName) {
    pairs.push([current.appName, next.appName]);
  }

  return pairs;
}

function updateFileContent(filePath: string, replacements: Array<[string, string]>, dryRun: boolean): boolean {
  const original = readFileSync(filePath, 'utf-8');
  let content = original;

  for (const [from, to] of replacements) {
    content = content.replaceAll(from, to);
  }

  if (content === original) return false;

  if (!dryRun) {
    writeFileSync(filePath, content, 'utf-8');
  }
  return true;
}

function updatePackageJson(
  pkgPath: string,
  current: DerivedBrand,
  next: DerivedBrand,
  config: BrandingConfig,
  dryRun: boolean,
): boolean {
  const raw = readFileSync(pkgPath, 'utf-8');
  const pkg = JSON.parse(raw);
  let changed = false;

  if (pkg.name === current.appName || pkg.name === current.cliBinName) {
    pkg.name = next.appName;
    changed = true;
  }

  if (pkg.bin && pkg.bin[current.cliBinName]) {
    const binPath = pkg.bin[current.cliBinName].replace(current.cliBinName, next.cliBinName);
    delete pkg.bin[current.cliBinName];
    pkg.bin[next.cliBinName] = binPath;
    changed = true;
  }

  if (config.version && config.version !== pkg.version) {
    pkg.version = config.version;
    changed = true;
  }
  if (config.description && config.description !== pkg.description) {
    pkg.description = config.description;
    changed = true;
  }
  if (config.author && config.author !== pkg.author) {
    pkg.author = config.author;
    changed = true;
  }
  if (config.license && config.license !== pkg.license) {
    pkg.license = config.license;
    changed = true;
  }
  if (config.keywords && JSON.stringify(config.keywords) !== JSON.stringify(pkg.keywords)) {
    pkg.keywords = config.keywords;
    changed = true;
  }

  if (changed && !dryRun) {
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
  }

  return changed;
}

function interpolatePlaceholders(template: string, brand: DerivedBrand): string {
  return template
    .replaceAll('{{appGroupName}}', brand.appGroupName)
    .replaceAll('{{appGroupInitials}}', brand.appGroupInitials)
    .replaceAll('{{appName}}', brand.appName)
    .replaceAll('{{cliBinName}}', brand.cliBinName);
}

function renameFiles(
  renames: Array<{ from: string; to: string }>,
  rootDir: string,
  next: DerivedBrand,
  dryRun: boolean,
): string[] {
  const renamed: string[] = [];

  for (const entry of renames) {
    const fromPath = resolve(rootDir, entry.from);
    const toPath = resolve(rootDir, interpolatePlaceholders(entry.to, next));

    if (fromPath === toPath) continue;
    if (!existsSync(fromPath)) {
      console.warn(`  skip: ${entry.from} (not found)`);
      continue;
    }

    if (!dryRun) {
      renameSync(fromPath, toPath);
    }
    renamed.push(`${entry.from} → ${interpolatePlaceholders(entry.to, next)}`);
  }

  return renamed;
}

function resolveGlobs(patterns: string[], rootDir: string): string[] {
  const { globSync } = require('node:fs');
  const files = new Set<string>();

  for (const pattern of patterns) {
    try {
      const matches = globSync(pattern, { cwd: rootDir });
      for (const match of matches) {
        files.add(resolve(rootDir, match as string));
      }
    } catch {
      const literal = resolve(rootDir, pattern);
      if (existsSync(literal)) {
        files.add(literal);
      }
    }
  }

  return [...files];
}

// ── Execute ──────────────────────────────────────────────────

function executeRebrand(rootDir: string, dryRun: boolean): void {
  const yamlPath = join(rootDir, 'branding.yaml');

  if (!existsSync(yamlPath)) {
    throw new Error('branding.yaml not found at project root.');
  }

  const config = resolveBranding(yamlPath);
  const current = deriveBrand(APP_GROUP_NAME, APP_GROUP_INITIALS, APP_NAME);
  const next = deriveBrand(config.appGroupName, config.appGroupInitials, config.appName);

  if (
    current.appGroupName === next.appGroupName &&
    current.appGroupInitials === next.appGroupInitials &&
    current.appName === next.appName
  ) {
    console.log(chalk.yellow('No brand changes detected (current values match branding.yaml).'));
    return;
  }

  if (dryRun) {
    console.log(chalk.dim('[DRY RUN] No files will be modified.\n'));
  }

  console.log(chalk.bold(`Rebranding: ${current.cliBinName} → ${next.cliBinName}`));
  console.log(`  Group:    ${current.appGroupName} → ${next.appGroupName}`);
  console.log(`  Initials: ${current.appGroupInitials} → ${next.appGroupInitials}`);
  console.log(`  Name:     ${current.appName} → ${next.appName}\n`);

  const replacements = buildReplacements(current, next);

  const filePatterns = config.files_to_update ?? ['src/**/*.ts', 'bin/**/*.js', 'package.json'];
  const files = resolveGlobs(filePatterns, rootDir);

  let updatedCount = 0;

  for (const filePath of files) {
    const isPackageJson = filePath.endsWith('package.json');

    if (isPackageJson) {
      const changed = updatePackageJson(filePath, current, next, config, dryRun);
      if (changed) {
        console.log(`  updated: package.json`);
        updatedCount++;
      }
    }

    const changed = updateFileContent(filePath, replacements, dryRun);
    if (changed) {
      const relative = filePath.replace(rootDir + '/', '');
      console.log(`  updated: ${relative}`);
      updatedCount++;
    }
  }

  // File renames
  const renames = config.files_to_rename ?? [];
  if (renames.length > 0) {
    const renamed = renameFiles(renames, rootDir, next, dryRun);
    for (const r of renamed) {
      console.log(`  renamed: ${r}`);
    }
  }

  // Update branding.ts (the source of truth)
  const brandingPath = join(rootDir, 'src', 'config', 'branding.ts');
  if (existsSync(brandingPath)) {
    const brandingContent = readFileSync(brandingPath, 'utf-8');
    let updated = brandingContent;
    updated = updated.replace(
      `const APP_GROUP_NAME = '${current.appGroupName}'`,
      `const APP_GROUP_NAME = '${next.appGroupName}'`,
    );
    updated = updated.replace(
      `const APP_GROUP_INITIALS = '${current.appGroupInitials}'`,
      `const APP_GROUP_INITIALS = '${next.appGroupInitials}'`,
    );
    updated = updated.replace(
      `const APP_NAME = '${current.appName}'`,
      `const APP_NAME = '${next.appName}'`,
    );
    if (updated !== brandingContent) {
      if (!dryRun) {
        writeFileSync(brandingPath, updated, 'utf-8');
      }
      console.log('  updated: src/config/branding.ts');
      updatedCount++;
    }
  }

  console.log(`\n${dryRun ? 'Would update' : 'Updated'} ${updatedCount} file(s).`);

  if (!dryRun) {
    console.log(chalk.dim('\nDone! Remember to:'));
    console.log(chalk.dim('  1. Run `npm run build` to rebuild'));
    console.log(chalk.dim('  2. Run `npm test` to verify'));
  }
}

// ── Command registration ─────────────────────────────────────

export function registerRebrand(program: Command): void {
  program
    .command('rebrand', { hidden: true })
    .description('Apply branding changes from branding.yaml')
    .option('--dry-run', 'Preview changes without modifying files', false)
    .action(async (opts: { dryRun: boolean }) => {
      try {
        // Resolve project root from the compiled file's location:
        // dist/commands/rebrand.js → up 2 levels → project root
        // Falls back to cwd if import.meta.dirname is unavailable.
        const rootDir = import.meta.dirname
          ? resolve(import.meta.dirname, '..', '..')
          : process.cwd();
        executeRebrand(rootDir, opts.dryRun);
      } catch (err: any) {
        console.error(chalk.red(`Error: ${err.message}`));
        process.exit(1);
      }
    });
}

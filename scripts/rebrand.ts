#!/usr/bin/env npx tsx
/**
 * Rebrand Script
 *
 * Reads branding.yaml and updates all source files with the new brand values.
 * Run with: npm run rebrand
 */

import { readFileSync, writeFileSync, existsSync, renameSync, mkdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import yaml from 'js-yaml';

/** Raw YAML shape — only appGroupName and appName are required. */
interface BrandingYaml {
  appGroupName: string;
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

/** Fully resolved branding config with all derived values. */
interface BrandingConfig {
  appGroupName: string;
  appName: string;
  cli_name: string;
  package_name: string;
  bin_name: string;
  config_file: string;
  config_parent_dir: string;
  config_dir_name: string;
  description: string;
  version: string;
  repo_url: string;
  author: string;
  license: string;
  keywords: string[];
  files_to_update: string[];
  files_to_rename: Array<{ from: string; to: string }>;
}

const ROOT_DIR = join(import.meta.dirname, '..');
const BRANDING_FILE = join(ROOT_DIR, 'scripts', 'branding.yaml');

// Current branding — used as the "find" side of find-and-replace.
const CURRENT_APP_GROUP_NAME = 'agentx';
const CURRENT_APP_NAME = 'gittyup';

const DEFAULTS = {
  appGroupName: CURRENT_APP_GROUP_NAME,
  appName: CURRENT_APP_NAME,
  cli_name: CURRENT_APP_NAME,
  package_name: CURRENT_APP_NAME,
  bin_name: CURRENT_APP_NAME,
  config_file: `${CURRENT_APP_NAME}.yaml`,
  config_parent_dir: `.${CURRENT_APP_GROUP_NAME}`,
  config_dir_name: CURRENT_APP_NAME,
  repo_url: `https://github.com/ecruz165/agentx-${CURRENT_APP_NAME}`,
  author: 'ecruz165',
};

/** Derive all branding values from the two root primitives + optional overrides. */
function resolveBranding(raw: BrandingYaml): BrandingConfig {
  const { appGroupName, appName } = raw;
  return {
    appGroupName,
    appName,
    cli_name: appName,
    package_name: appName,
    bin_name: appName,
    config_file: `${appName}.yaml`,
    config_parent_dir: `.${appGroupName}`,
    config_dir_name: appName,
    description: raw.description ?? 'Multi-repo orchestration CLI with interactive conflict resolution',
    version: raw.version ?? '0.1.0',
    repo_url: raw.repo_url ?? `https://github.com/ecruz165/agentx-${appName}`,
    author: raw.author ?? 'ecruz165',
    license: raw.license ?? 'MIT',
    keywords: raw.keywords ?? ['git', 'multi-repo', 'cherry-pick', 'merge', 'conflict-resolution', 'cli'],
    files_to_update: raw.files_to_update ?? [],
    files_to_rename: raw.files_to_rename ?? [],
  };
}

function loadBranding(): BrandingConfig {
  if (!existsSync(BRANDING_FILE)) {
    throw new Error(`Branding file not found: ${BRANDING_FILE}`);
  }
  const content = readFileSync(BRANDING_FILE, 'utf-8');
  const raw = yaml.load(content) as BrandingYaml;
  if (!raw.appGroupName || !raw.appName) {
    throw new Error('branding.yaml must define appGroupName and appName');
  }
  return resolveBranding(raw);
}

function interpolate(template: string, brand: BrandingConfig): string {
  return template
    .replace(/\{\{appGroupName\}\}/g, brand.appGroupName)
    .replace(/\{\{appName\}\}/g, brand.appName)
    .replace(/\{\{cli_name\}\}/g, brand.cli_name)
    .replace(/\{\{bin_name\}\}/g, brand.bin_name)
    .replace(/\{\{config_file\}\}/g, brand.config_file)
    .replace(/\{\{config_parent_dir\}\}/g, brand.config_parent_dir)
    .replace(/\{\{config_dir_name\}\}/g, brand.config_dir_name)
    .replace(/\{\{repo_url\}\}/g, brand.repo_url)
    .replace(/\{\{author\}\}/g, brand.author);
}

function updateFileContent(filePath: string, brand: BrandingConfig): boolean {
  const fullPath = join(ROOT_DIR, filePath);
  if (!existsSync(fullPath)) {
    console.log(`  ⚠ Skipped (not found): ${filePath}`);
    return false;
  }

  let content = readFileSync(fullPath, 'utf-8');
  const original = content;

  // Replace old values with new values (order matters — specific patterns first)
  const replacements: Array<[RegExp, string]> = [
    // Repo URL (most specific, replace first to avoid partial matches)
    [new RegExp(DEFAULTS.repo_url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), brand.repo_url],
    // Config file references (e.g., gittyup.yaml)
    [new RegExp(DEFAULTS.config_file.replace('.', '\\.'), 'g'), brand.config_file],
    // Config parent dir references (e.g., .agentx)
    [new RegExp(DEFAULTS.config_parent_dir.replace('.', '\\.'), 'g'), brand.config_parent_dir],
    // App group name (e.g., agentx as a word)
    [new RegExp(`\\b${DEFAULTS.appGroupName}\\b`, 'g'), brand.appGroupName],
    // App name / CLI name (e.g., gittyup as a word)
    [new RegExp(`\\b${DEFAULTS.appName}\\b`, 'g'), brand.appName],
    // Author
    [new RegExp(`\\b${DEFAULTS.author}\\b`, 'g'), brand.author],
  ];

  for (const [pattern, replacement] of replacements) {
    content = content.replace(pattern, replacement);
  }

  if (content !== original) {
    writeFileSync(fullPath, content, 'utf-8');
    console.log(`  ✓ Updated: ${filePath}`);
    return true;
  }

  console.log(`  - No changes: ${filePath}`);
  return false;
}

function updatePackageJson(brand: BrandingConfig): void {
  const pkgPath = join(ROOT_DIR, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));

  pkg.name = brand.package_name;
  pkg.version = brand.version;
  pkg.description = brand.description;
  pkg.license = brand.license;
  pkg.keywords = brand.keywords;

  // Update bin entry
  delete pkg.bin[DEFAULTS.bin_name];
  pkg.bin[brand.bin_name] = `./bin/${brand.bin_name}.js`;

  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
  console.log(`  ✓ Updated: package.json (name, version, bin, etc.)`);
}

function renameFiles(brand: BrandingConfig): void {
  for (const { from, to } of brand.files_to_rename) {
    const fromPath = join(ROOT_DIR, from);
    const toPath = join(ROOT_DIR, interpolate(to, brand));

    if (!existsSync(fromPath)) {
      // Try with the new name (already renamed)
      if (existsSync(toPath)) {
        console.log(`  - Already renamed: ${to}`);
        continue;
      }
      console.log(`  ⚠ Skipped (not found): ${from}`);
      continue;
    }

    if (fromPath === toPath) {
      console.log(`  - No rename needed: ${from}`);
      continue;
    }

    // Ensure target directory exists
    const targetDir = dirname(toPath);
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }

    renameSync(fromPath, toPath);
    console.log(`  ✓ Renamed: ${from} → ${basename(toPath)}`);
  }
}

async function main(): Promise<void> {
  console.log('\n🎨 Rebrand Script\n');

  const brand = loadBranding();
  console.log(`  Group: ${brand.appGroupName}`);
  console.log(`  App:   ${brand.appName} (${brand.package_name}@${brand.version})\n`);

  console.log('📝 Updating file contents...\n');
  for (const file of brand.files_to_update) {
    updateFileContent(file, brand);
  }

  console.log('\n📦 Updating package.json...\n');
  updatePackageJson(brand);

  console.log('\n📁 Renaming files...\n');
  renameFiles(brand);

  console.log('\n✅ Rebrand complete!\n');
  console.log('Next steps:');
  console.log('  1. Review changes: git diff');
  console.log('  2. Rebuild: npm run build');
  console.log('  3. Test: npm test');
  console.log('  4. Commit: git add -A && git commit -m "chore: rebrand to ' + brand.cli_name + '"');
  console.log();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});


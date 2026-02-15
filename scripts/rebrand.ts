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

interface BrandingConfig {
  cli_name: string;
  package_name: string;
  description: string;
  version: string;
  bin_name: string;
  config_file: string;
  config_dir: string;
  repo_url: string;
  author: string;
  license: string;
  keywords: string[];
  files_to_update: string[];
  files_to_rename: Array<{ from: string; to: string }>;
}

const ROOT_DIR = join(import.meta.dirname, '..');
const BRANDING_FILE = join(ROOT_DIR, 'branding.yaml');

// Default values (current branding) - used for replacement patterns
const DEFAULTS = {
  cli_name: 'gittyup',
  package_name: 'gittyup',
  bin_name: 'gittyup',
  config_file: 'gittyup.yaml',
  config_dir: '.gittyup',
  repo_url: 'https://github.com/ecruz165/gittyup',
  author: 'ecruz165',
};

function loadBranding(): BrandingConfig {
  if (!existsSync(BRANDING_FILE)) {
    throw new Error(`Branding file not found: ${BRANDING_FILE}`);
  }
  const content = readFileSync(BRANDING_FILE, 'utf-8');
  return yaml.load(content) as BrandingConfig;
}

function interpolate(template: string, brand: BrandingConfig): string {
  return template
    .replace(/\{\{cli_name\}\}/g, brand.cli_name)
    .replace(/\{\{bin_name\}\}/g, brand.bin_name)
    .replace(/\{\{config_file\}\}/g, brand.config_file)
    .replace(/\{\{config_dir\}\}/g, brand.config_dir)
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

  // Replace old values with new values
  const replacements: Array<[RegExp, string]> = [
    // CLI name references
    [new RegExp(`\\b${DEFAULTS.cli_name}\\b`, 'g'), brand.cli_name],
    // Config file references
    [new RegExp(DEFAULTS.config_file.replace('.', '\\.'), 'g'), brand.config_file],
    // Config dir references (e.g., ~/.gittyup)
    [new RegExp(DEFAULTS.config_dir.replace('.', '\\.'), 'g'), brand.config_dir],
    // Repo URL
    [new RegExp(DEFAULTS.repo_url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), brand.repo_url],
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
  console.log(`  Brand: ${brand.cli_name} (${brand.package_name}@${brand.version})\n`);

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


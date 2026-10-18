#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ModuleKitError,
  generateManifest,
  resolveBuild,
  stableStringify,
} from '../src/index.js';

const args = process.argv.slice(2);
const command = args[0];

function option(name, fallback = null) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

function flag(name) {
  return args.includes(name);
}

async function loadConfig(file = option('--config', 'ubik.config.js')) {
  const absolute = path.resolve(file);
  if (!fs.existsSync(absolute)) {
    throw new ModuleKitError(`No existe ${file}`, { code: 'CONFIG_NOT_FOUND' });
  }
  const mod = await import(pathToFileURL(absolute).href);
  const config = mod.default ?? mod;
  if (!config || typeof config !== 'object') {
    throw new ModuleKitError(`${file} no exporta una config válida`, { code: 'CONFIG_INVALID' });
  }
  return config;
}

async function loadManifest() {
  const config = await loadConfig();
  return generateManifest(config);
}

function outFile() {
  return option('--out', 'ubik.app.json');
}

function print(text) {
  process.stdout.write(`${text}\n`);
}

const help = `module-kit — módulos y builds para productos Ubik

Uso:
  module-kit check                 Valida la config y que ubik.app.json esté sincronizado
  module-kit manifest [--out f]    Genera/actualiza ubik.app.json
  module-kit resolve --build <id>  Muestra los módulos resueltos del build
  module-kit env --build <id>      Imprime UBIK_BUILD_ID y UBIK_MODULES
  module-kit list [modules|builds] Lista módulos o builds

Opciones: --config <file> (por defecto ubik.config.js)`;

async function run() {
  if (!command || command === 'help' || flag('--help') || flag('-h')) {
    print(help);
    return;
  }

  if (command === 'manifest') {
    const manifest = await loadManifest();
    const file = outFile();
    fs.writeFileSync(file, stableStringify(manifest));
    print(`✓ ${file} generado (${Object.keys(manifest.builds).length} builds)`);
    return;
  }

  if (command === 'check') {
    const manifest = await loadManifest();
    const file = outFile();
    if (!fs.existsSync(file)) {
      throw new ModuleKitError(`Falta ${file}; ejecuta "module-kit manifest"`, { code: 'MANIFEST_MISSING' });
    }
    const current = fs.readFileSync(file, 'utf8');
    if (current !== stableStringify(manifest)) {
      throw new ModuleKitError(
        `${file} no está sincronizado con la config; ejecuta "module-kit manifest"`,
        { code: 'MANIFEST_OUTDATED' },
      );
    }
    print(`✓ ${file} sincronizado (${Object.keys(manifest.builds).length} builds)`);
    return;
  }

  if (command === 'resolve') {
    const buildId = option('--build');
    if (!buildId) throw new ModuleKitError('Falta --build <id>', { code: 'MISSING_BUILD' });
    const build = resolveBuild(await loadManifest(), buildId);
    if (flag('--json')) print(JSON.stringify(build, null, 2));
    else print(build.modules.join('\n'));
    return;
  }

  if (command === 'env') {
    const buildId = option('--build');
    if (!buildId) throw new ModuleKitError('Falta --build <id>', { code: 'MISSING_BUILD' });
    const build = resolveBuild(await loadManifest(), buildId);
    const vars = {
      UBIK_BUILD_ID: buildId,
      UBIK_MODULES: build.modules.join(','),
    };
    if (option('--format') === 'json') {
      print(JSON.stringify(vars));
    } else {
      for (const [key, value] of Object.entries(vars)) print(`export ${key}="${value}"`);
    }
    return;
  }

  if (command === 'list') {
    const manifest = await loadManifest();
    const what = args[1] ?? 'all';
    if (what === 'modules' || what === 'all') {
      print('Módulos:');
      for (const [id, mod] of Object.entries(manifest.modules)) {
        const deps = mod.dependsOn.length ? ` (deps: ${mod.dependsOn.join(', ')})` : '';
        print(`  ${id} — ${mod.label}${deps}`);
      }
    }
    if (what === 'builds' || what === 'all') {
      print('Builds:');
      for (const [id, build] of Object.entries(manifest.builds)) {
        print(`  ${id} — ${build.label} [${build.target}, ${build.license}] → ${build.modules.length} módulos`);
      }
    }
    return;
  }

  throw new ModuleKitError(`Comando desconocido: ${command}`, { code: 'UNKNOWN_COMMAND' });
}

run().catch((error) => {
  const prefix = error instanceof ModuleKitError ? `[${error.code}] ` : '';
  console.error(`${prefix}${error.message}`);
  if (error.path) console.error(`  en: ${error.path}`);
  process.exitCode = error instanceof ModuleKitError ? 2 : 1;
});

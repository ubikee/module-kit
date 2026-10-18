import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assembleConfig } from './core.js';

export * from './core.js';
export { verifyLicense } from './license.js';

function currentVersion() {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')).version ?? null;
  } catch {
    return null;
  }
}

// Ensambla la config; la versión sale de package.json del proyecto si no se indica.
export function defineConfig(input = {}) {
  return assembleConfig({
    ...input,
    version: input.version ?? currentVersion() ?? undefined,
  });
}

// Manifiesto serializable y determinista (para `ubik.app.json`).
export function generateManifest(config) {
  return assembleConfig({
    manifestVersion: config.manifestVersion,
    product: config.product,
    version: config.product?.version,
    modules: config.modules,
    builds: config.builds,
    runtime: config.runtime,
  });
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import {
  ModuleKitError,
  assembleConfig,
  authorize,
  canonicalize,
  defineBuilds,
  defineModules,
  generateManifest,
  resolveBuild,
  stableStringify,
  validateManifest,
  verifyLicense,
} from '../src/index.js';

const modules = () =>
  defineModules({
    core: { label: 'Núcleo' },
    favorites: { label: 'Favoritos', dependsOn: ['core'] },
    users: { label: 'Usuarios', dependsOn: ['core'] },
    community: { label: 'Comunidad', dependsOn: ['core', 'users'] },
    rip: { label: 'Rip', dependsOn: ['core'], tools: ['ffmpeg', { name: 'cd-paranoia' }] },
  });

test('defineModules exige core', () => {
  assert.throws(() => defineModules({ favorites: { label: 'F' } }), /core/);
});

test('defineModules rechaza dependencias desconocidas', () => {
  assert.throws(
    () => defineModules({ core: { label: 'C' }, x: { label: 'X', dependsOn: ['nope'] } }),
    (error) => error instanceof ModuleKitError && error.code === 'UNKNOWN_DEPENDENCY',
  );
});

test('defineModules detecta ciclos', () => {
  assert.throws(
    () =>
      defineModules({
        core: { label: 'C' },
        a: { label: 'A', dependsOn: ['b'] },
        b: { label: 'B', dependsOn: ['a'] },
      }),
    (error) => error.code === 'CYCLIC_DEPENDENCY',
  );
});

test('defineBuilds resuelve dependencias y tools', () => {
  const builds = defineBuilds(modules(), {
    basic: { target: 'web', label: 'Basic', license: 'free', modules: ['favorites'] },
    studio: { target: 'server', label: 'Studio', license: 'required', modules: ['community', 'rip'] },
  });
  assert.deepEqual(builds.basic.modules, ['core', 'favorites']);
  assert.deepEqual(builds.studio.modules, ['core', 'users', 'community', 'rip']);
  assert.deepEqual(
    builds.studio.tools.map((tool) => tool.name),
    ['ffmpeg', 'cd-paranoia'],
  );
});

test('defineBuilds exige license y target válidos', () => {
  assert.throws(
    () => defineBuilds(modules(), { x: { target: 'web', label: 'X', modules: ['core'] } }),
    (error) => error.code === 'INVALID_LICENSE',
  );
  assert.throws(
    () => defineBuilds(modules(), { x: { target: 'toaster', label: 'X', license: 'free' } }),
    (error) => error.code === 'INVALID_TARGET',
  );
});

test('generateManifest es determinista y validable', () => {
  const config = assembleConfig({
    product: { id: 'ubik-music', name: 'Ubik Music' },
    version: '1.2.3',
    modules: modules(),
    builds: {
      basic: { target: 'web', label: 'Basic', license: 'free', modules: ['favorites'] },
    },
  });

  const manifest = generateManifest(config);
  const again = generateManifest(config);
  assert.equal(stableStringify(manifest), stableStringify(again));

  const validated = validateManifest(JSON.parse(stableStringify(manifest)));
  assert.equal(validated.product.version, '1.2.3');
  assert.deepEqual(resolveBuild(validated, 'basic').modules, ['core', 'favorites']);
});

test('authorize: free, required, licencia y caducidad', () => {
  const manifest = generateManifest(
    assembleConfig({
      product: { id: 'ubik-music', name: 'Ubik Music' },
      version: '1.0.0',
      modules: modules(),
      builds: {
        'web-basic': { target: 'web', label: 'Web Basic', license: 'free', modules: ['favorites'] },
        'desktop-pro': { target: 'desktop', label: 'Desktop Pro', license: 'required', modules: ['rip'] },
      },
    }),
  );

  assert.equal(authorize({ manifest, buildId: 'web-basic' }).allowed, true);
  assert.deepEqual(authorize({ manifest, buildId: 'desktop-pro' }), {
    allowed: false,
    reason: 'license-required',
  });

  const license = { product: 'ubik-music', builds: ['desktop-pro'], expiresAt: '2030-01-01T00:00:00Z' };
  assert.deepEqual(authorize({ manifest, buildId: 'desktop-pro', license }), {
    allowed: true,
    reason: 'licensed',
  });

  assert.equal(
    authorize({
      manifest,
      buildId: 'desktop-pro',
      license: { ...license, expiresAt: '2000-01-01T00:00:00Z' },
    }).reason,
    'expired',
  );

  assert.equal(
    authorize({ manifest, buildId: 'desktop-pro', license: { ...license, product: 'otro' } }).reason,
    'product-mismatch',
  );
});

test('verifyLicense valida la firma Ed25519', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const payload = {
    schemaVersion: 1,
    product: 'ubik-music',
    plan: 'pro',
    builds: ['desktop-pro'],
    expiresAt: '2030-01-01T00:00:00Z',
  };
  const signature = sign(null, Buffer.from(canonicalize(payload)), privateKey).toString('base64');
  const license = { ...payload, sig: signature };
  const pem = publicKey.export({ type: 'spki', format: 'pem' });

  assert.equal(verifyLicense(license, pem).plan, 'pro');
  assert.throws(() => verifyLicense({ ...payload, sig: 'AAAA' }, pem), (error) => error.code === 'LICENSE_SIGNATURE');
});

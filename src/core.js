// @ubik/module-kit — núcleo puro (browser-safe): módulos, builds y utilidades.
// NO define planes ni precios (eso es responsabilidad de ubik).

const KEBAB = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export const MANIFEST_VERSION = 1;
export const DEFAULT_TARGETS = ['web', 'desktop', 'mobile', 'ios', 'server'];

export class ModuleKitError extends Error {
  constructor(message, { code = 'MODULE_KIT', path = null, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ModuleKitError';
    this.code = code;
    this.path = path;
  }
}

function fail(message, code, path = null) {
  throw new ModuleKitError(message, { code, path });
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertKebab(id, path, kind) {
  if (typeof id !== 'string' || !KEBAB.test(id)) {
    fail(`El ${kind} "${id}" debe ser kebab-case (a-z, 0-9 y "-")`, 'INVALID_ID', path);
  }
}

function normalizeTools(tools, path) {
  if (tools === undefined) return [];
  if (!Array.isArray(tools)) fail('"tools" debe ser un array', 'INVALID_TOOLS', path);
  return tools.map((tool, index) => {
    if (typeof tool === 'string') return { name: tool.trim(), required: true };
    if (!isPlainObject(tool) || typeof tool.name !== 'string' || !tool.name.trim()) {
      fail('Cada tool necesita "name"', 'INVALID_TOOL', `${path}[${index}]`);
    }
    return {
      name: tool.name.trim(),
      required: tool.required !== false,
      ...(tool.version ? { version: String(tool.version) } : {}),
    };
  });
}

function normalizeModule(id, def) {
  const path = `modules.${id}`;
  assertKebab(id, path, 'módulo');
  if (!isPlainObject(def)) fail('La definición de módulo debe ser un objeto', 'INVALID_MODULE', path);
  const label = String(def.label ?? '').trim();
  if (!label) fail('El módulo necesita "label"', 'INVALID_MODULE', path);
  const dependsOn = [...new Set((def.dependsOn ?? []).map((dep) => String(dep)))];
  const tools = normalizeTools(def.tools, `${path}.tools`);
  return {
    label,
    dependsOn,
    tools,
    ...(def.description ? { description: String(def.description) } : {}),
  };
}

// Valida y normaliza el registro de módulos (incluye comprobación de ciclos).
export function defineModules(defs) {
  if (!isPlainObject(defs)) fail('defineModules espera un objeto de módulos', 'INVALID_MODULES');
  if (!defs.core) fail('Debe existir el módulo "core"', 'MISSING_CORE', 'modules.core');

  const modules = {};
  for (const [id, def] of Object.entries(defs)) modules[id] = normalizeModule(id, def);

  for (const [id, mod] of Object.entries(modules)) {
    for (const dep of mod.dependsOn) {
      if (!modules[dep]) {
        fail(`El módulo "${id}" depende de "${dep}", que no existe`, 'UNKNOWN_DEPENDENCY', `modules.${id}.dependsOn`);
      }
      if (dep === id) {
        fail(`El módulo "${id}" no puede depender de sí mismo`, 'CYCLIC_DEPENDENCY', `modules.${id}.dependsOn`);
      }
    }
  }
  assertAcyclic(modules);
  return modules;
}

export function assertAcyclic(modules) {
  const state = new Map();
  const stack = [];
  const visit = (id) => {
    const status = state.get(id);
    if (status === 'done') return;
    if (status === 'visiting') {
      const cycle = [...stack.slice(stack.indexOf(id)), id].join(' -> ');
      fail(`Ciclo de dependencias: ${cycle}`, 'CYCLIC_DEPENDENCY', `modules.${id}`);
    }
    state.set(id, 'visiting');
    stack.push(id);
    for (const dep of modules[id]?.dependsOn ?? []) visit(dep);
    stack.pop();
    state.set(id, 'done');
  };
  for (const id of Object.keys(modules)) visit(id);
}

// Lista ordenada y única con dependencias resueltas (deps antes que el módulo).
export function resolveModuleList(modules, list, path = 'modules') {
  if (!Array.isArray(list)) fail('La lista de módulos debe ser un array', 'INVALID_MODULES', path);
  const out = [];
  const seen = new Set();
  const visit = (id, chain) => {
    if (seen.has(id)) return;
    if (!modules[id]) {
      const suffix = chain.length ? ` (dependencia de ${chain.join(' -> ')})` : '';
      fail(`Módulo desconocido "${id}"${suffix}`, 'UNKNOWN_MODULE', path);
    }
    for (const dep of modules[id].dependsOn) visit(dep, [...chain, id]);
    seen.add(id);
    out.push(id);
  };
  for (const id of list) visit(String(id), []);
  return out;
}

// Valida y normaliza los builds, resolviendo dependencias y agregando tools.
export function defineBuilds(modules, defs, { targets = DEFAULT_TARGETS } = {}) {
  if (!isPlainObject(modules) || !modules.core) {
    fail('defineBuilds necesita módulos válidos (con "core")', 'INVALID_MODULES');
  }
  if (!isPlainObject(defs)) fail('defineBuilds espera un objeto de builds', 'INVALID_BUILDS');

  const builds = {};
  for (const [id, def] of Object.entries(defs)) {
    const path = `builds.${id}`;
    assertKebab(id, path, 'build');
    if (!isPlainObject(def)) fail('La definición de build debe ser un objeto', 'INVALID_BUILD', path);

    const label = String(def.label ?? '').trim();
    if (!label) fail('El build necesita "label"', 'INVALID_BUILD', path);

    if (!targets.includes(def.target)) {
      fail(`target "${def.target}" no válido (usa: ${targets.join(', ')})`, 'INVALID_TARGET', `${path}.target`);
    }
    if (def.license !== 'free' && def.license !== 'required') {
      fail('El build debe declarar license: "free" | "required"', 'INVALID_LICENSE', `${path}.license`);
    }

    const listed = Array.isArray(def.modules) && def.modules.length ? def.modules : ['core'];
    const resolved = resolveModuleList(modules, listed, `${path}.modules`);

    const toolMap = new Map();
    for (const moduleId of resolved) {
      for (const tool of modules[moduleId].tools) {
        if (!toolMap.has(tool.name)) toolMap.set(tool.name, tool);
      }
    }

    builds[id] = {
      target: def.target,
      label,
      license: def.license,
      artifactSuffix: String(def.artifactSuffix ?? id),
      modules: resolved,
      tools: [...toolMap.values()],
    };
  }
  return builds;
}

// Ensambla una config ya normalizada (sin leer package.json).
export function assembleConfig({ manifestVersion = MANIFEST_VERSION, product, version, modules, builds, runtime } = {}) {
  if (!isPlainObject(product) || !product.id) {
    fail('product.id es obligatorio', 'INVALID_PRODUCT', 'product');
  }
  const productId = String(product.id);
  assertKebab(productId, 'product.id', 'producto');
  const name = String(product.name ?? productId).trim();

  const normalizedModules = defineModules(modules);
  const normalizedBuilds = defineBuilds(normalizedModules, builds);

  return {
    manifestVersion,
    product: {
      id: productId,
      name,
      version: String(version ?? '0.0.0'),
    },
    modules: normalizedModules,
    builds: normalizedBuilds,
    runtime: {
      buildIdEnv: 'UBIK_BUILD_ID',
      modulesEnv: 'UBIK_MODULES',
      ...(runtime ?? {}),
    },
  };
}

// Valida un manifest leído (JSON) y lo devuelve normalizado.
export function validateManifest(manifest) {
  if (!isPlainObject(manifest)) fail('El manifest debe ser un objeto', 'INVALID_MANIFEST');
  if (manifest.manifestVersion !== MANIFEST_VERSION) {
    fail(
      `manifestVersion no soportada: ${manifest.manifestVersion} (esperada ${MANIFEST_VERSION})`,
      'UNSUPPORTED_MANIFEST',
      'manifestVersion',
    );
  }
  return assembleConfig({
    manifestVersion: manifest.manifestVersion,
    product: manifest.product,
    version: manifest.product?.version,
    modules: manifest.modules,
    builds: manifest.builds,
    runtime: manifest.runtime,
  });
}

export function resolveBuild(manifest, buildId) {
  const build = manifest?.builds?.[buildId];
  if (!build) fail(`Build desconocido "${buildId}"`, 'UNKNOWN_BUILD', `builds.${buildId}`);
  return build;
}

// Autorización por build id (sin versión). Devuelve { allowed, reason }.
export function authorize({ manifest, buildId, license = null, now = new Date() } = {}) {
  const build = manifest?.builds?.[buildId];
  if (!build) return { allowed: false, reason: 'unknown-build' };

  if (license && typeof license === 'object') {
    if (license.product && manifest?.product?.id && license.product !== manifest.product.id) {
      return { allowed: false, reason: 'product-mismatch' };
    }
    const builds = Array.isArray(license.builds) ? license.builds : [];
    if (builds.includes(buildId)) {
      if (license.expiresAt) {
        const expires = new Date(license.expiresAt);
        const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
        if (!Number.isNaN(expires.getTime()) && expires.getTime() < nowMs) {
          return { allowed: false, reason: 'expired' };
        }
      }
      return { allowed: true, reason: 'licensed' };
    }
  }

  if (build.license === 'free') return { allowed: true, reason: 'free' };
  return { allowed: false, reason: 'license-required' };
}

// JSON canónico (claves ordenadas, sin espacios) para firmar/verificar.
export function canonicalize(value) {
  return JSON.stringify(sortKeys(value));
}

export function stableStringify(value, indent = 2) {
  return `${JSON.stringify(sortKeys(value), null, indent)}\n`;
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!isPlainObject(value)) return value;
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = sortKeys(value[key]);
  return out;
}

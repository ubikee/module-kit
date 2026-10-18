import { createPublicKey, verify } from 'node:crypto';
import { canonicalize, ModuleKitError } from './core.js';

// Verifica una licencia firmada (Ed25519) con la clave pública del producto.
// Formato: { ...payload, sig: <base64> } y firma sobre canonicalize(payload).
export function verifyLicense(license, publicKeyPem) {
  if (!license || typeof license !== 'object' || typeof license.sig !== 'string') {
    throw new ModuleKitError('Licencia inválida', { code: 'LICENSE_INVALID' });
  }
  const { sig, ...payload } = license;

  let key;
  try {
    key = createPublicKey(publicKeyPem);
  } catch (cause) {
    throw new ModuleKitError('Clave pública inválida', { code: 'LICENSE_KEY', cause });
  }

  const data = Buffer.from(canonicalize(payload), 'utf8');
  let ok = false;
  try {
    ok = verify(null, data, key, Buffer.from(sig, 'base64'));
  } catch (cause) {
    throw new ModuleKitError('No se pudo verificar la firma', { code: 'LICENSE_SIGNATURE', cause });
  }
  if (!ok) throw new ModuleKitError('Firma de licencia inválida', { code: 'LICENSE_SIGNATURE' });
  return payload;
}

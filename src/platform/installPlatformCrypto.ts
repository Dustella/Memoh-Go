import * as ExpoCrypto from 'expo-crypto';

/**
 * Hermes ships without Web Crypto. Provide `crypto.randomUUID` and
 * `crypto.getRandomValues` from the platform CSPRNG so client-minted
 * idempotency keys (core/ids.ts) never fall back to Math.random.
 */
export function installPlatformCrypto() {
  const target = globalThis as unknown as { crypto?: Record<string, unknown> };
  const existing = target.crypto ?? {};
  if (typeof existing.randomUUID === 'function' && typeof existing.getRandomValues === 'function') return;
  target.crypto = {
    ...existing,
    randomUUID: existing.randomUUID ?? (() => ExpoCrypto.randomUUID()),
    getRandomValues: existing.getRandomValues ?? (<T extends Uint8Array>(array: T) => ExpoCrypto.getRandomValues(array)),
  };
}

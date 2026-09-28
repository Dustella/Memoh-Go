type CryptoLike = {
  randomUUID?: () => string;
  getRandomValues?: <T extends Uint8Array>(array: T) => T;
};

export type RandomSource = 'randomUUID' | 'getRandomValues' | 'math';

function runtimeCrypto(): CryptoLike | undefined {
  return (globalThis as { crypto?: CryptoLike }).crypto;
}

/** Which entropy source `newId` uses on this runtime (shown by diagnostics). */
export function randomSource(): RandomSource {
  const c = runtimeCrypto();
  if (typeof c?.randomUUID === 'function') return 'randomUUID';
  if (typeof c?.getRandomValues === 'function') return 'getRandomValues';
  return 'math';
}

/**
 * RFC 4122 v4 id for client-minted keys (invocation ids, connection ids).
 * These are idempotency keys, not secrets, but must not collide; the Math
 * fallback only exists for runtimes without Web Crypto.
 */
export function newId(): string {
  const c = runtimeCrypto();
  if (typeof c?.randomUUID === 'function') return c.randomUUID();

  const bytes = new Uint8Array(16);
  if (typeof c?.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);

  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

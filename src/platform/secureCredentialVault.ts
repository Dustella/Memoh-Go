import * as SecureStore from 'expo-secure-store';

import type { Credential } from '../core/identity/credential';
import type { CredentialVault } from '../application/access/connectService';

/**
 * Tokens live only here, keyed by the opaque local connection id (never by
 * server or username). SecureStore keys allow [A-Za-z0-9._-].
 */
const keyFor = (connectionId: string) => `memoh_go.credential.${connectionId.replace(/[^A-Za-z0-9._-]/g, '_')}`;

export const secureCredentialVault: CredentialVault = {
  async load(connectionId) {
    const raw = await SecureStore.getItemAsync(keyFor(connectionId));
    if (raw === null) return null;
    try {
      const value = JSON.parse(raw) as Partial<Credential>;
      if (typeof value.accessToken !== 'string' || typeof value.expiresAt !== 'number' || typeof value.receivedAt !== 'number') {
        return null;
      }
      return value as Credential;
    } catch {
      return null;
    }
  },
  async save(connectionId, credential) {
    await SecureStore.setItemAsync(keyFor(connectionId), JSON.stringify(credential));
  },
  async remove(connectionId) {
    await SecureStore.deleteItemAsync(keyFor(connectionId));
  },
};

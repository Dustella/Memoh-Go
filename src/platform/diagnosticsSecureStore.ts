import * as SecureStore from 'expo-secure-store';

const SECURE_PROBE_KEY = 'memoh_go.p0_3.secure_probe';

export type SecureProbeRecord = Readonly<{
  version: 1;
  probeId: string;
  secretMarker: string;
}>;

export async function isDiagnosticsSecureStoreAvailable(): Promise<boolean> {
  return SecureStore.isAvailableAsync();
}

export async function writeSecureProbe(record: SecureProbeRecord): Promise<void> {
  await SecureStore.setItemAsync(SECURE_PROBE_KEY, JSON.stringify(record));
}

export async function readSecureProbe(): Promise<SecureProbeRecord | null> {
  const storedValue = await SecureStore.getItemAsync(SECURE_PROBE_KEY);
  if (storedValue === null) {
    return null;
  }

  const parsed: unknown = JSON.parse(storedValue);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('version' in parsed) ||
    parsed.version !== 1 ||
    !('probeId' in parsed) ||
    typeof parsed.probeId !== 'string' ||
    !('secretMarker' in parsed) ||
    typeof parsed.secretMarker !== 'string'
  ) {
    throw new Error('SecureStore probe has an unsupported shape.');
  }

  return parsed as SecureProbeRecord;
}

export async function deleteSecureProbe(): Promise<void> {
  await SecureStore.deleteItemAsync(SECURE_PROBE_KEY);
}

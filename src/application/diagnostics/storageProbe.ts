import {
  clearDiagnosticsDatabase,
  readDiagnosticsDatabaseSnapshot,
  recordLifecycleEvent,
  sqliteContainsSecureValue,
  writeSqliteProbe,
  type DiagnosticsDatabaseSnapshot,
} from '../../data/local/diagnosticsDatabase';
import {
  deleteSecureProbe,
  isDiagnosticsSecureStoreAvailable,
  readSecureProbe,
  writeSecureProbe,
} from '../../platform/diagnosticsSecureStore';

export type StorageProbeSnapshot = DiagnosticsDatabaseSnapshot &
  Readonly<{
    secureStoreAvailable: boolean;
    secureRecordPresent: boolean;
    secureRecordMatchesSqlite: boolean;
    secureValueFoundInSqlite: boolean;
  }>;

function createIdentifier(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export async function readStorageProbeSnapshot(): Promise<StorageProbeSnapshot> {
  const databaseSnapshot = await readDiagnosticsDatabaseSnapshot();
  const secureStoreAvailable = await isDiagnosticsSecureStoreAvailable();
  const secureRecord = secureStoreAvailable ? await readSecureProbe() : null;
  const secureValueFoundInSqlite = secureRecord
    ? await sqliteContainsSecureValue(secureRecord.secretMarker)
    : false;

  return {
    ...databaseSnapshot,
    secureStoreAvailable,
    secureRecordPresent: secureRecord !== null,
    secureRecordMatchesSqlite:
      secureRecord !== null && secureRecord.probeId === databaseSnapshot.latestProbe?.probeId,
    secureValueFoundInSqlite,
  };
}

export async function createStorageProbe(): Promise<StorageProbeSnapshot> {
  const secureStoreAvailable = await isDiagnosticsSecureStoreAvailable();
  if (!secureStoreAvailable) {
    throw new Error('SecureStore is unavailable on this device.');
  }

  const createdAt = Date.now();
  const probeId = createIdentifier('probe');
  const secretMarker = createIdentifier('secure-only');

  await writeSecureProbe({ version: 1, probeId, secretMarker });
  try {
    await writeSqliteProbe({
      probeId,
      publicValue: `sqlite:${probeId}`,
      createdAt,
    });
  } catch (error) {
    await deleteSecureProbe();
    throw error;
  }

  return readStorageProbeSnapshot();
}

export async function recordStorageProbeLifecycle(
  kind: 'mount' | 'change',
  appState: string,
): Promise<StorageProbeSnapshot> {
  await recordLifecycleEvent(kind, appState);
  return readStorageProbeSnapshot();
}

export async function clearStorageProbe(): Promise<StorageProbeSnapshot> {
  await deleteSecureProbe();
  await clearDiagnosticsDatabase();
  return readStorageProbeSnapshot();
}

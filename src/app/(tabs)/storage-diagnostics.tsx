import { Redirect } from 'expo-router';

import { StorageDiagnosticsScreen } from '../../features/diagnostics/StorageDiagnosticsScreen';

/** Development-only probe; release builds redirect to the home tab. */
export default function StorageDiagnosticsRoute() {
  return __DEV__ ? <StorageDiagnosticsScreen /> : <Redirect href="/" />;
}

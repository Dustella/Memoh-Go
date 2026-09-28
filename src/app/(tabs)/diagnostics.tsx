import { Redirect } from 'expo-router';

import { InputDiagnosticsScreen } from '../../features/diagnostics/InputDiagnosticsScreen';

/** Development-only probe; release builds redirect to the home tab. */
export default function InputDiagnosticsRoute() {
  return __DEV__ ? <InputDiagnosticsScreen /> : <Redirect href="/" />;
}

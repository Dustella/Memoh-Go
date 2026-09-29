import { Stack } from 'expo-router';

import { DiagnosticsLogScreen } from '../features/diagnostics/DiagnosticsLogScreen';

/** Support diagnostics (PF-04). Available in release builds: it holds no secrets or content. */
export default function DiagnosticsLogRoute() {
  return (
    <>
      <Stack.Screen options={{ title: '诊断信息' }} />
      <DiagnosticsLogScreen />
    </>
  );
}

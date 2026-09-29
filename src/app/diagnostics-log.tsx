import { Stack } from 'expo-router';

import { DiagnosticsLogScreen } from '../features/diagnostics/DiagnosticsLogScreen';
import { useT } from '../ui/preferences';

/** Support diagnostics (PF-04). Available in release builds: it holds no secrets or content. */
export default function DiagnosticsLogRoute() {
  const { t } = useT();
  return (
    <>
      <Stack.Screen options={{ title: t('nav.diagnostics') }} />
      <DiagnosticsLogScreen />
    </>
  );
}

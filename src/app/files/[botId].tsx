import { Stack, useLocalSearchParams } from 'expo-router';

import { RequireSignIn } from '../../bootstrap/RequireSignIn';
import { baseName, normalisePath } from '../../core/resources/files';
import { FileBrowserScreen } from '../../features/resources/FileBrowserScreen';
import { useT } from '../../ui/preferences';

/** A folder of a Bot's workspace (FL-01). `root` is where the breadcrumb starts. */
export default function FilesRoute() {
  const { botId, path, root, label } = useLocalSearchParams<{ botId: string; path?: string; root?: string; label?: string }>();
  const { t } = useT();
  const current = normalisePath(path || root || '/data');
  const start = normalisePath(root || current);
  const rootLabel = label || baseName(start);
  return (
    <RequireSignIn>
      <Stack.Screen options={{ headerShown: true, title: current === start ? rootLabel || t('nav.files') : baseName(current) }} />
      <FileBrowserScreen botId={botId} path={current} root={start} rootLabel={rootLabel} />
    </RequireSignIn>
  );
}

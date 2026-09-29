import { useLocalSearchParams } from 'expo-router';

import { RequireSignIn } from '../../bootstrap/RequireSignIn';
import { normalisePath } from '../../core/resources/files';
import { FileViewerScreen } from '../../features/resources/FileViewerScreen';

/** View one workspace file (FL-02); the screen sets its own title and share button. */
export default function FileRoute() {
  const { botId, path } = useLocalSearchParams<{ botId: string; path: string }>();
  return (
    <RequireSignIn>
      <FileViewerScreen botId={botId} path={normalisePath(path ?? '/')} />
    </RequireSignIn>
  );
}

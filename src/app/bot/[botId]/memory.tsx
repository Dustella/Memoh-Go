import { useLocalSearchParams } from 'expo-router';

import { RequireSignIn } from '../../../bootstrap/RequireSignIn';
import { MemoryScreen } from '../../../features/resources/MemoryScreen';

export default function MemoryRoute() {
  const { botId } = useLocalSearchParams<{ botId: string }>();
  return (
    <RequireSignIn>
      <MemoryScreen botId={botId} />
    </RequireSignIn>
  );
}

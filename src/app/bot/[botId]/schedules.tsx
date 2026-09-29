import { useLocalSearchParams } from 'expo-router';

import { RequireSignIn } from '../../../bootstrap/RequireSignIn';
import { SchedulesScreen } from '../../../features/resources/SchedulesScreen';

export default function SchedulesRoute() {
  const { botId } = useLocalSearchParams<{ botId: string }>();
  return (
    <RequireSignIn>
      <SchedulesScreen botId={botId} />
    </RequireSignIn>
  );
}

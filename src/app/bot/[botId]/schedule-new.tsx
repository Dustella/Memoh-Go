import { useLocalSearchParams } from 'expo-router';

import { RequireSignIn } from '../../../bootstrap/RequireSignIn';
import { NewScheduleScreen } from '../../../features/resources/NewScheduleScreen';

export default function NewScheduleRoute() {
  const { botId } = useLocalSearchParams<{ botId: string }>();
  return (
    <RequireSignIn>
      <NewScheduleScreen botId={botId} />
    </RequireSignIn>
  );
}

import { useLocalSearchParams } from 'expo-router';

import { RequireSignIn } from '../bootstrap/RequireSignIn';
import { TeamScreen } from '../features/management/TeamScreen';

/** Team picker (ID-05). `?mock=1` shows a DEV-ONLY mock Team list. */
export default function TeamRoute() {
  const { mock } = useLocalSearchParams<{ mock?: string }>();
  return (
    <RequireSignIn>
      <TeamScreen mock={mock === '1'} />
    </RequireSignIn>
  );
}

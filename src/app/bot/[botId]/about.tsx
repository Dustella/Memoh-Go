import { useLocalSearchParams } from 'expo-router';

import { RequireSignIn } from '../../../bootstrap/RequireSignIn';
import { BotDetailScreen } from '../../../features/bot/BotDetailScreen';

/** Bot detail (AD-01). The title comes from the root stack options. */
export default function BotAboutRoute() {
  const { botId } = useLocalSearchParams<{ botId: string }>();
  return (
    <RequireSignIn>
      <BotDetailScreen botId={botId} />
    </RequireSignIn>
  );
}

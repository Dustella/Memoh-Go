import { Stack, useLocalSearchParams } from 'expo-router';

import { RequireSignIn } from '../../../bootstrap/RequireSignIn';
import { NewChatScreen } from '../../../features/chat/NewChatScreen';
import { useT } from '../../../ui/preferences';

/** Static segment: wins over `[sessionId]` for `/chat/<bot>/new`. */
export default function NewChatRoute() {
  const { t } = useT();
  const { botId, request } = useLocalSearchParams<{ botId: string; request?: string }>();
  return (
    <RequireSignIn>
      <Stack.Screen options={{ headerShown: true, title: t('nav.newChat') }} />
      <NewChatScreen botId={botId} requestId={request} />
    </RequireSignIn>
  );
}

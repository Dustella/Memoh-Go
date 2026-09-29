import { Stack, useLocalSearchParams } from 'expo-router';

import { RequireSignIn } from '../../../bootstrap/RequireSignIn';
import { NewChatScreen } from '../../../features/chat/NewChatScreen';

/** Static segment: wins over `[sessionId]` for `/chat/<bot>/new`. */
export default function NewChatRoute() {
  const { botId, request } = useLocalSearchParams<{ botId: string; request?: string }>();
  return (
    <RequireSignIn>
      <Stack.Screen options={{ headerShown: true, title: '新会话' }} />
      <NewChatScreen botId={botId} requestId={request} />
    </RequireSignIn>
  );
}

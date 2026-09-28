import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import { useAccessState, useServices } from '../../../bootstrap/AppServices';
import { RequireSignIn } from '../../../bootstrap/RequireSignIn';
import { loadSessions } from '../../../data/local/conversationStore';
import { ChatScreen } from '../../../features/chat/ChatScreen';

export default function ChatRoute() {
  const { botId, sessionId } = useLocalSearchParams<{ botId: string; sessionId: string }>();
  const { db } = useServices();
  const state = useAccessState();
  const [title, setTitle] = useState('');

  useEffect(() => {
    if (state.kind !== 'signed_in') return;
    void loadSessions(db, state.session.scope, botId, 500).then((sessions) => {
      setTitle(sessions.find((s) => s.id === sessionId)?.title ?? '');
    });
  }, [db, state, botId, sessionId]);

  return (
    <RequireSignIn>
      <Stack.Screen options={{ headerShown: true, title: title || '会话' }} />
      <ChatScreen botId={botId} sessionId={sessionId} />
    </RequireSignIn>
  );
}

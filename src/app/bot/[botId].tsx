import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import { useAccessState, useServices } from '../../bootstrap/AppServices';
import { RequireSignIn } from '../../bootstrap/RequireSignIn';
import { loadBots } from '../../data/local/conversationStore';
import { BotSessionsScreen } from '../../features/chat/BotSessionsScreen';

export default function BotRoute() {
  const { botId } = useLocalSearchParams<{ botId: string }>();
  const { db } = useServices();
  const state = useAccessState();
  const [title, setTitle] = useState('会话');

  useEffect(() => {
    if (state.kind !== 'signed_in') return;
    void loadBots(db, state.session.scope).then((bots) => {
      const bot = bots.find((b) => b.id === botId);
      if (bot) setTitle(bot.display_name || bot.name || '会话');
    });
  }, [db, state, botId]);

  return (
    <RequireSignIn>
      <Stack.Screen options={{ headerShown: true, title }} />
      <BotSessionsScreen botId={botId} />
    </RequireSignIn>
  );
}

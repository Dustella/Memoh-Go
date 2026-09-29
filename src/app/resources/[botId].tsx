import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import { useAccessState, useServices } from '../../bootstrap/AppServices';
import { RequireSignIn } from '../../bootstrap/RequireSignIn';
import { loadBots } from '../../data/local/conversationStore';
import { BotResourcesScreen } from '../../features/resources/BotResourcesScreen';
import { useT } from '../../ui/preferences';

/** One Bot's environments, folders and files (M4). */
export default function BotResourcesRoute() {
  const { botId } = useLocalSearchParams<{ botId: string }>();
  const { db } = useServices();
  const state = useAccessState();
  const { t } = useT();
  const [title, setTitle] = useState('');
  useEffect(() => {
    if (state.kind !== 'signed_in') return;
    void loadBots(db, state.session.scope).then((bots) => {
      const bot = bots.find((b) => b.id === botId);
      if (bot) setTitle(bot.display_name || bot.name || '');
    });
  }, [db, state, botId]);
  return (
    <RequireSignIn>
      <Stack.Screen options={{ headerShown: true, title: title || t('nav.resourcesBot') }} />
      <BotResourcesScreen botId={botId} />
    </RequireSignIn>
  );
}

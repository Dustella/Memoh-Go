import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { useAccessState, useServices } from '../../bootstrap/AppServices';
import { RequireSignIn } from '../../bootstrap/RequireSignIn';
import { loadBots } from '../../data/local/conversationStore';
import { BotSessionsScreen } from '../../features/chat/BotSessionsScreen';
import { useT } from '../../ui/preferences';
import { useTheme } from '../../ui/theme';

export default function BotRoute() {
  const { botId } = useLocalSearchParams<{ botId: string }>();
  const { db } = useServices();
  const { colors } = useTheme();
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
      <Stack.Screen
        options={{
          headerShown: true,
          title: title || t('common.session'),
          headerRight: () => (
            <View style={{ flexDirection: 'row', gap: 20 }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('botSessions.botInfo')}
                hitSlop={12}
                onPress={() => router.push({ pathname: '/bot/[botId]/about', params: { botId } })}
              >
                <Ionicons name="information-circle-outline" size={23} color={colors.accent} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('botSessions.newChat')}
                hitSlop={12}
                onPress={() => router.push({ pathname: '/chat/[botId]/new', params: { botId } })}
              >
                <Ionicons name="create-outline" size={22} color={colors.accent} />
              </Pressable>
            </View>
          ),
        }}
      />
      <BotSessionsScreen botId={botId} />
    </RequireSignIn>
  );
}

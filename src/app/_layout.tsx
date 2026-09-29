import Ionicons from '@expo/vector-icons/Ionicons';
import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AppServicesProvider } from '../bootstrap/AppServices';
import { useT } from '../ui/preferences';
import { fontSize, navigationColors, spacing, useTheme } from '../ui/theme';

// A deep link (memoh://chat/…, a notification) lands on top of the tabs, so back returns home instead of leaving the app.
export const unstable_settings = { initialRouteName: '(tabs)' };

function BootFailure({ message }: { message: string }) {
  const { colors } = useTheme();
  const { t } = useT();
  return (
    <View style={[styles.center, { backgroundColor: colors.background }]}>
      <Text style={[styles.title, { color: colors.text }]}>{t('boot.failed')}</Text>
      <Text selectable style={[styles.detail, { color: colors.textMuted }]}>{message}</Text>
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(Ionicons.font);
  const theme = useTheme();
  const { t } = useT();
  // Headers, tab bar and screen backgrounds follow the same tokens as the content (PF-05).
  const navTheme = useMemo(() => {
    const base = theme.dark ? DarkTheme : DefaultTheme;
    return { ...base, dark: theme.dark, colors: { ...base.colors, ...navigationColors(theme.colors) } };
  }, [theme]);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <ThemeProvider value={navTheme}>
      <AppServicesProvider fallback={(state) => (state.kind === 'failed' ? <BootFailure message={state.error.message} /> : null)}>
        <StatusBar style={theme.dark ? 'light' : 'dark'} />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" options={{ title: t('tabs.sessions') }} />
          <Stack.Screen name="connect" options={{ animation: 'fade' }} />
          <Stack.Screen name="bot/[botId]" options={{ headerShown: true }} />
          <Stack.Screen name="chat/[botId]/[sessionId]" options={{ headerShown: true }} />
          <Stack.Screen name="chat/[botId]/new" options={{ headerShown: true }} />
          <Stack.Screen name="diagnostics-log" options={{ headerShown: true }} />
          <Stack.Screen name="settings" options={{ headerShown: true, title: t('nav.settings') }} />
          <Stack.Screen name="team" options={{ headerShown: true, title: t('team.title') }} />
          <Stack.Screen name="bot/[botId]/about" options={{ headerShown: true, title: t('nav.botDetail') }} />
        </Stack>
      </AppServicesProvider>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', padding: spacing.xl },
  title: { fontSize: fontSize.title, fontWeight: '600' },
  detail: { fontSize: fontSize.small, marginTop: spacing.sm },
});

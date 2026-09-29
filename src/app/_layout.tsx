import Ionicons from '@expo/vector-icons/Ionicons';
import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AppServicesProvider } from '../bootstrap/AppServices';
import { fontSize, navigationColors, spacing, useTheme } from '../ui/theme';

function BootFailure({ message }: { message: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.center, { backgroundColor: colors.background }]}>
      <Text style={[styles.title, { color: colors.text }]}>无法打开本地数据</Text>
      <Text selectable style={[styles.detail, { color: colors.textMuted }]}>{message}</Text>
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(Ionicons.font);
  const theme = useTheme();
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
          <Stack.Screen name="(tabs)" options={{ title: '会话' }} />
          <Stack.Screen name="connect" options={{ animation: 'fade' }} />
          <Stack.Screen name="bot/[botId]" options={{ headerShown: true }} />
          <Stack.Screen name="chat/[botId]/[sessionId]" options={{ headerShown: true }} />
          <Stack.Screen name="chat/[botId]/new" options={{ headerShown: true }} />
          <Stack.Screen name="diagnostics-log" options={{ headerShown: true }} />
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

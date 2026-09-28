import Ionicons from '@expo/vector-icons/Ionicons';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';

import { AppServicesProvider } from '../bootstrap/AppServices';
import { fontSize, spacing, useTheme } from '../ui/theme';

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

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <AppServicesProvider fallback={(state) => (state.kind === 'failed' ? <BootFailure message={state.error.message} /> : null)}>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="connect" options={{ animation: 'fade' }} />
      </Stack>
    </AppServicesProvider>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', padding: spacing.xl },
  title: { fontSize: fontSize.title, fontWeight: '600' },
  detail: { fontSize: fontSize.small, marginTop: spacing.sm },
});

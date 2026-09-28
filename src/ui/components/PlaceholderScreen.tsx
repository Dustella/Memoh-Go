import { ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native';

type PlaceholderScreenProps = Readonly<{
  title: string;
  description: string;
}>;

/** Shared static screen placeholder; it does not simulate business state. */
export function PlaceholderScreen({ title, description }: PlaceholderScreenProps) {
  const isDark = useColorScheme() === 'dark';
  const colors = isDark
    ? { background: '#151718', foreground: '#F2F4F5', muted: '#B0B8BE' }
    : { background: '#F8FAFC', foreground: '#18212B', muted: '#536171' };

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.container}
    >
      <View style={styles.content}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>
          {title}
        </Text>
        <Text style={[styles.description, { color: colors.muted }]}>{description}</Text>
        <Text style={[styles.status, { color: colors.muted }]}>页面准备中</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  content: {
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: '600',
    marginBottom: 16,
  },
  description: {
    fontSize: 17,
    lineHeight: 26,
  },
  status: {
    fontSize: 14,
    marginTop: 28,
  },
});

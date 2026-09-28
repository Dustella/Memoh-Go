import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function InputDiagnosticsScreen() {
  const isDark = useColorScheme() === 'dark';
  const insets = useSafeAreaInsets();
  const [singleLine, setSingleLine] = useState('');
  const [multiline, setMultiline] = useState('');
  const colors = isDark
    ? {
        background: '#151718',
        border: '#48515A',
        foreground: '#F2F4F5',
        marker: '#173C2B',
        markerText: '#8CE3B3',
        muted: '#B0B8BE',
      }
    : {
        background: '#F8FAFC',
        border: '#AAB4BE',
        foreground: '#18212B',
        marker: '#DCFCE7',
        markerText: '#166534',
        muted: '#536171',
      };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={insets.top + 48}
      style={[styles.screen, { backgroundColor: colors.background }]}
    >
      <View style={styles.content}>
        <ScrollView
          contentContainerStyle={styles.formContent}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          style={styles.form}
        >
          <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>输入诊断</Text>
          <Text style={[styles.description, { color: colors.muted }]}>用于中文输入法、换行和键盘避让冒烟测试。</Text>

          <Text style={[styles.label, { color: colors.foreground }]}>单行输入</Text>
          <TextInput
            accessibilityLabel="单行输入"
            autoCapitalize="none"
            onChangeText={setSingleLine}
            placeholder="输入中文或英文"
            placeholderTextColor={colors.muted}
            style={[styles.input, { borderColor: colors.border, color: colors.foreground }]}
            testID="diagnostics-single-line"
            value={singleLine}
          />

          <Text style={[styles.label, { color: colors.foreground }]}>多行输入</Text>
          <TextInput
            accessibilityLabel="多行输入"
            multiline
            onChangeText={setMultiline}
            placeholder="输入多行内容，测试换行、删除和重新聚焦"
            placeholderTextColor={colors.muted}
            style={[
              styles.input,
              styles.multiline,
              { borderColor: colors.border, color: colors.foreground },
            ]}
            testID="diagnostics-multiline"
            textAlignVertical="top"
            value={multiline}
          />
        </ScrollView>
        <View
          accessibilityLabel="底部可见标记"
          style={[styles.marker, { backgroundColor: colors.marker }]}
        >
          <Text style={[styles.markerText, { color: colors.markerText }]}>底部可见标记</Text>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    flex: 1,
    padding: 24,
  },
  form: {
    flex: 1,
  },
  formContent: {
    paddingBottom: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: '600',
  },
  description: {
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 28,
    marginTop: 8,
  },
  label: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 8,
    marginTop: 16,
  },
  input: {
    borderRadius: 10,
    borderWidth: 1,
    fontSize: 17,
    minHeight: 52,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  multiline: {
    minHeight: 144,
  },
  marker: {
    borderRadius: 10,
    marginTop: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  markerText: {
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
});

import Ionicons from '@expo/vector-icons/Ionicons';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { probeServer, type ServerProbe } from '../../application/access/connectService';
import { useAccessState, useServices } from '../../bootstrap/AppServices';
import type { FetchFn } from '../../data/remote/memohClient';
import { fontSize, radius, spacing, useTheme } from '../../ui/theme';

type OkProbe = Extract<ServerProbe, { kind: 'ok' }>;

function probeMessage(probe: Exclude<ServerProbe, OkProbe>): string {
  switch (probe.kind) {
    case 'invalid_url':
      return '地址格式不正确。示例：memoh.example.com 或 http://192.168.1.10:18080';
    case 'unreachable':
      return '无法连接到这个地址。请检查网络、端口，以及是否需要 http://。';
    case 'not_memoh':
      return '这个地址有响应，但不是 Memoh 服务。';
    case 'too_old':
      return `服务端版本 ${probe.version} 过旧。Memoh 移动端需要 v${probe.minimum} 或更新版本，请先升级服务端。`;
  }
}

export function ConnectScreen() {
  const { colors } = useTheme();
  const { access } = useServices();
  const state = useAccessState();
  const reauth = state.kind === 'needs_sign_in' ? state : null;

  const [address, setAddress] = useState(reauth?.connection.deployment ?? '');
  const [probe, setProbe] = useState<OkProbe | null>(null);
  const [username, setUsername] = useState(reauth?.connection.username ?? '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'probe' | 'sign_in' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const passwordRef = useRef<TextInput>(null);

  const checkServer = async () => {
    setBusy('probe');
    setError(null);
    const result = await probeServer({ fetchFn: fetch as unknown as FetchFn }, address);
    setBusy(null);
    if (result.kind === 'ok') {
      setProbe(result);
      setAddress(result.deployment);
    } else {
      setError(probeMessage(result));
    }
  };

  const signIn = async () => {
    if (!probe) return;
    setBusy('sign_in');
    setError(null);
    const result = await access.signIn(probe, username, password);
    setBusy(null);
    if (result.kind === 'invalid_credentials') setError('用户名或密码不正确。');
    else if (result.kind === 'wrong_account') setError(`请使用 ${reauth?.connection.username} 登录，或先退出这个账号。`);
    else if (result.kind === 'error') setError(`登录失败：${result.message}`);
    else {
      setPassword('');
      void access.syncBots().catch(() => undefined);
    }
  };

  const editServer = () => {
    setProbe(null);
    setError(null);
  };

  const field = (props: TextInputProps) => (
    <TextInput
      placeholderTextColor={colors.textSubtle}
      autoCapitalize="none"
      autoCorrect={false}
      editable={busy === null}
      {...props}
      style={[styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }, props.style]}
    />
  );

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={[styles.logo, { backgroundColor: colors.accentSoft }]}>
            <Ionicons name="sparkles" size={28} color={colors.accent} />
          </View>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
            {reauth ? '重新登录' : '连接 Memoh'}
          </Text>
          <Text style={[styles.subtitle, { color: colors.textMuted }]}>
            {reauth
              ? '登录已失效。重新登录后，本机保存的会话、草稿和未发送消息都会保留。'
              : '输入你的 Memoh 服务地址，用该服务的账号登录。'}
          </Text>

          <Text style={[styles.label, { color: colors.textMuted }]}>服务地址</Text>
          {probe ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="修改服务地址"
              onPress={editServer}
              disabled={busy !== null || reauth !== null}
              style={[styles.serverCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <View style={styles.flex}>
                <Text numberOfLines={1} style={[styles.serverUrl, { color: colors.text }]}>{probe.deployment}</Text>
                <View style={styles.badgeRow}>
                  <Ionicons
                    name={probe.verified ? 'checkmark-circle' : 'alert-circle'}
                    size={14}
                    color={probe.verified ? colors.success : colors.warning}
                  />
                  <Text style={[styles.badge, { color: probe.verified ? colors.success : colors.warning }]}>
                    {probe.verified ? `Memoh ${probe.ping.version}` : `未验证的版本 ${probe.ping.version || '（未知）'}`}
                  </Text>
                </View>
              </View>
              {reauth ? null : <Text style={[styles.link, { color: colors.accent }]}>修改</Text>}
            </Pressable>
          ) : (
            field({
              value: address,
              onChangeText: setAddress,
              placeholder: 'memoh.example.com',
              keyboardType: 'url',
              returnKeyType: 'next',
              onSubmitEditing: () => void checkServer(),
              accessibilityLabel: '服务地址',
              textContentType: 'URL',
            })
          )}

          {probe ? (
            <>
              <Text style={[styles.label, { color: colors.textMuted }]}>用户名</Text>
              {field({
                value: username,
                onChangeText: setUsername,
                placeholder: '用户名',
                textContentType: 'username',
                autoComplete: 'username',
                returnKeyType: 'next',
                onSubmitEditing: () => passwordRef.current?.focus(),
                accessibilityLabel: '用户名',
              })}
              <Text style={[styles.label, { color: colors.textMuted }]}>密码</Text>
              <TextInput
                ref={passwordRef}
                value={password}
                onChangeText={setPassword}
                placeholder="密码"
                placeholderTextColor={colors.textSubtle}
                secureTextEntry
                textContentType="password"
                autoComplete="password"
                returnKeyType="go"
                onSubmitEditing={() => void signIn()}
                editable={busy === null}
                accessibilityLabel="密码"
                style={[styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }]}
              />
            </>
          ) : null}

          {error ? (
            <View accessibilityLiveRegion="polite" style={[styles.error, { backgroundColor: colors.surfaceMuted }]}>
              <Ionicons name="warning-outline" size={16} color={colors.danger} />
              <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>
            </View>
          ) : null}

          <Pressable
            accessibilityRole="button"
            disabled={busy !== null || (probe ? !username || !password : !address.trim())}
            onPress={() => void (probe ? signIn() : checkServer())}
            style={({ pressed }) => [
              styles.primary,
              { backgroundColor: colors.accent },
              (busy !== null || (probe ? !username || !password : !address.trim())) && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            {busy ? (
              <ActivityIndicator color={colors.accentText} />
            ) : (
              <Text style={[styles.primaryText, { color: colors.accentText }]}>{probe ? '登录' : '继续'}</Text>
            )}
          </Pressable>

          {reauth ? (
            <Pressable accessibilityRole="button" onPress={() => void access.signOut()} style={styles.secondary}>
              <Text style={[styles.link, { color: colors.textMuted }]}>退出此账号并清除本机数据</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: spacing.xl, paddingTop: spacing.xxl * 2, maxWidth: 520, width: '100%', alignSelf: 'center' },
  logo: { width: 56, height: 56, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: fontSize.headline, fontWeight: '700', marginTop: spacing.lg },
  subtitle: { fontSize: fontSize.body, lineHeight: 23, marginTop: spacing.sm, marginBottom: spacing.lg },
  label: { fontSize: fontSize.small, marginTop: spacing.lg, marginBottom: spacing.xs },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: fontSize.body,
  },
  serverCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  serverUrl: { fontSize: fontSize.body, fontWeight: '500' },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs },
  badge: { fontSize: fontSize.caption },
  link: { fontSize: fontSize.small, fontWeight: '500' },
  error: { flexDirection: 'row', gap: spacing.sm, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.lg },
  errorText: { flex: 1, fontSize: fontSize.small, lineHeight: 19 },
  primary: { alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, height: 50, marginTop: spacing.xl },
  primaryText: { fontSize: fontSize.body, fontWeight: '600' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.8 },
  secondary: { alignItems: 'center', padding: spacing.md, marginTop: spacing.sm },
});

import Ionicons from '@expo/vector-icons/Ionicons';
import { Redirect, Tabs, useSegments } from 'expo-router';

import { useAccessState } from '../../bootstrap/AppServices';
import { useT } from '../../ui/preferences';

/** Hidden developer routes work without an account (e.g. the benchmark driver). */
const UNGATED = new Set(['bench', 'db-selftest', 'diagnostics', 'storage-diagnostics']);

export default function MainTabsLayout() {
  const access = useAccessState();
  const { t } = useT();
  const segments = useSegments() as string[];
  const ungated = UNGATED.has(segments[segments.length - 1] ?? '');
  if (!ungated && (access.kind === 'signed_out' || access.kind === 'needs_sign_in')) return <Redirect href="/connect" />;

  return (
    <Tabs screenOptions={{ tabBarHideOnKeyboard: true }}>
      <Tabs.Screen
        name="index"
        options={{
          title: t('tabs.home'),
          tabBarIcon: ({ color, focused, size }) => (
            <Ionicons color={color} name={focused ? 'home' : 'home-outline'} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="sessions"
        options={{
          title: t('tabs.sessions'),
          tabBarIcon: ({ color, focused, size }) => (
            <Ionicons
              color={color}
              name={focused ? 'chatbubble-ellipses' : 'chatbubble-ellipses-outline'}
              size={size}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="resources"
        options={{
          title: t('tabs.resources'),
          tabBarIcon: ({ color, focused, size }) => (
            <Ionicons color={color} name={focused ? 'folder-open' : 'folder-open-outline'} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="management"
        options={{
          title: t('tabs.management'),
          tabBarIcon: ({ color, focused, size }) => (
            <Ionicons color={color} name={focused ? 'settings' : 'settings-outline'} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="diagnostics"
        options={{
          href: null,
          title: '输入诊断',
        }}
      />
      <Tabs.Screen
        name="storage-diagnostics"
        options={{
          href: null,
          title: '存储诊断',
        }}
      />
      <Tabs.Screen
        name="db-selftest"
        options={{
          href: null,
          title: '数据库自检',
        }}
      />
      <Tabs.Screen
        name="decisions-preview"
        options={{
          href: null,
          title: '审批卡片预览',
        }}
      />
      <Tabs.Screen
        name="home-preview"
        options={{
          href: null,
          title: '首页预览（模拟数据）',
        }}
      />
      <Tabs.Screen
        name="bench"
        options={{
          href: null,
          headerShown: false,
          title: '渲染基准',
        }}
      />
    </Tabs>
  );
}

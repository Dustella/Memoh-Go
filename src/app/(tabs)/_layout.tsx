import Ionicons from '@expo/vector-icons/Ionicons';
import { Redirect, Tabs, useSegments } from 'expo-router';

import { useAccessState } from '../../bootstrap/AppServices';

/** Hidden developer routes work without an account (e.g. the benchmark driver). */
const UNGATED = new Set(['bench', 'db-selftest', 'diagnostics', 'storage-diagnostics']);

export default function MainTabsLayout() {
  const access = useAccessState();
  const segments = useSegments() as string[];
  const ungated = UNGATED.has(segments[segments.length - 1] ?? '');
  if (!ungated && (access.kind === 'signed_out' || access.kind === 'needs_sign_in')) return <Redirect href="/connect" />;

  return (
    <Tabs screenOptions={{ tabBarHideOnKeyboard: true }}>
      <Tabs.Screen
        name="index"
        options={{
          title: '首页',
          tabBarIcon: ({ color, focused, size }) => (
            <Ionicons color={color} name={focused ? 'home' : 'home-outline'} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="sessions"
        options={{
          title: '会话',
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
          title: '资源',
          tabBarIcon: ({ color, focused, size }) => (
            <Ionicons color={color} name={focused ? 'folder-open' : 'folder-open-outline'} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="management"
        options={{
          title: '管理',
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

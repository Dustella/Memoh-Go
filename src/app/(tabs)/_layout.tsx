import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';

export default function MainTabsLayout() {
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

import { Tabs } from 'expo-router/js-tabs';

import { Icon } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';

export default function TabsLayout() {
  const theme = useTheme();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: theme.primary,
        tabBarInactiveTintColor: theme.textTertiary,
        tabBarStyle: { backgroundColor: theme.surface, borderTopColor: theme.border },
        headerStyle: { backgroundColor: theme.background },
        headerTitleStyle: { color: theme.text },
        headerShadowVisible: false,
        sceneStyle: { backgroundColor: theme.background },
      }}>
      <Tabs.Screen
        name="contacts"
        options={{
          title: 'Contacts',
          tabBarIcon: ({ focused }) => (
            <Icon name={focused ? 'people' : 'people-outline'} color={focused ? 'primary' : 'textTertiary'} />
          ),
        }}
      />
      <Tabs.Screen
        name="add"
        options={{
          title: 'Add',
          tabBarIcon: ({ focused }) => (
            <Icon name={focused ? 'add-circle' : 'add-circle-outline'} color={focused ? 'primary' : 'textTertiary'} />
          ),
        }}
      />
      <Tabs.Screen
        name="qr"
        options={{
          title: 'My QR',
          tabBarIcon: ({ focused }) => (
            <Icon name={focused ? 'qr-code' : 'qr-code-outline'} color={focused ? 'primary' : 'textTertiary'} />
          ),
        }}
      />
      <Tabs.Screen
        name="me"
        options={{
          title: 'Me',
          tabBarIcon: ({ focused }) => (
            <Icon
              name={focused ? 'person-circle' : 'person-circle-outline'}
              color={focused ? 'primary' : 'textTertiary'}
            />
          ),
        }}
      />
    </Tabs>
  );
}

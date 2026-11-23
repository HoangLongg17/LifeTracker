import { Tabs } from 'expo-router';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '@/components/account-ui';
import { JournalIcon } from '@/components/journal-ui';

const tabs = [
  { name: 'today', label: 'Hôm nay', icon: 'home' }, { name: 'journal', label: 'Nhật ký', icon: 'notebook' },
  { name: 'goals', label: 'Mục tiêu', icon: 'target' }, { name: 'reports', label: 'Báo cáo', icon: 'report' },
] as const;

export const unstable_settings = { initialRouteName: 'today' };

export default function MainTabs() {
  const safe = useSafeAreaInsets();
  return <Tabs backBehavior="initialRoute" screenOptions={{
    headerShown: false, tabBarLabelPosition: 'below-icon', tabBarHideOnKeyboard: true,
    tabBarActiveTintColor: colors.primary, tabBarInactiveTintColor: colors.muted,
    tabBarStyle: { height: 72 + safe.bottom, paddingTop: 7, paddingBottom: safe.bottom + 6,
      borderTopColor: colors.divider, backgroundColor: colors.paper },
    tabBarLabelStyle: { fontFamily: 'Roboto_700Bold', fontSize: 11.5 },
  }}>
    {tabs.map(tab => <Tabs.Screen key={tab.name} name={tab.name} options={{ title: tab.label,
      tabBarIcon: ({ focused }) => <View style={{ width: 47, height: 27, borderRadius: 16,
        backgroundColor: focused ? colors.pale : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
        <JournalIcon name={tab.icon} size={19} tint={focused ? colors.primary : colors.muted} /></View> }} />)}
  </Tabs>;
}

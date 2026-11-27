import { Image } from 'expo-image';
import { router, useIsFocused } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { AccountBrand, accountStyles, colors } from '@/components/account-ui';

const images = {
  meal: require('../../assets/images/foods/utensils.svg'),
  home: require('../../assets/images/journal/home.svg'), notebook: require('../../assets/images/journal/notebook.svg'),
  target: require('../../assets/images/journal/target.svg'), report: require('../../assets/images/journal/report.svg'),
  avatar: require('../../assets/images/journal/avatar.svg'), person: require('../../assets/images/journal/person.svg'),
  back: require('../../assets/images/journal/back.svg'), chevron: require('../../assets/images/journal/chevron.svg'),
  water: require('../../assets/images/journal/droplet.svg'), activity: require('../../assets/images/journal/footprints.svg'),
  sleep: require('../../assets/images/journal/moon-purple.svg'), moon: require('../../assets/images/journal/moon.svg'),
  scale: require('../../assets/images/journal/scale.svg'), clock: require('../../assets/images/journal/clock.svg'),
  check: require('../../assets/images/journal/circle-check.svg'),
};
export function JournalIcon({ name, size = 18, tint }: { name: keyof typeof images; size?: number; tint?: string }) {
  return <Image source={images[name]} style={{ width: size, height: size, tintColor: tint }} />;
}
export const j = StyleSheet.create({
  body: { flex: 1, backgroundColor: colors.page },
  content: { width: '100%', maxWidth: 480, alignSelf: 'center', paddingHorizontal: 20, flexGrow: 1 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 50 },
  profile: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -3 },
  eyebrow: { fontFamily: 'Roboto_400Regular', color: colors.muted, fontSize: 13, lineHeight: 18 },
  heading: { fontFamily: 'Roboto_700Bold', color: colors.ink, fontSize: 28, lineHeight: 38, marginTop: 6 },
  section: { color: colors.ink, fontFamily: 'Roboto_700Bold', fontSize: 16, lineHeight: 24 },
  strong: { color: colors.ink, fontFamily: 'Roboto_700Bold', fontSize: 14, lineHeight: 20 },
  small: { color: colors.muted, fontFamily: 'Roboto_400Regular', fontSize: 12, lineHeight: 17 },
  text: { color: colors.ink, fontFamily: 'Roboto_400Regular', fontSize: 15, lineHeight: 22 },
  link: accountStyles.link,
  card: { borderWidth: 1, borderColor: colors.divider, borderRadius: 16, backgroundColor: colors.paper, padding: 14 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 44, alignSelf: 'flex-start' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56 },
  tile: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.pale },
  hairline: { borderTopColor: colors.divider, borderTopWidth: 1 },
  overlay: { flex: 1, backgroundColor: 'rgba(24,46,39,0.38)', justifyContent: 'center', alignItems: 'center', padding: 22 },
  modal: { width: '100%', maxWidth: 380, borderRadius: 18, backgroundColor: colors.paper, padding: 20, gap: 12 },
});

export function JournalPage({ children, footer, tab = false }: { children: ReactNode; footer?: ReactNode; tab?: boolean }) {
  const safe = useSafeAreaInsets();
  const focused = useIsFocused();
  return <SafeAreaView edges={['left', 'right']} style={j.body} aria-hidden={tab && !focused}
    importantForAccessibility={tab && !focused ? 'no-hide-descendants' : 'auto'}>
    <StatusBar style="dark" />
    <KeyboardAvoidingView style={j.body} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[j.content, {
        paddingTop: Math.max(safe.top, 32) + 2, paddingBottom: footer || tab ? 22 : Math.max(24, safe.bottom),
      }]}>{children}</ScrollView>
      {footer && <View style={[j.content, { flexGrow: 0, paddingTop: 8, paddingBottom: Math.max(safe.bottom + 16, 40) }]}>{footer}</View>}
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

export function JournalHeader() {
  return <View style={j.top}><AccountBrand />
    <Pressable accessibilityRole="button" accessibilityLabel="Hồ sơ cá nhân" onPress={() => router.push('/profile')} style={j.profile}>
      <JournalIcon name="avatar" size={34} /><View style={{ position: 'absolute' }}><JournalIcon name="person" /></View>
    </Pressable>
  </View>;
}
export function BlankTab() {
  return <JournalPage tab><JournalHeader /></JournalPage>;
}
export function JournalBack({ onPress }: { onPress?: () => void }) {
  return <Pressable accessibilityRole="button" onPress={onPress ?? (() => router.canGoBack() ? router.back() : router.replace('/journal'))} style={j.linkRow}>
    <JournalIcon name="back" /><Text style={j.link}>Quay lại</Text>
  </Pressable>;
}
export function FormHeading({ title, date }: { title: string; date: string }) {
  return <View style={{ marginTop: 12 }}><Text style={j.eyebrow}>Nhật ký · {date}</Text>
    <Text accessibilityRole="header" style={j.heading}>{title}</Text></View>;
}
export function JournalDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <Modal transparent animationType="fade" onRequestClose={onClose}>
    <View style={j.overlay}><View accessibilityViewIsModal style={j.modal}>
      <Text accessibilityRole="header" style={j.section}>{title}</Text>{children}
    </View></View>
  </Modal>;
}

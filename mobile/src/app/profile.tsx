import { Link } from 'expo-router';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { accountStyles as ui, colors, SignOutButton } from '@/components/account-ui';
import { useSession } from '@/hooks/use-session';

const settings = [
  { title: 'Lịch nhắc', subtitle: 'Lịch và quyền thông báo', icon: require('../../assets/images/account/bell.svg') },
  { title: 'Dữ liệu cá nhân', subtitle: 'Hồ sơ phục vụ theo dõi sinh hoạt', icon: require('../../assets/images/registration/shield.svg') },
  { title: 'Mục tiêu của tôi', subtitle: 'Chỉ tiêu và lịch sử điều chỉnh', icon: require('../../assets/images/account/target.svg') },
];

export default function ProfileScreen() {
  const { session } = useSession();
  const insets = useSafeAreaInsets();
  if (session.status !== 'active') return null;
  const email = session.user.email ?? '';
  const name = session.displayName || session.user.displayName || email.split('@')[0];

  return (
    <SafeAreaView style={ui.page} edges={['left', 'right']}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={[ui.content, {
        paddingTop: Math.max(insets.top, 32) + 16, paddingBottom: Math.max(insets.bottom, 24),
      }]}>
        <Text style={styles.eyebrow}>Tài khoản</Text>
        <Text accessibilityRole="header" style={styles.title}>Hồ sơ cá nhân</Text>

        <View style={[styles.card, styles.identity]}>

          <View style={styles.avatar}>
            <Image source={require('../../assets/images/account/user-round.svg')} style={{ width: 26, height: 26 }} />
          </View>
          <View style={styles.identityText}>
            <Text style={styles.name}>{name}</Text>
            <Text style={styles.email}>{email}</Text>
                  <Link href="/water">
        Nhật ký nước uống
      </Link>
          </View>
        </View>

        <Text accessibilityRole="header" style={styles.sectionTitle}>Thiết lập</Text>
        <View style={[styles.card, styles.settings]}>
          {settings.map((item, index) => {
            const content = (
              <>
                <View style={styles.iconBox}><Image source={item.icon} style={{ width: 18, height: 18 }} /></View>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>{item.title}</Text>
                  <Text style={styles.rowSubtitle}>{item.subtitle}</Text>
                </View>
                <Image source={require('../../assets/images/account/chevron-right.svg')} style={{ width: 15, height: 15 }} />
              </>
            );
            const rowStyle = [styles.row, index < settings.length - 1 && styles.divider];
            return item.title === 'Dữ liệu cá nhân' ? (
              <Pressable key={item.title} accessibilityRole="button" onPress={() => router.push('/personal-profile')} style={rowStyle}>
                {content}
              </Pressable>
            ) : <View key={item.title} style={rowStyle}>{content}</View>;
          })}
        </View>
        <View style={styles.logout}><SignOutButton /></View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  eyebrow: { color: colors.muted, fontFamily: 'Roboto_400Regular', fontSize: 13, lineHeight: 18 },
  title: { marginTop: 7, color: colors.ink, fontFamily: 'Roboto_700Bold', fontSize: 28, lineHeight: 38 },
  card: { backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.divider, borderRadius: 16 },
  identity: { marginTop: 25, minHeight: 103, padding: 13, flexDirection: 'row', gap: 14, alignItems: 'center' },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.pale, alignItems: 'center', justifyContent: 'center' },
  identityText: { flex: 1, minWidth: 0, gap: 3 },
  name: { color: colors.ink, fontFamily: 'Roboto_700Bold', fontSize: 18, lineHeight: 27 },
  email: { color: colors.muted, fontFamily: 'Roboto_400Regular', fontSize: 13, lineHeight: 18 },
  sectionTitle: { marginTop: 28, fontFamily: 'Roboto_700Bold', fontSize: 16, lineHeight: 24, color: colors.ink },
  settings: { marginTop: 14, paddingHorizontal: 13, paddingVertical: 9, gap: 6 },
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.divider },
  iconBox: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.pale },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { fontFamily: 'Roboto_700Bold', fontSize: 14, lineHeight: 20, color: colors.ink },
  rowSubtitle: { fontFamily: 'Roboto_400Regular', fontSize: 12, lineHeight: 17, color: colors.muted },
  logout: { marginTop: 70 },
});

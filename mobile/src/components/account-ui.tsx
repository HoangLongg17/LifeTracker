import { Image } from 'expo-image';
import { signOut } from 'firebase/auth';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { auth } from '@/config/firebase';
import { useSession } from '@/hooks/use-session';

export const colors = {
  page: '#F8F8F1', paper: '#FFFFFF', ink: '#182E27', muted: '#506159',
  primary: '#174E40', link: '#205B47', onPrimary: '#F8FFF0', pale: '#E6EDDC',
  border: '#C8D1C5', divider: '#D8E0D1', error: '#B42318',
};

export const accountStyles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  content: { flexGrow: 1, width: '100%', maxWidth: 480, alignSelf: 'center', paddingHorizontal: 20 },
  brand: { height: 32, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  logo: { width: 30, height: 30, borderRadius: 10, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  brandText: { marginTop: 4, color: colors.ink, fontFamily: 'Roboto_700Bold', fontSize: 16, lineHeight: 22 },
  title: { marginTop: 51, color: colors.ink, fontFamily: 'Roboto_700Bold', fontSize: 32, lineHeight: 44, includeFontPadding: false },
  subtitle: { marginTop: 11, maxWidth: 315, color: colors.muted, fontFamily: 'Roboto_400Regular', fontSize: 15, lineHeight: 22 },
  label: { color: colors.ink, fontFamily: 'Roboto_700Bold', fontSize: 13, lineHeight: 18, includeFontPadding: false },
  inputBox: { marginTop: 5, minHeight: 48, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 13, gap: 11, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.border, borderRadius: 11 },
  fieldIcon: { width: 17, height: 17 },
  input: { flex: 1, minWidth: 0, minHeight: 46, padding: 0, color: colors.ink, fontFamily: 'Roboto_400Regular', fontSize: 15, includeFontPadding: false },
  link: { color: colors.link, fontFamily: 'Roboto_700Bold', fontSize: 13, lineHeight: 20 },
  linkRow: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-start' },
  button: { minHeight: 48, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 13, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  outline: { backgroundColor: colors.paper, borderColor: colors.border, borderWidth: 1 },
  buttonText: { color: colors.onPrimary, fontFamily: 'Roboto_700Bold', fontSize: 14, lineHeight: 20 },
  disabledButton: { backgroundColor: colors.pale, borderColor: colors.divider, borderWidth: 1 },
  errorText: { flexShrink: 1, color: colors.error, fontFamily: 'Roboto_400Regular', fontSize: 13, lineHeight: 18 },
  errorRow: { marginTop: 6, flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
});

export function AccountBrand() {
  return (
    <View style={accountStyles.brand}>
      <View style={accountStyles.logo}>
        <Image source={require('../../assets/images/registration/sprout.svg')} style={{ width: 20, height: 20 }} />
      </View>
      <Text style={accountStyles.brandText}>Life Tracker</Text>
    </View>
  );
}

export function AccountButton({ label, onPress, busy = false, disabled = false, outline = false }: {
  label: string; onPress: () => void; busy?: boolean; disabled?: boolean; outline?: boolean;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy} onPress={onPress}
      style={({ pressed }) => [accountStyles.button, outline && accountStyles.outline,
        disabled && accountStyles.disabledButton, pressed && { opacity: 0.85 }]}>
      {busy ? <ActivityIndicator color={outline ? colors.link : colors.onPrimary} /> : (
        <Text style={[accountStyles.buttonText, outline && { color: colors.link }, disabled && { color: colors.muted }]}>{label}</Text>
      )}
    </Pressable>
  );
}

export function ErrorMessage({ message }: { message: string }) {
  return (
    <View style={accountStyles.errorRow}>
      <Image source={require('../../assets/images/account/triangle-alert.svg')} style={{ width: 16, height: 16 }} />
      <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={accountStyles.errorText}>{message}</Text>
    </View>
  );
}

export function SignOutButton({ label = 'Đăng xuất' }: { label?: string }) {
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function leave() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage('');
    try {
      await signOut(auth);
    } catch {
      setMessage('Không thể đăng xuất. Vui lòng thử lại.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <View>
      <AccountButton label={label} onPress={leave} outline busy={busy} />
      {!!message && <ErrorMessage message={message} />}
    </View>
  );
}

export function SessionRecovery() {
  const { session, retry } = useSession();
  if (session.status === 'checking') return <ActivityIndicator color={colors.primary} accessibilityLabel="Đang kiểm tra tài khoản" />;
  if (session.status !== 'unavailable') return null;
  return (
    <View style={{ gap: 12 }}>
      <ErrorMessage message={session.message} />
      <AccountButton label="Thử lại" onPress={retry} />
      <SignOutButton label="Dùng tài khoản khác" />
    </View>
  );
}

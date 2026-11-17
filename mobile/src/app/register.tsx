import { Image } from 'expo-image';
import { Link } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts, Roboto_400Regular, Roboto_700Bold } from '@expo-google-fonts/roboto';
import { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth } from '@/config/firebase';
import { completeProfile, createAccount } from '@/services/registration';
import { registrationError, validateRegistration } from '@/utils/registration';

export default function RegisterScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [hasReadInfo, setHasReadInfo] = useState(false);
  const [fontsLoaded, fontError] = useFonts({ Roboto_400Regular, Roboto_700Bold });
  const [errors, setErrors] = useState<ReturnType<typeof validateRegistration>>({});
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState('');
  const lock = useRef(false);

  useEffect(() => onAuthStateChanged(auth, (current) => {
    setUser(current);
    setReady(false);
    setLoading(false);
  }), []);

  async function finish(current: User) {
    try {
      await completeProfile(current);
      setReady(true);
      setMessage('Tài khoản và hồ sơ của bạn đã sẵn sàng.');
    } catch {
      setMessage('Tài khoản đã được tạo, nhưng chưa hoàn tất hồ sơ. Vui lòng kiểm tra kết nối và nhấn Thử lại.');
    }
  }

  async function submit() {
    if (lock.current) return;
    const issues = validateRegistration(email, password, confirmation);
    setErrors(issues);
    if (!user && Object.keys(issues).length) return;
    lock.current = true;
    setBusy(true);
    setMessage('');
    try {
      let current = user;
      if (!current) {
        const result = await createAccount(email, password);
        current = result.user;
        setUser(current);
        setPassword('');
        setConfirmation('');
      }
      await finish(current);
    } catch (error) {
      setMessage(registrationError(error));
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }

  async function logout() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await signOut(auth);
      setReady(false);
      setMessage('');
      setErrors({});
      setHasReadInfo(false);
    } catch {
      setMessage('Không thể đăng xuất. Vui lòng thử lại.');
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }

  if (!fontsLoaded && !fontError) return <ActivityIndicator accessibilityLabel="Đang tải phông chữ" />;

  return (
    <SafeAreaView style={styles.page}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          <View style={styles.brand}>
            <View style={styles.logo}><Image source={require('../../assets/images/registration/sprout.svg')} style={{ width: 20, height: 20 }} /></View>
            <Text style={styles.brandText}>Life Tracker</Text>
          </View>
          <Text style={styles.title}>{ready ? 'Hoàn tất đăng ký' : 'Tạo tài khoản'}</Text>
          <Text style={styles.subtitle}>Dùng email để lưu nhật ký và mục tiêu của riêng bạn.</Text>
          {loading ? <ActivityIndicator style={styles.form} accessibilityLabel="Đang kiểm tra tài khoản" /> : user ? (
            <View style={styles.form}>
              <Text style={styles.label}>{user.email}</Text>
              {!ready && <Text style={styles.subtitle}>Hoàn tất hồ sơ để sử dụng Life Tracker. Nếu kết nối bị gián đoạn, bạn có thể tiếp tục tại đây.</Text>}
              {!ready && <Pressable accessibilityRole="button" disabled={busy} onPress={submit} style={[styles.button, busy && styles.disabled]}><Text style={styles.buttonText}>{busy ? 'Đang hoàn tất...' : message ? 'Thử lại' : 'Hoàn tất hồ sơ'}</Text></Pressable>}
              <Pressable accessibilityRole="button" disabled={busy} onPress={logout}><Text style={styles.link}>Đăng xuất</Text></Pressable>
            </View>
          ) : (
            <View style={styles.form}>
              <View style={styles.field}>
                <Text style={styles.label}>Email</Text>
                <View style={[styles.inputBox, errors.email && styles.invalid]}>
                  <Image source={require('../../assets/images/registration/mail.svg')} style={styles.fieldIcon} />
                  <TextInput accessibilityLabel="Email" value={email} onChangeText={setEmail} placeholder="minh@example.com" placeholderTextColor="#506159" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" editable={!busy} style={styles.input} />
                </View>
                {errors.email && <Text accessibilityRole="alert" style={styles.error}>{errors.email}</Text>}
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>Mật khẩu</Text>
                <View style={[styles.inputBox, errors.password && styles.invalid]}>
                  <Image source={require('../../assets/images/registration/lock.svg')} style={styles.fieldIcon} />
                  <TextInput accessibilityLabel="Mật khẩu" accessibilityHint="Ít nhất 8 ký tự" value={password} onChangeText={setPassword} placeholder="Tối thiểu 8 ký tự" placeholderTextColor="#506159" secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="new-password" editable={!busy} style={styles.input} />
                </View>
                {errors.password && <Text accessibilityRole="alert" style={styles.error}>{errors.password}</Text>}
              </View>
              <View style={styles.lastField}>
                <Text style={styles.label}>Nhập lại mật khẩu</Text>
                <View style={[styles.inputBox, errors.confirmation && styles.invalid]}>
                  <Image source={require('../../assets/images/registration/lock.svg')} style={styles.fieldIcon} />
                  <TextInput accessibilityLabel="Nhập lại mật khẩu" value={confirmation} onChangeText={setConfirmation} placeholder="Nhập lại mật khẩu" placeholderTextColor="#506159" secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="new-password" editable={!busy} onSubmitEditing={submit} style={styles.input} />
                </View>
                {errors.confirmation && <Text accessibilityRole="alert" style={styles.error}>{errors.confirmation}</Text>}
              </View>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityLabel="Tôi đã đọc thông tin về dữ liệu cá nhân và phạm vi hỗ trợ thói quen sinh hoạt."
                accessibilityState={{ checked: hasReadInfo, disabled: busy }}
                disabled={busy}
                onPress={() => setHasReadInfo((checked) => !checked)}
                style={[styles.notice, busy && styles.disabled]}
              >
                <View style={[styles.checkbox, hasReadInfo && styles.checkboxChecked]}>
                  {hasReadInfo && <Text style={styles.checkmark}>✓</Text>}
                </View>
                <Text style={styles.noticeText}>Tôi đã đọc thông tin về dữ liệu cá nhân và phạm vi hỗ trợ thói quen sinh hoạt.</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} onPress={submit} style={[styles.button, busy && styles.disabled]}>{busy ? <ActivityIndicator color="#F8FFF0" /> : <Text style={styles.buttonText}>Tạo tài khoản</Text>}</Pressable>
              <Link href="/login" asChild>
                <Pressable accessibilityRole="link" disabled={busy} style={styles.loginLink}>
                  <Text style={styles.link}>Đã có tài khoản? Đăng nhập</Text>
                  <Image source={require('../../assets/images/registration/arrow.svg')} style={{ width: 15, height: 15 }} />
                </Pressable>
              </Link>
            </View>
          )}
          {!!message && <Text accessibilityLiveRegion="polite" style={ready ? styles.success : styles.error}>{message}</Text>}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#F8F8F1' },
  content: { paddingHorizontal: 20, paddingTop: 13, paddingBottom: 40, width: '100%', maxWidth: 480, alignSelf: 'center', flexGrow: 1 },
  brand: { height: 32, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  logo: { width: 30, height: 30, borderRadius: 10, backgroundColor: '#174E40', alignItems: 'center', justifyContent: 'center' },
  brandText: { fontFamily: 'Roboto_700Bold', fontSize: 16, lineHeight: 22, color: '#182E27', marginTop: 4 },
  title: { marginTop: 51, fontFamily: 'Roboto_700Bold', fontSize: 32, lineHeight: 44, color: '#182E27', includeFontPadding: false },
  subtitle: { marginTop: 11, color: '#506159', fontFamily: 'Roboto_400Regular', fontSize: 15, lineHeight: 22, maxWidth: 315 },
  form: { marginTop: 24 },
  field: { marginBottom: 22 },
  lastField: {},
  label: { color: '#182E27', fontFamily: 'Roboto_700Bold', fontSize: 13, lineHeight: 18, includeFontPadding: false },
  inputBox: { marginTop: 5, height: 48, flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderColor: '#C8D1C5', borderWidth: 1, borderRadius: 11, paddingHorizontal: 13, gap: 11 },
  fieldIcon: { width: 17, height: 17 },
  input: { flex: 1, minWidth: 0, height: 46, color: '#182E27', fontFamily: 'Roboto_400Regular', fontSize: 15, padding: 0, includeFontPadding: false },
  checkbox: { width: 24, height: 24, borderWidth: 1.5, borderColor: '#205B47', borderRadius: 12, backgroundColor: '#F8FFF0', alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { backgroundColor: '#174E40' },
  checkmark: { color: '#FFFFFF', fontSize: 18, lineHeight: 22, fontWeight: '700' },
  notice: { marginTop: 30, minHeight: 62, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#E6EDDC' },
  noticeText: { flex: 1, color: '#205B47', fontFamily: 'Roboto_400Regular', fontSize: 13, lineHeight: 18 },
  invalid: { borderColor: '#B91C1C' },
  error: { color: '#B91C1C', fontFamily: 'Roboto_400Regular', fontSize: 13, lineHeight: 18, marginTop: 6 },
  success: { color: '#174E40', fontFamily: 'Roboto_400Regular', fontSize: 15, lineHeight: 22 },
  button: { backgroundColor: '#174E40', height: 48, justifyContent: 'center', alignItems: 'center', borderRadius: 13, marginTop: 27 },
  buttonText: { color: '#F8FFF0', fontFamily: 'Roboto_700Bold', fontSize: 14, lineHeight: 20 },
  disabled: { opacity: 0.6 },
  loginLink: { marginTop: 14, minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 7 },
  link: { color: '#205B47', fontFamily: 'Roboto_700Bold', fontSize: 13, lineHeight: 20 },
});

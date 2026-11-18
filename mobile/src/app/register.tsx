import { Image } from 'expo-image';
import { Link, router, useNavigation } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AccountBrand, accountStyles as ui, SessionRecovery } from '@/components/account-ui';
import { useSession } from '@/hooks/use-session';
import { createAccount } from '@/services/registration';
import { registrationError, validateRegistration } from '@/utils/registration';

export default function RegisterScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [hasReadInfo, setHasReadInfo] = useState(false);
  const { session } = useSession();
  const navigation = useNavigation();
  const [errors, setErrors] = useState<ReturnType<typeof validateRegistration>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const lock = useRef(false);
  const submitDisabled = busy || !hasReadInfo || session.status !== 'guest';

  async function submit() {
    if (lock.current || submitDisabled) return;
    const issues = validateRegistration(email, password, confirmation);
    setErrors(issues);
    if (Object.keys(issues).length) return;
    lock.current = true;
    setBusy(true);
    setMessage('');
    try {
      const registration = await createAccount(email, password);
      setPassword('');
      setConfirmation('');
      setHasReadInfo(false);
      if (navigation.isFocused()) {
        router.dismissTo({ pathname: '/login', params: { registration } });
      }
    } catch (error) {
      setMessage(registrationError(error));
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }

  return (
    <SafeAreaView style={ui.page}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView style={ui.page} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          <AccountBrand />
          <Text style={ui.title}>Tạo tài khoản</Text>
          <Text style={ui.subtitle}>Dùng email để lưu nhật ký và mục tiêu của riêng bạn.</Text>
          {session.status !== 'guest' ? (
            <View style={styles.form}><SessionRecovery /></View>
          ) : (
            <View style={styles.form}>
              <View style={styles.field}>
                <Text style={ui.label}>Email</Text>
                <View style={[ui.inputBox, errors.email && styles.invalid]}>
                  <Image source={require('../../assets/images/registration/mail.svg')} style={ui.fieldIcon} />
                  <TextInput accessibilityLabel="Email" value={email} onChangeText={setEmail} placeholder="minh@example.com" placeholderTextColor="#506159" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" editable={!busy} style={ui.input} />
                </View>
                {errors.email && <Text accessibilityRole="alert" style={styles.error}>{errors.email}</Text>}
              </View>
              <View style={styles.field}>
                <Text style={ui.label}>Mật khẩu</Text>
                <View style={[ui.inputBox, errors.password && styles.invalid]}>
                  <Image source={require('../../assets/images/registration/lock.svg')} style={ui.fieldIcon} />
                  <TextInput accessibilityLabel="Mật khẩu" accessibilityHint="Ít nhất 8 ký tự" value={password} onChangeText={setPassword} placeholder="Tối thiểu 8 ký tự" placeholderTextColor="#506159" secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="new-password" editable={!busy} style={ui.input} />
                </View>
                {errors.password && <Text accessibilityRole="alert" style={styles.error}>{errors.password}</Text>}
              </View>
              <View style={styles.lastField}>
                <Text style={ui.label}>Nhập lại mật khẩu</Text>
                <View style={[ui.inputBox, errors.confirmation && styles.invalid]}>
                  <Image source={require('../../assets/images/registration/lock.svg')} style={ui.fieldIcon} />
                  <TextInput accessibilityLabel="Nhập lại mật khẩu" value={confirmation} onChangeText={setConfirmation} placeholder="Nhập lại mật khẩu" placeholderTextColor="#506159" secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="new-password" editable={!busy} onSubmitEditing={submit} style={ui.input} />
                </View>
                {errors.confirmation && <Text accessibilityRole="alert" style={styles.error}>{errors.confirmation}</Text>}
              </View>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityLabel="Tôi đã đọc thông tin về dữ liệu cá nhân và phạm vi hỗ trợ thói quen sinh hoạt."
                accessibilityHint="Cần tích ô này để tạo tài khoản."
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
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: submitDisabled }}
                disabled={submitDisabled}
                onPress={submit}
                style={[styles.button, submitDisabled && styles.disabled]}
              >
                {busy ? <ActivityIndicator color="#F8FFF0" /> : <Text style={ui.buttonText}>Tạo tài khoản</Text>}
              </Pressable>
              <Link href="/login" dismissTo asChild>
                <Pressable accessibilityRole="link" disabled={busy} style={styles.loginLink}>
                  <Text style={ui.link}>Đã có tài khoản? Đăng nhập</Text>
                  <Image source={require('../../assets/images/registration/arrow.svg')} style={{ width: 15, height: 15 }} />
                </Pressable>
              </Link>
            </View>
          )}
          {session.status === 'guest' && !!(message || session.message) && (
            <Text accessibilityLiveRegion="polite" style={styles.error}>{message || session.message}</Text>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 13, paddingBottom: 40, width: '100%', maxWidth: 480, alignSelf: 'center', flexGrow: 1 },
  form: { marginTop: 24 },
  field: { marginBottom: 22 },
  lastField: {},
  checkbox: { width: 24, height: 24, borderWidth: 1.5, borderColor: '#205B47', borderRadius: 12, backgroundColor: '#F8FFF0', alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { backgroundColor: '#174E40' },
  checkmark: { color: '#FFFFFF', fontSize: 18, lineHeight: 22, fontWeight: '700' },
  notice: { marginTop: 30, minHeight: 62, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#E6EDDC' },
  noticeText: { flex: 1, color: '#205B47', fontFamily: 'Roboto_400Regular', fontSize: 13, lineHeight: 18 },
  invalid: { borderColor: '#B91C1C' },
  error: { color: '#B91C1C', fontFamily: 'Roboto_400Regular', fontSize: 13, lineHeight: 18, marginTop: 6 },
  button: { backgroundColor: '#174E40', height: 48, justifyContent: 'center', alignItems: 'center', borderRadius: 13, marginTop: 27 },
  disabled: { opacity: 0.6 },
  loginLink: { marginTop: 14, minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 7 },
});

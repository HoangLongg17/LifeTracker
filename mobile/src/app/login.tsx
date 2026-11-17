import { Image } from 'expo-image';
import { Link, router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { useRef, useState, type ComponentRef } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AccountBrand, AccountButton, accountStyles as ui, colors, ErrorMessage, SessionRecovery } from '@/components/account-ui';
import { auth } from '@/config/firebase';
import { useSession } from '@/hooks/use-session';
import { isValidEmail, loginError } from '@/utils/auth';

type LoginIssue = ReturnType<typeof loginError>;

export default function LoginScreen() {
  const { session } = useSession();
  const { registration } = useLocalSearchParams<{ registration?: string }>();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [issue, setIssue] = useState<LoginIssue | null>(null);
  const [busy, setBusy] = useState(false);
  const [dismissedNotice, setDismissedNotice] = useState<typeof session>();
  const [focused, setFocused] = useState<'email' | 'password' | null>(null);
  const emailInput = useRef<ComponentRef<typeof TextInput>>(null);
  const passwordInput = useRef<ComponentRef<typeof TextInput>>(null);
  const submitting = useRef(false);
  const [badCredentials, setBadCredentials] = useState(false);

  function edit(value: string, field: 'email' | 'password') {
    if (registration) router.setParams({ registration: undefined });
    (field === 'email' ? setEmail : setPassword)(value);
    setIssue(null);
    setBadCredentials(false);
    setDismissedNotice(session);
  }

  async function submit() {
    if (submitting.current || badCredentials || session.status !== 'guest') return;
    setDismissedNotice(session);
    if (!isValidEmail(email)) {
      setIssue({ field: 'email', message: email.trim() ? 'Vui lòng nhập email hợp lệ.' : 'Vui lòng nhập email.' });
      emailInput.current?.focus();
      return;
    }
    if (!password) {
      setIssue({ field: 'password', message: 'Vui lòng nhập mật khẩu.' });
      passwordInput.current?.focus();
      return;
    }
    submitting.current = true;
    setIssue(null);
    setBusy(true);
    Keyboard.dismiss();
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      setPassword('');
    } catch (error) {
      const problem = loginError(error);
      setIssue(problem);
      setBadCredentials(problem.field === 'password');
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  function resetForm() {
    setEmail('');
    setPassword('');
    setIssue(null);
    setBadCredentials(false);
    setDismissedNotice(session);
  }

  const registerLink = (
    <Link href="/register" onPress={resetForm} asChild>
      <Pressable accessibilityRole="link" accessibilityLabel="Chưa có tài khoản? Đăng ký"
        disabled={busy} style={StyleSheet.flatten([ui.linkRow, badCredentials && styles.errorLink])}>
        <Text style={ui.link}>Chưa có tài khoản? Đăng ký</Text>
        <Image source={require('../../assets/images/registration/arrow.svg')} style={{ width: 15, height: 15 }} />
      </Pressable>
    </Link>
  );
  const loginButton = <AccountButton label="Đăng nhập" onPress={submit} busy={busy} disabled={badCredentials} />;
  const notice = dismissedNotice !== session && session.status === 'guest' ? session.message : undefined;

  let subtitle = 'Mở nhật ký và tiếp tục theo dõi mục tiêu của bạn.';
  if (badCredentials) subtitle = 'Dùng email để mở nhật ký của bạn.';
  else if (registration === 'complete') subtitle = 'Tạo tài khoản thành công. Hãy đăng nhập để tiếp tục.';
  else if (registration === 'profile-pending') subtitle = 'Tài khoản đã được tạo. Hãy đăng nhập để hoàn tất hồ sơ.';

  return (
    <SafeAreaView style={ui.page} edges={['left', 'right']}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView style={ui.page} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[ui.content, {
          paddingTop: Math.max(insets.top, 32) + 13, paddingBottom: Math.max(insets.bottom + 16, 48),
        }]}>
          <AccountBrand />
          <Text accessibilityRole="header" style={[ui.title, badCredentials && styles.errorTitle]}>Đăng nhập</Text>
          <Text accessibilityLiveRegion="polite" style={[ui.subtitle, badCredentials && styles.errorSubtitle]}>{subtitle}</Text>
          {session.status === 'guest' ? (
            <>
              <View style={[styles.fields, badCredentials && styles.errorFields]}>
                <View>
                  <Text style={ui.label}>Email</Text>
                  <View style={[ui.inputBox, focused === 'email' && styles.focused, issue?.field === 'email' && styles.invalid]}>
                    <Image source={require('../../assets/images/registration/mail.svg')} style={ui.fieldIcon} />
                    <TextInput ref={emailInput} onFocus={() => setFocused('email')} onBlur={() => setFocused(null)} accessibilityLabel="Email" value={email} onChangeText={value => edit(value, 'email')}
                      placeholder="minh@example.com" placeholderTextColor={colors.muted} keyboardType="email-address"
                      autoComplete="email" autoCapitalize="none" autoCorrect={false} returnKeyType="next"
                      submitBehavior="submit" onSubmitEditing={() => passwordInput.current?.focus()} editable={!busy} underlineColorAndroid="transparent" style={[ui.input, styles.input]} />
                  </View>
                  {issue?.field === 'email' && <ErrorMessage message={issue.message} />}
                </View>
                <View>
                  <Text style={ui.label}>Mật khẩu</Text>
                  <View style={[ui.inputBox, focused === 'password' && styles.focused, issue?.field === 'password' && styles.invalid]}>
                    <Image source={require('../../assets/images/registration/lock.svg')} style={ui.fieldIcon} />
                    <TextInput ref={passwordInput} onFocus={() => setFocused('password')} onBlur={() => setFocused(null)} accessibilityLabel="Mật khẩu" value={password} onChangeText={value => edit(value, 'password')}
                      placeholder="••••••••" placeholderTextColor={colors.muted} secureTextEntry autoComplete="current-password"
                      autoCapitalize="none" autoCorrect={false} returnKeyType="go" onSubmitEditing={submit} editable={!busy} underlineColorAndroid="transparent" style={[ui.input, styles.input]} />
                  </View>
                  {issue?.field === 'password' && <ErrorMessage message={issue.message} />}
                </View>
              </View>
              {issue && !issue.field && <ErrorMessage message={issue.message} />}
              {!!notice && <ErrorMessage message={notice} />}
              {badCredentials ? (
                <View style={styles.errorActions}>{registerLink}{loginButton}</View>
              ) : (
                <View style={styles.actions}>{loginButton}{registerLink}</View>
              )}
            </>
          ) : (
            <View style={styles.fields}><SessionRecovery /></View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fields: { marginTop: 24, gap: 22 },
  actions: { marginTop: 44, gap: 21 },
  focused: { borderColor: colors.link },
  input: { outlineWidth: 0 },
  errorSubtitle: { marginTop: 17 },
  invalid: { borderColor: colors.error, borderWidth: 2 },
  errorTitle: { fontSize: 28, lineHeight: 38, marginTop: 39 },
  errorFields: { marginTop: 38, gap: 16 },
  errorActions: { marginTop: 'auto', paddingTop: 28, gap: 18 },
  errorLink: { gap: 44 },
});

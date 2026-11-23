import { Roboto_400Regular, Roboto_700Bold, useFonts } from '@expo-google-fonts/roboto';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { ActivityIndicator, useColorScheme, View } from 'react-native';

import { SessionProvider, useSession } from '@/hooks/use-session';

SplashScreen.preventAutoHideAsync();

function Navigation() {
  const { session, initialized } = useSession();
  const [fontsLoaded, fontError] = useFonts({ Roboto_400Regular, Roboto_700Bold });
  const colorScheme = useColorScheme();
  const ready = initialized && (fontsLoaded || !!fontError);
  const signedIn = session.status === 'active';

  useEffect(() => {
    if (ready) SplashScreen.hide();
  }, [ready]);

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: '#F8F8F1', justifyContent: 'center' }}>
        <ActivityIndicator color="#174E40" accessibilityLabel="Đang kiểm tra phiên đăng nhập" />
      </View>
    );
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="login" />
          <Stack.Screen name="register" />
        </Stack.Protected>
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="journal-add" />
          <Stack.Screen name="activity" />
          <Stack.Screen name="sleep" />
          <Stack.Screen name="profile" />
          <Stack.Screen name="personal-profile" />
          <Stack.Screen name="water" />
          <Stack.Screen name="water/new" />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return <SessionProvider><Navigation /></SessionProvider>;
}

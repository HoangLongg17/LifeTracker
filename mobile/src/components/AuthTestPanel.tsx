
import { useEffect, useState } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import {
  Button,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import { auth } from "@/config/firebase";

export default function AuthTestScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUserEmail(user?.email ?? null);
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const login = async () => {
    if (!email.trim() || !password) {
      setMessage("Vui lòng nhập email và mật khẩu");
      return;
    }

    setBusy(true);
    setMessage("");

    try {
      await signInWithEmailAndPassword(
        auth,
        email.trim(),
        password
      );

      setPassword("");
      setMessage("Đăng nhập thành công!");
    } catch (error) {
      const code =
        typeof error === "object" &&
        error !== null &&
        "code" in error
          ? String(error.code)
          : "unknown";

      setMessage(`Đăng nhập thất bại: ${code}`);
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    setBusy(true);

    try {
      await signOut(auth);
      setMessage("Đã đăng xuất");
    } catch {
      setMessage("Không thể đăng xuất");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView
      contentContainerStyle={{
        padding: 24,
        paddingTop: 48,
        gap: 16,
      }}
    >
      <Text style={{ fontSize: 24, fontWeight: "bold" }}>
        Firebase Auth Test
      </Text>

      <Text>
        {loading
          ? "Đang kiểm tra phiên đăng nhập..."
          : userEmail
            ? `Đã đăng nhập: ${userEmail}`
            : "Chưa đăng nhập"}
      </Text>

      {!userEmail && !loading && (
        <View style={{ gap: 12 }}>
            <TextInput
            placeholder="Email thử nghiệm"
            placeholderTextColor="#777777"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            style={{
                backgroundColor: "#FFFFFF",
                color: "#111111",
                borderWidth: 1,
                borderColor: "#999999",
                borderRadius: 8,
                padding: 12,
                fontSize: 16,
            }}/>
            <TextInput
            placeholder="Mật khẩu"
            placeholderTextColor="#777777"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            style={{
                backgroundColor: "#FFFFFF",
                color: "#111111",
                borderWidth: 1,
                borderColor: "#999999",
                borderRadius: 8,
                padding: 12,
                fontSize: 16,
            }}
            />


          <Button
            title="Đăng nhập thử"
            onPress={login}
            disabled={busy}
          />
        </View>
      )}

      {userEmail && (
        <Button
          title="Đăng xuất"
          onPress={logout}
          disabled={busy}
        />
      )}

      <Text>{message}</Text>
    </ScrollView>
  );
}

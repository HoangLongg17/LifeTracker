
import { useState } from "react";
import {
    Alert,
    Button,
    Text,
    View,
    useColorScheme,
} from "react-native";

export default function TestBackendButton() {
    const [result, setResult] = useState("Chưa kiểm tra");
    const colorScheme = useColorScheme();

    const checkConnection = async () => {
        // Kiểm tra nút có hoạt động không
        Alert.alert("Thông báo", "Bạn đã nhấn nút kiểm tra!");

        setResult("Đang kết nối Backend...");

        try {
            const apiUrl = process.env.EXPO_PUBLIC_API_URL;

            if (!apiUrl) {
                throw new Error("Chưa cấu hình API URL");
            }

            const response = await fetch(`${apiUrl}/health`);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();

            const message = `Kết nối thành công: ${data.status}`;

            setResult(message);
            Alert.alert("Thành công", message);
        } catch (error) {
            console.error(error);

            const message =
                error instanceof Error
                    ? error.message
                    : "Lỗi không xác định";

            setResult(`Kết nối thất bại: ${message}`);
            Alert.alert("Lỗi kết nối", message);
        }
    };

    return (
        <View
            style={{
                padding: 12,
                alignSelf: "stretch",
                gap: 12,
            }}
        >
            <Button
                title="Kiểm tra kết nối Backend"
                onPress={checkConnection}
            />

            <Text
                style={{
                    color: colorScheme === "dark" ? "#FFFFFF" : "#111111",
                    fontSize: 16,
                    textAlign: "center",
                }}
            >
                {result}
            </Text>
        </View>
    );
}

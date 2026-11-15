
import { useSyncExternalStore } from "react";
import { useColorScheme as useRNColorScheme } from "react-native";

// Không cần đăng ký sự kiện vì trạng thái này không thay đổi sau hydration.
const subscribe = () => () => {};

// Khi chạy trên trình duyệt, ứng dụng đã có thể đọc giao diện hiện tại.
const getSnapshot = () => true;

// Khi render trên server và trong lần hydration đầu tiên,
// sử dụng giao diện sáng để tránh không khớp nội dung.
const getServerSnapshot = () => false;

export function useColorScheme() {
  const hasHydrated = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot
  );

  const colorScheme = useRNColorScheme();

  return hasHydrated ? colorScheme : "light";
}

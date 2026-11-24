import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { accountStyles, colors, ErrorMessage } from '@/components/account-ui';
import { j } from '@/components/journal-ui';
import { useSession } from '@/hooks/use-session';
import { getFood } from '@/services/foods';
import { AccountRequestError } from '@/services/session';
import type { Food } from '@/utils/food';

export const f = StyleSheet.create({
  block: { marginTop: 28, gap: 8 },
  stack: { gap: 12 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  selected: { borderWidth: 1, borderColor: colors.primary, borderRadius: 10, backgroundColor: colors.pale },
  chip: { paddingHorizontal: 13, minHeight: 42, justifyContent: 'center', alignItems: 'center',
    backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.border, borderRadius: 10 },
  info: { backgroundColor: '#F1ECE1', padding: 16, borderRadius: 16, gap: 10 },
  nutrientRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12,
    minHeight: 34, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  separator: { marginVertical: 4 },
});
export function FoodIcon({ name }: { name: 'search' | 'utensils' }) {
  return <Image source={name === 'search' ? require('../../assets/images/foods/search.svg') : require('../../assets/images/foods/utensils.svg')}
    style={{ width: name === 'search' ? 17 : 21, height: name === 'search' ? 17 : 21 }} />;
}
export function FoodLink({ label, onPress }: { label: string; onPress: () => void }) {
  return <Pressable onPress={onPress} accessibilityRole="button" style={j.linkRow}>
    <Text style={accountStyles.link}>{label}</Text>
    <Image source={require('../../assets/images/registration/arrow.svg')} style={{ width: 15, height: 15 }} />
  </Pressable>;
}
export function LoadingFood() {
  return <ActivityIndicator style={f.block} color={colors.primary} accessibilityLabel="Đang tải thực phẩm" />;
}
export function FoodError({ message, retry }: { message: string; retry: () => void }) {
  return <View style={f.block}><ErrorMessage message={message} /><FoodLink label="Thử lại" onPress={retry} /></View>;
}
export function foodErrorMessage(error: unknown) {
  if (error instanceof AccountRequestError) {
    if (error.code === 'FOOD_NOT_FOUND') return 'Thực phẩm này hiện không có trong danh mục.';
    if (error.status === 401 || error.status === 403) return 'Phiên truy cập không còn hợp lệ. Vui lòng đăng nhập lại.';
  }
  return 'Chưa tải được danh mục. Kiểm tra kết nối rồi thử lại.';
}
export function useFoodById(id: string) {
  const { session } = useSession();
  const user = session.status === 'active' ? session.user : null;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ key: string; food?: Food; error?: string }>({ key: '' });
  const key = JSON.stringify([user?.uid, id, attempt]);
  useEffect(() => {
    if (!user || !id) return;
    let current = true;
    getFood(user, id).then(food => { if (current) setState({ key, food }); })
      .catch(error => { if (current) setState({ key, error: foodErrorMessage(error) }); });
    return () => { current = false; };
  }, [user, id, key]);
  return { food: key === state.key ? state.food : undefined,
    error: !id ? 'Chưa chọn thực phẩm.' : key === state.key ? state.error : undefined,
    retry: () => setAttempt(x => x + 1) };
}

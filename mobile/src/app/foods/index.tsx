import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { accountStyles as ui, colors } from '@/components/account-ui';
import { FoodError, FoodIcon, FoodLink, LoadingFood, f, foodErrorMessage } from '@/components/food-ui';
import { FormHeading, JournalBack, JournalPage, j } from '@/components/journal-ui';
import { useSession } from '@/hooks/use-session';
import { searchFoods } from '@/services/foods';
import { AccountRequestError } from '@/services/session';
import { basisText, nutrientText, type Food, type FoodPage } from '@/utils/food';
import { dayKey, displayDate } from '@/utils/journal-time';

type SearchState = { key: string; data?: FoodPage; error?: string; busy?: boolean; reset?: boolean };

export default function FoodSearch() {
  const { session } = useSession();
  const user = session.status === 'active' ? session.user : null;
  const params = useLocalSearchParams<{ date?: string }>();
  const date = dayKey(params.date ?? '');
  const [q, setQ] = useState('');
  const [focused, setFocused] = useState(false);
  const key = JSON.stringify([user?.uid, q.trim()]);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<SearchState>({ key: '' });
  const generation = useRef(0);
  const pending = useRef(false);
  const query = q.trim();
  const request = useCallback(async (seq: number, cursor?: string) => {
    if (!user || pending.current || seq !== generation.current) return;
    pending.current = true;
    setState(s => ({ key, data: cursor ? s.data : undefined, busy: true }));
    try {
      const page = await searchFoods(user, query, cursor);
      if (seq !== generation.current) return;
      setState(s => ({
        key, data: { items: cursor ? [...(s.data?.items ?? []), ...page.items] : page.items, nextCursor: page.nextCursor },
      }));
    } catch (error) {
      if (seq !== generation.current) return;
      const reset = error instanceof AccountRequestError && error.code === 'INVALID_CURSOR';
      setState(s => ({ key, data: cursor ? s.data : undefined, reset,
        error: reset ? 'Danh mục vừa thay đổi. Hãy tải lại kết quả.' : foodErrorMessage(error) }));
    } finally { if (seq === generation.current) pending.current = false; }
  }, [user, query, key]);
  useEffect(() => {
    const seq = ++generation.current;
    pending.current = false;
    const timer = setTimeout(() => { void request(seq); }, query ? 240 : 0);
    return () => { clearTimeout(timer); generation.current = seq + 1; };
  }, [query, request, attempt]);
  const shown = state.key === key ? state : undefined;
  const page = shown?.data;
  function open(food: Food, pathname: '/foods/[foodId]' | '/foods/portion') {
    router.push({ pathname, params: { foodId: food.foodId, ...(date ? { date } : {}) } });
  }
  return <JournalPage><JournalBack />
    <FormHeading title="Chọn thực phẩm" date={date ? displayDate(date) : 'Hôm nay'} />
    <View style={f.block}><Text style={ui.label}>Tìm theo tên hoặc tên gọi khác</Text>
      <View style={[ui.inputBox, { marginTop: 0 }, focused && { borderColor: colors.primary, borderWidth: 2 }]}><FoodIcon name="search" />
        <TextInput accessibilityLabel="Tìm theo tên hoặc tên gọi khác" placeholder="Ví dụ: cơm, đậu hũ" placeholderTextColor={colors.muted}
          value={q} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onChangeText={setQ} autoCorrect={false} maxLength={150} returnKeyType="search" style={[ui.input, { outlineWidth: 0 }]} /></View>
    </View>
    <View style={f.block}><Text accessibilityRole="header" style={j.section}>Kết quả trong danh mục</Text>
      {(!shown || (!page && !shown.error)) && <LoadingFood />}
      {page && page.items.length === 0 && <Text accessibilityLiveRegion="polite" style={j.text}>{query
        ? 'Không tìm thấy thực phẩm phù hợp. Thử tên khác hoặc tên gọi địa phương.' : 'Danh mục hiện chưa có thực phẩm đã công bố.'}</Text>}
      {page?.items.map(food => <View key={food.foodId} style={j.card}>
        <Pressable accessibilityRole="button" accessibilityLabel={'Xem chi tiết ' + food.foodName + ', ' + food.foodSource + ', ' + food.foodState}
          onPress={() => open(food, '/foods/[foodId]')} style={f.stack}>
          <View style={f.inline}><FoodIcon name="utensils" /><Text style={[j.section, { flex: 1 }]}>{food.foodName}</Text></View>
          <Text style={j.strong}>{food.foodState || 'Chưa rõ trạng thái'} · {food.energyKcal === null
            ? 'Chưa có dữ liệu năng lượng' : nutrientText(food.energyKcal, 'kcal')} / {basisText(food)}</Text>
          <Text style={j.small}>{[food.foodSource, food.dataType, food.sourceFoodId || food.foodId].filter(Boolean).join(' · ')}</Text>
          <Text style={j.link}>Xem chi tiết</Text>
        </Pressable>
        <FoodLink label="Chọn khẩu phần" onPress={() => open(food, '/foods/portion')} />
      </View>)}
      {!!shown?.error && <FoodError message={shown.error} retry={() => {
        if (page?.nextCursor && !shown.reset) void request(generation.current, page.nextCursor);
        else setAttempt(n => n + 1);
      }} />}
      {!!page?.nextCursor && !shown?.error && (shown?.busy ? <LoadingFood />
        : <FoodLink label="Xem thêm thực phẩm" onPress={() => { void request(generation.current, page.nextCursor!); }} />)}
    </View></JournalPage>;
}

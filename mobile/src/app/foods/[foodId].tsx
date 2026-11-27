import { router, useLocalSearchParams } from 'expo-router';
import { Linking, Pressable, Text, View } from 'react-native';
import { useState } from 'react';
import { AccountButton, ErrorMessage } from '@/components/account-ui';
import { f, FoodError, LoadingFood, useFoodById } from '@/components/food-ui';
import { j, JournalBack, JournalPage } from '@/components/journal-ui';
import { basisText, numberText, nutrientLabels, nutrientText } from '@/utils/food';

export default function FoodDetail() {
  const { foodId, date } = useLocalSearchParams<{ foodId: string; date?: string }>();
  const { food, error, retry } = useFoodById(foodId);
  const [linkError, setLinkError] = useState(false);
  return <JournalPage footer={food && <AccountButton label="Chọn khẩu phần" onPress={() =>
    router.push({ pathname: '/foods/portion', params: { foodId, ...(date ? { date } : {}) } })} />}>
    <JournalBack />
    {error ? <FoodError message={error} retry={retry} /> : !food ? <LoadingFood /> : <>
      <View style={f.block}><Text style={j.eyebrow}>Chi tiết thực phẩm</Text>
        <Text accessibilityRole="header" style={j.heading}>{food.foodName}</Text><Text style={j.text}>{food.foodState || 'Chưa rõ trạng thái'}</Text></View>
      <View style={[j.card, f.block]}><Text accessibilityRole="header" style={j.section}>Dinh dưỡng theo {basisText(food)}</Text>
        {nutrientLabels.map(([key, label, unit]) => <View key={key} style={f.nutrientRow}>
          <Text style={j.text}>{label}</Text><Text style={j.strong}>{nutrientText(food[key], unit)}</Text></View>)}</View>
      <View style={[j.card, f.block]}><Text style={j.section}>Nguồn tham chiếu</Text>
        <Text style={j.text}>{[food.foodSource, food.dataType, food.sourceFoodId].filter(Boolean).join(' · ')}</Text>
        {!!food.sourceDescription && <Text style={j.text}>{food.sourceDescription}</Text>}
        {!!food.sourceVersion && <Text style={j.small}>{food.sourceVersion}</Text>}
        {!!food.retrievedAt && <Text style={j.small}>Ngày lấy dữ liệu (UTC) · {food.retrievedAt.slice(0, 10)}</Text>}
        {food.servingSize != null && <Text style={j.small}>Một phần · {food.servingLabel || 'Phần theo nguồn'} · {numberText(food.servingSize)} {food.servingUnit}</Text>}
        {food.densityGramsPerMl != null && <Text style={j.small}>Khối lượng riêng · {numberText(food.densityGramsPerMl)} g/mL{food.densitySourcePortionId ? ' · Mã phép đo ' + food.densitySourcePortionId : ''}</Text>}
        {!!food.sourceUrl && <Pressable accessibilityRole="link" onPress={() => {
          setLinkError(false); Linking.openURL(food.sourceUrl!).catch(() => setLinkError(true));
        }} style={j.linkRow}><Text style={j.link}>Mở nguồn gốc</Text></Pressable>}
        {linkError && <ErrorMessage message="Chưa mở được đường dẫn nguồn." />}
      </View></>}
  </JournalPage>;
}

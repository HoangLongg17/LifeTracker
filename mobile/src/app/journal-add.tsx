import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { FormHeading, j, JournalBack, JournalIcon, JournalPage } from '@/components/journal-ui';
import { dayKey, displayDate } from '@/utils/journal-time';

const choices = [
  { kind: 'water', route: '/water/new', title: 'Nước uống', detail: 'Nhập nhanh theo mL' },
  { kind: 'activity', route: '/activity', title: 'Vận động', detail: 'Loại hoạt động và số phút' },
  { kind: 'sleep', route: '/sleep', title: 'Giấc ngủ', detail: 'Giờ bắt đầu và thức dậy' },
] as const;

export default function AddJournal() {
  const { date } = useLocalSearchParams<{ date?: string }>();
  const day = dayKey(date ?? '');
  return <JournalPage><JournalBack /><FormHeading title="Thêm bản ghi" date={day ? displayDate(day) : 'Hôm nay'} />
    <View style={[j.card, { marginTop: 32, paddingVertical: 9 }]}>
      {choices.map((c, i) => <Pressable key={c.kind} onPress={() => router.push({ pathname: c.route, params: day ? { date: day } : {} })}
        accessibilityRole="button" style={[j.row, { minHeight: 60 }, i > 0 && j.hairline]}>
        <View style={[j.tile, c.kind === 'sleep' && { backgroundColor: '#EEEAF4' }]}><JournalIcon name={c.kind} /></View>
        <View style={{ flex: 1, gap: 2 }}><Text style={j.strong}>{c.title}</Text><Text style={j.small}>{c.detail}</Text></View>
        <JournalIcon name="chevron" size={15} /></Pressable>)}
    </View></JournalPage>;
}

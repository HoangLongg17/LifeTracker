import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import type { User } from 'firebase/auth';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { AccountButton, accountStyles, colors, ErrorMessage } from '@/components/account-ui';
import { j, JournalDialog, JournalHeader, JournalIcon, JournalPage } from '@/components/journal-ui';
import { useSession } from '@/hooks/use-session';
import type { MealJournalEntry } from '../../../../shared/food';
import { deleteMeal, getMealDay } from '@/services/foods';
import { dailyMealEnergyText, mealLabels, savedAmountText, savedNutrientText, wrapJournalNumbers } from '@/utils/food';
import { loadProfile } from '@/services/profile';
import { activities, deleteTimedEntry, getTimedDay, journalError, type Kind } from '@/services/timed-journal';
import { deleteWaterEntry, getWaterDay, type WaterDayResponse } from '@/services/waterApi';
import { deleteWeight, formatWeight, getWeightHistory, type WeightEntry } from '@/services/weights';
import { dayKey, displayDate, durationText, shiftDay, wallTime } from '@/utils/journal-time';

type Row = ({ kind: 'meal'; meal: MealJournalEntry } | { kind: 'weight'; weight: WeightEntry } | { kind: Kind | 'water' }) & { id: string; version: number; title: string; detail: string; stamp: string; zone: string; overlap?: string };
type Data = { date: string; today: string; water: WaterDayResponse; mealReadFailed: boolean; weightReadFailed: boolean; energy: string; rows: Row[]; activity: number | null; sleep: number | null };
type Params = { date?: string; notice?: string; savedTime?: string; savedAmount?: string; edited?: string };

function Journal({ user }: { user: User }) {
  const params = useLocalSearchParams<Params>();
  const requested = dayKey(params.date ?? '');
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const latestRead = useRef(0);
  const [dialog, setDialog] = useState<'actions' | 'delete' | 'date' | null>(null);
  const [selected, setSelected] = useState<Row | null>(null);
  const [dateInput, setDateInput] = useState('');
  const [actionError, setActionError] = useState('');
  const [removing, setRemoving] = useState(false);
  const deleting = useRef(false);

  useFocusEffect(useCallback(() => {
    let active = true;
    latestRead.current = revision;
    setError(''); setData(null);
    async function refresh() {
      const profile = await loadProfile(user);
      const today = dayKey(wallTime(Date.now(), profile.timeZone).date)!;
      const date = requested ?? today;
      const [water, activity, sleep, meals, weightPage] = await Promise.all([
        getWaterDay(date, user), getTimedDay(user, 'activity', date), getTimedDay(user, 'sleep', date),
        getMealDay(user, date).catch(() => null),
        getWeightHistory(user, { date, limit: 100 }).catch(() => null),
      ]);
      const rows: Row[] = [
        ...(meals ?? []).map(meal => {
          const first = meal.items[0];
          const name = first?.foodName ?? 'Bữa ăn';
          const description = meal.items.length > 1 ? meal.items.length + ' món' : first && savedAmountText(first);
          return { kind: 'meal' as const, meal, id: meal.entryId, version: meal.version,
            title: mealLabels[meal.mealType] + ' · ' + name + (meal.items.length > 1 ? '…' : ''),
            detail: [description, savedNutrientText(meal, 'energyKcal', 'kcal')].filter(Boolean).join(' · '),
            stamp: meal.loggedAt, zone: meal.timeZone };
        }),
        ...(weightPage?.items ?? []).map(weight => ({
          kind: 'weight' as const, weight, id: weight.entryId, version: weight.version,
          title: 'Cân nặng · ' + formatWeight(weight.weightKg, profile.preferredUnits.weight),
          detail: 'Tự ghi nhận', stamp: weight.measuredAt, zone: weight.timeZone,
        })),
        ...water.items.map(w => ({ kind: 'water' as const, id: w.entryId, version: w.version, title: 'Nước · ' + w.volumeMl.toLocaleString('vi-VN') + ' mL',
          detail: w.note || 'Đã lưu', stamp: w.loggedAt, zone: w.timeZone })),
        ...activity.items.map(a => ({ kind: 'activity' as const, id: a.entryId, version: a.version, title: activities[a.activityType] + ' · ' + durationText(a.durationMinutes),
          detail: 'Thời lượng tự ghi nhận', stamp: a.startedAt, zone: a.timeZone,
          overlap: a.crossTypeOverlap ? 'Trùng giờ với giấc ngủ' : a.overlapStatus === 'needs_review' ? 'Trùng giờ · cần xem lại' : undefined })),
        ...sleep.items.map(s => ({ kind: 'sleep' as const, id: s.entryId, version: s.version, title: 'Phiên ngủ · ' + durationText(s.sessionMinutes),
          detail: wallTime(s.sleepStart, s.timeZone).time + ' – ' + wallTime(s.sleepEnd, s.timeZone).time,
          stamp: s.sleepEnd, zone: s.timeZone,
          overlap: s.crossTypeOverlap ? 'Trùng giờ với vận động' : s.overlapStatus === 'needs_review' ? 'Trùng giờ · cần xem lại' : undefined })),
      ];
      rows.sort((a, b) => Date.parse(b.stamp) - Date.parse(a.stamp) || a.id.localeCompare(b.id));
      if (active && latestRead.current === revision) setData({
        date, today, water, rows, mealReadFailed: meals === null, weightReadFailed: weightPage === null,
        energy: dailyMealEnergyText(meals), activity: activity.totalMinutes, sleep: sleep.totalMinutes,
      });
    }
    refresh().catch(cause => { if (active) setError(journalError(cause)); });
    return () => { active = false; };
  }, [user, requested, revision]));

  const date = data?.date ?? requested;
  const notice = params.notice || (params.savedAmount && params.savedTime ? 'Đã lưu ' + params.savedAmount + ' mL nước lúc ' + params.savedTime + '.' : params.edited === '1' ? 'Đã cập nhật bản ghi nước.' : '');
  const refresh = () => setRevision(n => n + 1);
  function selectDate(value: string) {
    if (!dayKey(value) || (data && value > data.today)) { setActionError('Chọn một ngày đã qua hoặc hôm nay.'); return; }
    setDialog(null); setActionError('');
    router.setParams({ date: value, notice: '', edited: '', savedAmount: '', savedTime: '' });
  }
  function edit(row: Row) {
    setDialog(null);
    if (row.kind === 'meal') { router.push({ pathname: '/foods/portion', params: { editId: row.id } }); return; }
    if (row.kind === 'weight') {
      router.push({ pathname: '/weight-entry', params: { date: date!, editId: row.id, returnTo: 'journal' } });
      return;
    }
    router.push({ pathname: row.kind === 'water' ? '/water/new' : row.kind === 'activity' ? '/activity' : '/sleep', params: { date: date!, editId: row.id } });
  }
  async function remove() {
    if (!selected || deleting.current) return;
    deleting.current = true; setRemoving(true); setActionError('');
    try {
      if (selected.kind === 'meal') await deleteMeal(user, selected.id, selected.version);
      else if (selected.kind === 'water') await deleteWaterEntry(user, selected.id, selected.version);
      else if (selected.kind === 'weight') await deleteWeight(user, selected.id, selected.version);
      else await deleteTimedEntry(user, selected.kind, selected.id, selected.version);
      setDialog(null); router.setParams({ notice: 'Đã xóa bản ghi.', savedTime: '', savedAmount: '', edited: '' }); refresh();
    } catch (cause) { setActionError(journalError(cause)); }
    finally { deleting.current = false; setRemoving(false); }
  }
  const add = () => router.push({ pathname: '/journal-add', params: date ? { date } : {} });
  const dayTitle = date && new Intl.DateTimeFormat('vi-VN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(date + 'T12:00:00Z'));
  return <JournalPage tab><JournalHeader />
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 34 }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Chọn ngày nhật ký" disabled={!data} onPress={() => {
        setActionError(''); setDateInput(displayDate(data!.date)); setDialog('date');
      }}><Text style={j.eyebrow}>{dayTitle || 'Hôm nay'}</Text></Pressable>
      {data && <View style={{ flexDirection: 'row' }}>
        {([-1, 1] as const).map(delta => <Pressable key={delta} accessibilityRole="button" accessibilityLabel={delta < 0 ? 'Ngày trước' : 'Ngày sau'}
          disabled={delta > 0 && data.date >= data.today} onPress={() => selectDate(shiftDay(data.date, delta))}
          style={{ width: 38, height: 36, alignItems: 'center', justifyContent: 'center', opacity: delta > 0 && data.date >= data.today ? 0.28 : 1 }}>
          <View style={{ transform: [{ rotate: delta < 0 ? '180deg' : '0deg' }] }}><JournalIcon name="chevron" size={15} /></View></Pressable>)}
      </View>}
    </View>
    <Text accessibilityRole="header" style={[j.heading, { fontSize: 32, lineHeight: 44, marginTop: 0 }]}>Nhật ký</Text>
    {!!error && <View style={{ gap: 12, marginTop: 18 }}><ErrorMessage message={error} /><AccountButton outline label="Thử lại" onPress={refresh} /></View>}
    {!data && !error && <ActivityIndicator style={{ marginTop: 24 }} color={colors.primary} accessibilityLabel="Đang tải nhật ký" />}
    {data && <>
      {notice ? <View style={[j.card, { marginTop: 10, backgroundColor: colors.pale }]}><Text accessibilityLiveRegion="polite" style={j.strong}>{notice}</Text></View> :
      <View style={[j.card, { marginTop: 10, minHeight: 125, justifyContent: 'space-between' }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><JournalIcon name="water" size={17} /><Text style={j.strong}>Nước đã ghi {date === data.today ? 'hôm nay' : 'trong ngày'}</Text></View>
        <Text style={[j.heading, { marginTop: 2, fontSize: 24 }]}>{data.water.totalWaterMl === null ? 'Chưa có dữ liệu' : data.water.totalWaterMl.toLocaleString('vi-VN') + ' mL'}</Text>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={j.small}>{data.water.recordStatus === 'confirmed' ? 'Đã xác nhận' : data.water.recordStatus === 'partial' ? 'Đã ghi một phần' : 'Chưa ghi nước'}</Text>
          <Pressable accessibilityRole="button" hitSlop={6} onPress={() => router.push({ pathname: '/water/new', params: { date: data.date } })}
            style={{ backgroundColor: colors.pale, borderRadius: 10, paddingVertical: 6, paddingHorizontal: 12 }}><Text style={j.link}>+ Ghi nước</Text></Pressable>
        </View>
      </View>}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18, minHeight: 42 }}>
        <Text style={j.section}>Các bản ghi</Text>
        {!notice && <Pressable accessibilityRole="button" style={j.linkRow} onPress={add}><Text style={j.link}>+ Thêm bản ghi</Text></Pressable>}
      </View>
      <View style={[j.card, { paddingVertical: 7 }]}>
        {data.rows.length ? data.rows.map((row, i) => <Pressable key={row.kind + row.id} accessibilityRole="button" onPress={() => {
          setSelected(row); setActionError(''); setDialog('actions');
        }} style={[j.row, { minHeight: 52 }, i > 0 && j.hairline]}>
          <View style={[j.tile, { width: 34, height: 34 }, row.kind === 'sleep' && { backgroundColor: '#EEEAF4' }]}>
            <JournalIcon name={row.kind === 'weight' ? 'scale' : row.kind} />
          </View>
          <View style={[{ flex: 1 }, row.kind === 'meal' && { minWidth: 0, flexShrink: 1 }]}><Text style={j.strong}>{row.title}</Text>
            {row.kind === 'meal' ? <Text style={j.small} accessibilityLabel={row.detail}>{wrapJournalNumbers(row.detail)}</Text> : <Text style={j.small}>{row.detail}</Text>}
            {row.overlap && <Text style={[j.small, { color: '#865619' }]}>{row.overlap}</Text>}</View>
          <Text style={j.small}>{wallTime(row.stamp, row.zone).time}</Text>
        </Pressable>) : <Text style={[j.small, { paddingVertical: 14 }]}>{data.mealReadFailed ? 'Đang thiếu dữ liệu bữa ăn.' : 'Chưa có bản ghi trong ngày này.'}</Text>}
      </View>
      {data.mealReadFailed && <View style={{ gap: 8, marginTop: 12 }}>
        <ErrorMessage message="Chưa tải được bữa ăn cho ngày này." /><AccountButton outline label="Tải lại nhật ký" onPress={refresh} />
      </View>}
      {data.weightReadFailed && <View style={{ gap: 8, marginTop: 12 }}>
        <ErrorMessage message="Chưa tải được bản ghi cân nặng cho ngày này." /><AccountButton outline label="Tải lại nhật ký" onPress={refresh} />
      </View>}
      <View style={{ gap: 4, marginTop: 14 }}>
        {data.activity !== null && <Text style={j.small}>Vận động trong ngày · {durationText(data.activity)}</Text>}
        {data.sleep !== null && <Text style={j.small}>Tổng thời lượng phiên ngủ · {durationText(data.sleep)}</Text>}
        <Text style={j.small} accessibilityLabel={'Năng lượng trong ngày · ' + data.energy}>Năng lượng trong ngày · {wrapJournalNumbers(data.energy)}</Text>
      </View>
      {!!notice && <View style={{ marginTop: 20 }}><AccountButton outline label="Thêm bản ghi khác" onPress={add} /></View>}
    </>}
    {dialog && <JournalDialog title={dialog === 'date' ? 'Chọn ngày nhật ký' : dialog === 'delete' ? 'Xóa bản ghi này?' : selected?.title ?? 'Bản ghi'}
      onClose={() => { if (!removing) setDialog(null); }}>
      {dialog === 'date' ? <><Text style={j.small}>Ngày / tháng / năm</Text><View style={accountStyles.inputBox}>
        <TextInput accessibilityLabel="Ngày nhật ký" style={accountStyles.input} value={dateInput} onChangeText={setDateInput} placeholder="DD/MM/YYYY" /></View>
        <AccountButton label="Xem nhật ký" onPress={() => selectDate(dayKey(dateInput) ?? '')} /></> :
       dialog === 'actions' && selected ? <><AccountButton label="Chỉnh sửa" onPress={() => edit(selected)} />
        <AccountButton outline label="Xóa bản ghi" onPress={() => setDialog('delete')} /></> :
        <><Text style={j.text}>{selected?.title}</Text><AccountButton label="Xác nhận xóa" busy={removing} onPress={remove} /></>}
      {!!actionError && <ErrorMessage message={actionError} />}
      <AccountButton outline label={actionError && dialog !== 'date' ? 'Tải lại nhật ký' : 'Đóng'} disabled={removing}
        onPress={() => { setDialog(null); if (actionError) refresh(); }} />
    </JournalDialog>}
  </JournalPage>;
}
export default function JournalTab() {
  const { session } = useSession();
  return session.status === 'active' ? <Journal key={session.user.uid} user={session.user} /> : null;
}

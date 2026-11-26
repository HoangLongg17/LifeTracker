import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import type { User } from 'firebase/auth';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { AccountButton, colors, ErrorMessage } from '@/components/account-ui';
import { j, JournalBack, JournalDialog, JournalHeader, JournalPage } from '@/components/journal-ui';
import { useSession } from '@/hooks/use-session';
import { loadProfile, type PersonalProfile } from '@/services/profile';
import { AccountRequestError } from '@/services/session';
import { deleteWeight, getWeightHistory, type WeightEntry } from '@/services/weights';
import { displayDate, wallTime } from '@/utils/journal-time';

type Params = { notice?: string };

function requestMessage(error: unknown) {
  if (error instanceof AccountRequestError) {
    if (error.code === 'VERSION_CONFLICT') return 'Bản ghi đã thay đổi ở nơi khác. Tải lại lịch sử trước khi thử lại.';
    if (error.status === 401) return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
    if (error.status === 403) return 'Bạn không có quyền truy cập lịch sử cân nặng này.';
    if (error.status >= 500) return 'Máy chủ chưa thể hoàn tất thao tác. Vui lòng thử lại.';
  }
  return 'Không thể tải hoặc cập nhật lịch sử cân nặng. Vui lòng thử lại.';
}

function shownWeight(weightKg: number, profile: PersonalProfile) {
  const value = profile.preferredUnits.weight === 'lb' ? weightKg * 2.2046226218 : weightKg;
  return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(value)} ${profile.preferredUnits.weight}`;
}

function History({ user }: { user: User }) {
  const params = useLocalSearchParams<Params>();
  const [profile, setProfile] = useState<PersonalProfile | null>(null);
  const [items, setItems] = useState<WeightEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<WeightEntry | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [nextProfile, page] = await Promise.all([loadProfile(user), getWeightHistory(user)]);
      setProfile(nextProfile);
      setItems(page.items);
      setNextCursor(page.nextCursor);
    } catch (cause) {
      setError(requestMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useFocusEffect(useCallback(() => {
    void refresh();
  }, [refresh]));

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError('');
    try {
      const page = await getWeightHistory(user, { cursor: nextCursor });
      setItems(current => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (cause) {
      setError(requestMessage(cause));
    } finally {
      setLoadingMore(false);
    }
  }

  async function remove() {
    if (!selected || deleting) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await deleteWeight(user, selected.entryId, selected.version);
      setSelected(null);
      await refresh();
    } catch (cause) {
      setDeleteError(requestMessage(cause));
    } finally {
      setDeleting(false);
    }
  }

  return <JournalPage tab>
    <JournalHeader />
    <JournalBack />
    <Text style={j.eyebrow}>HỒ SƠ CỦA BẠN</Text>
    <Text accessibilityRole="header" style={j.heading}>Lịch sử cân nặng</Text>
    <Text style={[j.small, { marginTop: 4 }]}>Theo dõi các lần đo theo thời gian.</Text>
    {!!params.notice && <View style={[j.card, { marginTop: 14, backgroundColor: colors.pale }]}>
      <Text accessibilityLiveRegion="polite" style={j.strong}>{params.notice}</Text>
    </View>}
    {profile && <View style={[j.card, { marginTop: 18, minHeight: 112, justifyContent: 'space-between' }]}>
      <Text style={j.small}>Cân nặng hiện tại</Text>
      <Text style={[j.heading, { marginTop: 0, fontSize: 28, lineHeight: 36 }]}>
        {profile.currentWeightKg === null ? 'Chưa có số đo' : shownWeight(profile.currentWeightKg, profile)}
      </Text>
      <Text style={j.small}>Lấy từ lần đo hợp lệ mới nhất</Text>
    </View>}
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 22, minHeight: 42 }}>
      <Text style={j.section}>Các lần đo</Text>
      <Pressable accessibilityRole="button" onPress={() => router.push('/weight-entry')} style={j.linkRow}>
        <Text style={j.link}>+ Thêm lần đo</Text>
      </Pressable>
    </View>
    {loading ? <ActivityIndicator style={{ marginTop: 20 }} color={colors.primary} accessibilityLabel="Đang tải lịch sử cân nặng" /> :
      error && items.length === 0 ? <View style={{ gap: 12, marginTop: 8 }}>
        <ErrorMessage message={error} />
        <AccountButton outline label="Thử lại" onPress={() => void refresh()} />
      </View> :
      <View style={[j.card, { paddingVertical: 6 }]}>
        {items.length === 0 ? <Text style={[j.small, { paddingVertical: 14 }]}>Chưa có lần đo nào. Hãy thêm số đo đầu tiên.</Text> :
          items.map((item, index) => {
            const time = wallTime(item.measuredAt, item.timeZone).time;
            return <Pressable key={item.entryId} accessibilityRole="button"
              accessibilityLabel={`${shownWeight(item.weightKg, profile!)} lúc ${time}, ${displayDate(item.localDate)}`}
              onPress={() => { setSelected(item); setDeleteError(''); }}
              style={[j.row, { minHeight: 68 }, index > 0 && j.hairline]}>
              <View style={j.tile}><Text style={j.strong}>{profile!.preferredUnits.weight}</Text></View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={j.strong}>{shownWeight(item.weightKg, profile!)}</Text>
                <Text style={j.small}>{displayDate(item.localDate)} · {time}</Text>
              </View>
              <Text style={j.small}>Sửa</Text>
            </Pressable>;
          })}
      </View>}
    {!!error && items.length > 0 && <View style={{ gap: 8, marginTop: 12 }}>
      <ErrorMessage message={error} />
      <AccountButton outline label="Thử lại" onPress={() => void refresh()} />
    </View>}
    {!!nextCursor && !loading && <View style={{ marginTop: 14 }}>
      <AccountButton outline label="Tải thêm" busy={loadingMore} onPress={() => void loadMore()} />
    </View>}
    {selected && <JournalDialog title={shownWeight(selected.weightKg, profile!)}
      onClose={() => { if (!deleting) setSelected(null); }}>
      <Text style={j.text}>{displayDate(selected.localDate)} · {wallTime(selected.measuredAt, selected.timeZone).time}</Text>
      <AccountButton label="Chỉnh sửa" disabled={deleting}
        onPress={() => {
          const editId = selected.entryId;
          setSelected(null);
          router.push({ pathname: '/weight-entry', params: { editId } });
        }} />
      <AccountButton outline label="Xóa lần đo" disabled={deleting} onPress={() => setDeleteError('Xác nhận xóa?')} />
      {deleteError === 'Xác nhận xóa?' ? <>
        <Text style={j.small}>Xóa bản ghi này? Cân nặng hiện tại sẽ được tính lại từ lần đo mới nhất còn lại.</Text>
        <AccountButton label="Xác nhận xóa" busy={deleting} onPress={() => void remove()} />
      </> : !!deleteError && <ErrorMessage message={deleteError} />}
      <AccountButton outline label="Đóng" disabled={deleting} onPress={() => setSelected(null)} />
    </JournalDialog>}
  </JournalPage>;
}

export default function WeightHistoryScreen() {
  const { session } = useSession();
  return session.status === 'active' ? <History key={session.user.uid} user={session.user} /> : null;
}
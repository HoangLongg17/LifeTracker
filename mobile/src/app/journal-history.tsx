import { router, useFocusEffect } from 'expo-router';
import type { User } from 'firebase/auth';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  AccountButton,
  accountStyles as ui,
  colors,
  ErrorMessage,
} from '@/components/account-ui';
import {
  j,
  JournalBack,
  JournalHeader,
  JournalIcon,
  JournalPage,
} from '@/components/journal-ui';
import { useSession } from '@/hooks/use-session';
import {
  getLogHistory,
  type DayRecordStatusResponse,
  type HistoryEntryItem,
  type HistoryKind,
} from '@/services/day-status';
import { loadProfile } from '@/services/profile';
import { activities, journalError, type ActivityType } from '@/services/timed-journal';
import { formatWeight } from '@/services/weights';
import type { MealType } from '../../../shared/food';
import { mealLabels } from '@/utils/food';
import {
  dayKey,
  displayDate,
  durationText,
  shiftDay,
  wallTime,
} from '@/utils/journal-time';

type FilterKind = HistoryKind | 'all';

const TYPE_OPTIONS: Array<{ key: FilterKind; label: string }> = [
  { key: 'all', label: 'Tất cả' },
  { key: 'water', label: 'Nước' },
  { key: 'meal', label: 'Ăn uống' },
  { key: 'activity', label: 'Vận động' },
  { key: 'sleep', label: 'Giấc ngủ' },
  { key: 'weight', label: 'Cân nặng' },
];

function summarizeDayStatus(status?: DayRecordStatusResponse) {
  if (!status) return { label: 'Chưa rõ trạng thái', tone: 'neutral' as const };
  const list = Object.values(status.categories);
  const confirmedCount = list.filter((c) => c.status === 'confirmed').length;
  const hasAnyData = list.some((c) => c.status !== 'missing');

  if (confirmedCount === list.length) {
    return { label: 'Đã xác nhận đủ 4/4 nhóm', tone: 'confirmed' as const };
  }
  if (confirmedCount > 0 || hasAnyData) {
    return {
      label: `Đã xác nhận ${confirmedCount}/4 nhóm`,
      tone: 'partial' as const,
    };
  }
  return { label: 'Thiếu dữ liệu', tone: 'missing' as const };
}

function formatHistoryRow(
  item: HistoryEntryItem,
  weightUnit: 'kg' | 'lb'
): { title: string; detail: string } {
  const s = item.summary;
  if (item.kind === 'water') {
    const vol = typeof s.volumeMl === 'number' ? s.volumeMl : 0;
    const note = typeof s.note === 'string' && s.note ? s.note : 'Đã lưu';
    return {
      title: `Nước · ${vol.toLocaleString('vi-VN')} mL`,
      detail: note,
    };
  }
  if (item.kind === 'meal') {
    const mType = (s.mealType as MealType) || 'snack';
    const items = Array.isArray(s.items)
      ? (s.items as Array<{ foodName?: string }>)
      : [];
    const totals = (s.totals as { energyKcal?: number | null } | undefined) ?? {};
    const firstName = items[0]?.foodName ?? 'Bữa ăn';
    const kcal =
      typeof totals.energyKcal === 'number'
        ? `${Math.round(totals.energyKcal).toLocaleString('vi-VN')} kcal`
        : 'Chưa rõ năng lượng';
    return {
      title: `${mealLabels[mType] ?? 'Bữa ăn'} · ${firstName}${items.length > 1 ? '…' : ''}`,
      detail: items.length > 1 ? `${items.length} món · ${kcal}` : kcal,
    };
  }
  if (item.kind === 'activity') {
    const aType = (s.activityType as ActivityType) || 'walking';
    const mins = typeof s.durationMinutes === 'number' ? s.durationMinutes : 0;
    return {
      title: `${activities[aType] ?? 'Vận động'} · ${durationText(mins)}`,
      detail: 'Thời lượng tự ghi nhận',
    };
  }
  if (item.kind === 'sleep') {
    const mins = typeof s.sessionMinutes === 'number' ? s.sessionMinutes : 0;
    const start = typeof s.sleepStart === 'string' ? s.sleepStart : null;
    const end = typeof s.sleepEnd === 'string' ? s.sleepEnd : null;
    const range =
      start && end
        ? `${wallTime(start, item.timeZone).time} – ${wallTime(end, item.timeZone).time}`
        : 'Phiên ngủ đã ghi';
    return {
      title: `Phiên ngủ · ${durationText(mins)}`,
      detail: range,
    };
  }
  const weightKg = typeof s.weightKg === 'number' ? s.weightKg : 0;
  return {
    title: `Cân nặng · ${formatWeight(weightKg, weightUnit)}`,
    detail: 'Tự ghi nhận',
  };
}

function HistoryContent({ user }: { user: User }) {
  const [selectedType, setSelectedType] = useState<FilterKind>('all');
  const [fromInput, setFromInput] = useState('');
  const [toInput, setToInput] = useState('');
  const [appliedFrom, setAppliedFrom] = useState<string | undefined>(undefined);
  const [appliedTo, setAppliedTo] = useState<string | undefined>(undefined);
  const [filterError, setFilterError] = useState('');

  const [today, setToday] = useState<string | null>(null);
  const [weightUnit, setWeightUnit] = useState<'kg' | 'lb'>('kg');
  const [items, setItems] = useState<HistoryEntryItem[]>([]);
  const [dayStatuses, setDayStatuses] = useState<
    Record<string, DayRecordStatusResponse>
  >({});
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    loadProfile(user)
      .then((profile) => {
        if (!active) return;
        const currentToday = dayKey(wallTime(Date.now(), profile.timeZone).date)!;
        setToday(currentToday);
        setWeightUnit(profile.preferredUnits.weight);
      })
      .catch(() => {
        if (active) {
          setToday(dayKey(wallTime(Date.now(), 'Asia/Ho_Chi_Minh').date)!);
        }
      });
    return () => {
      active = false;
    };
  }, [user]);

  const fetchFirstPage = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await getLogHistory(user, {
        type: selectedType,
        from: appliedFrom,
        to: appliedTo,
        limit: 20,
      });
      setItems(res.items);
      setDayStatuses(res.dayStatuses);
      setNextCursor(res.nextCursor);
    } catch (cause) {
      setError(journalError(cause));
    } finally {
      setLoading(false);
    }
  }, [user, selectedType, appliedFrom, appliedTo]);

  useFocusEffect(
    useCallback(() => {
      void fetchFirstPage();
    }, [fetchFirstPage])
  );

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await getLogHistory(user, {
        type: selectedType,
        from: appliedFrom,
        to: appliedTo,
        limit: 20,
        cursor: nextCursor,
      });
      setItems((prev) => {
        const seen = new Set(prev.map((row) => `${row.kind}:${row.entryId}`));
        const appended = res.items.filter(
          (row) => !seen.has(`${row.kind}:${row.entryId}`)
        );
        return [...prev, ...appended];
      });
      setDayStatuses((prev) => ({ ...prev, ...res.dayStatuses }));
      setNextCursor(res.nextCursor);
    } catch (cause) {
      setError(journalError(cause));
    } finally {
      setLoadingMore(false);
    }
  }

  function applyCustomRange() {
    setFilterError('');
    const parsedFrom = fromInput.trim() ? dayKey(fromInput.trim()) : undefined;
    const parsedTo = toInput.trim() ? dayKey(toInput.trim()) : undefined;

    if (fromInput.trim() && !parsedFrom) {
      setFilterError('Từ ngày không hợp lệ. Nhập theo dạng DD/MM/YYYY.');
      return;
    }
    if (toInput.trim() && !parsedTo) {
      setFilterError('Đến ngày không hợp lệ. Nhập theo dạng DD/MM/YYYY.');
      return;
    }
    if (parsedFrom && parsedTo && parsedFrom > parsedTo) {
      setFilterError('Từ ngày không được sau Đến ngày.');
      return;
    }
    setAppliedFrom(parsedFrom ?? undefined);
    setAppliedTo(parsedTo ?? undefined);
  }

  function applyPreset(days: number | null) {
    setFilterError('');
    if (days === null || !today) {
      setFromInput('');
      setToInput('');
      setAppliedFrom(undefined);
      setAppliedTo(undefined);
      return;
    }
    const start = shiftDay(today, -(days - 1));
    setFromInput(displayDate(start));
    setToInput(displayDate(today));
    setAppliedFrom(start);
    setAppliedTo(today);
  }

  const groupedDays = useMemo(() => {
    const groups: Array<{ date: string; rows: HistoryEntryItem[] }> = [];
    for (const row of items) {
      const last = groups[groups.length - 1];
      if (last && last.date === row.localDate) {
        last.rows.push(row);
      } else {
        groups.push({ date: row.localDate, rows: [row] });
      }
    }
    return groups;
  }, [items]);

  return (
    <JournalPage>
      <JournalHeader />
      <JournalBack />

      <Text style={[j.eyebrow, { marginTop: 10 }]}>Nhật ký sinh hoạt</Text>
      <Text accessibilityRole="header" style={[j.heading, { marginTop: 2 }]}>
        Lịch sử nhật ký
      </Text>

      {/* BỘ LỌC LOẠI NHẬT KÝ */}
      <View style={st.chipRow}>
     {TYPE_OPTIONS.map((opt) => {
       const active = selectedType === opt.key;
       return (
         <Pressable
           key={opt.key}
           accessibilityRole="button"
           onPress={() => setSelectedType(opt.key)}
           style={[st.chip, active && st.chipActive]}
         >
           <Text style={[st.chipText, active && st.chipTextActive]}>
             {opt.label}
           </Text>
         </Pressable>
       );
     })}
   </View>

      {/* BỘ LỌC KHOẢNG NGÀY */}
      <View style={[j.card, { marginTop: 14, gap: 10 }]}>
        <Text style={j.strong}>Khoảng thời gian</Text>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Pressable
            accessibilityRole="button"
            onPress={() => applyPreset(7)}
            style={st.presetBtn}
          >
            <Text style={j.small}>7 ngày qua</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => applyPreset(30)}
            style={st.presetBtn}
          >
            <Text style={j.small}>30 ngày qua</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => applyPreset(null)}
            style={st.presetBtn}
          >
            <Text style={j.small}>Tất cả</Text>
          </Pressable>
        </View>

        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Text style={j.small}>Từ ngày</Text>
            <View style={[ui.inputBox, { marginTop: 4, minHeight: 44 }]}>
              <TextInput
                accessibilityLabel="Từ ngày"
                value={fromInput}
                onChangeText={setFromInput}
                placeholder="DD/MM/YYYY"
                placeholderTextColor={colors.muted}
                maxLength={10}
                style={ui.input}
              />
            </View>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={j.small}>Đến ngày</Text>
            <View style={[ui.inputBox, { marginTop: 4, minHeight: 44 }]}>
              <TextInput
                accessibilityLabel="Đến ngày"
                value={toInput}
                onChangeText={setToInput}
                placeholder="DD/MM/YYYY"
                placeholderTextColor={colors.muted}
                maxLength={10}
                style={ui.input}
              />
            </View>
          </View>
        </View>

        {!!filterError && <ErrorMessage message={filterError} />}
        <AccountButton
          outline
          label="Áp dụng khoảng ngày"
          onPress={applyCustomRange}
        />
      </View>

      {/* DANH SÁCH LỊCH SỬ */}
      {loading && (
        <ActivityIndicator
          style={{ marginTop: 28 }}
          color={colors.primary}
          accessibilityLabel="Đang tải lịch sử nhật ký"
        />
      )}

      {!loading && !!error && (
        <View style={{ gap: 12, marginTop: 18 }}>
          <ErrorMessage message={error} />
          <AccountButton outline label="Thử lại" onPress={() => void fetchFirstPage()} />
        </View>
      )}

      {!loading && !error && groupedDays.length === 0 && (
        <View style={[j.card, { marginTop: 18, gap: 6 }]}>
          <Text style={j.strong}>Không có bản ghi phù hợp</Text>
          <Text style={j.small}>
            Thử đổi loại nhật ký hoặc mở rộng khoảng ngày để xem thêm dữ liệu.
          </Text>
        </View>
      )}

      {!loading &&
        !error &&
        groupedDays.map((group) => {
          const dayLabel = new Intl.DateTimeFormat('vi-VN', {
            weekday: 'long',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            timeZone: 'UTC',
          }).format(new Date(`${group.date}T12:00:00Z`));
          const badge = summarizeDayStatus(dayStatuses[group.date]);

          return (
            <View key={group.date} style={{ marginTop: 18 }}>
              <View style={st.dayHeader}>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={j.section}>{dayLabel}</Text>
                  <View
                    style={[
                      st.badge,
                      badge.tone === 'confirmed'
                        ? st.badgeConfirmed
                        : badge.tone === 'partial'
                          ? st.badgePartial
                          : st.badgeMissing,
                    ]}
                  >
                    <Text
                      style={[
                        st.badgeText,
                        badge.tone === 'confirmed'
                          ? st.badgeTextConfirmed
                          : badge.tone === 'partial'
                            ? st.badgeTextPartial
                            : st.badgeTextMissing,
                      ]}
                    >
                      {badge.label}
                    </Text>
                  </View>
                </View>

                <Pressable
                  accessibilityRole="button"
                  onPress={() =>
                    router.push({
                      pathname: '/journal',
                      params: { date: group.date },
                    })
                  }
                  style={j.linkRow}
                >
                  <Text style={j.link}>Chi tiết ngày</Text>
                </Pressable>
              </View>

              <View style={[j.card, { paddingVertical: 6, marginTop: 8 }]}>
                {group.rows.map((row, idx) => {
                  const formatted = formatHistoryRow(row, weightUnit);
                  return (
                    <Pressable
                      key={`${row.kind}:${row.entryId}`}
                      accessibilityRole="button"
                      onPress={() =>
                        router.push({
                          pathname: '/journal',
                          params: { date: row.localDate },
                        })
                      }
                      style={[j.row, { minHeight: 52 }, idx > 0 && j.hairline]}
                    >
                      <View
                        style={[
                          j.tile,
                          { width: 34, height: 34 },
                          row.kind === 'sleep' && { backgroundColor: '#EEEAF4' },
                        ]}
                      >
                        <JournalIcon
                          name={row.kind === 'weight' ? 'scale' : row.kind}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={j.strong}>{formatted.title}</Text>
                        <Text style={j.small}>{formatted.detail}</Text>
                      </View>
                      <Text style={j.small}>
                        {wallTime(row.occurredAt, row.timeZone).time}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          );
        })}

      {!loading && !error && !!nextCursor && (
        <View style={{ marginTop: 18 }}>
          <AccountButton
            outline
            busy={loadingMore}
            label="Tải thêm nhật ký"
            onPress={() => void loadMore()}
          />
        </View>
      )}
    </JournalPage>
  );
}

export default function JournalHistoryScreen() {
  const { session } = useSession();
  return session.status === 'active' ? (
    <HistoryContent key={session.user.uid} user={session.user} />
  ) : null;
}

const st = StyleSheet.create({
  chipRow: {
flexDirection: 'row',
flexWrap: 'wrap',
gap: 8,
marginTop: 14,
},
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.paper,
  },
  chipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: {
    fontFamily: 'Roboto_400Regular',
    fontSize: 13,
    color: colors.ink,
  },
  chipTextActive: {
    fontFamily: 'Roboto_700Bold',
    color: '#FFFFFF',
  },
  presetBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: colors.pale,
  },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
  },
  badgeConfirmed: {
    backgroundColor: colors.pale,
  },
  badgePartial: {
    backgroundColor: '#F7EEDB',
  },
  badgeMissing: {
    backgroundColor: '#EFECE6',
  },
  badgeText: {
    fontFamily: 'Roboto_700Bold',
    fontSize: 11,
  },
  badgeTextConfirmed: {
    color: colors.primary,
  },
  badgeTextPartial: {
    color: '#865619',
  },
  badgeTextMissing: {
    color: colors.muted,
  },
});
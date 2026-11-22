import { AccountBrand } from '@/components/account-ui';
import { Ionicons } from '@expo/vector-icons';
import {
  useFocusEffect,
  useLocalSearchParams,
  useRouter,
} from 'expo-router';
import type { User } from 'firebase/auth';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useSession } from '@/hooks/use-session';
import { useWaterDay } from '@/hooks/use-water-day';
import { deleteWaterEntry } from '@/services/waterApi';

const C = {
  bg: '#F8F8F0',
  text: '#182D26',
  muted: '#506059',
  green: '#164D3F',
  pale: '#E6EDDB',
  white: '#FFFFFF',
  border: '#D8DFD4',
  red: '#B43E34',
};

const TZ = 'Asia/Ho_Chi_Minh';

const ml = (n: number) =>
  new Intl.NumberFormat('vi-VN', {
    maximumFractionDigits: 2,
  }).format(n);

const dateLabel = (s: string) => {
  const [year, month, day] = s.split('-');
  return `${day}/${month}/${year}`;
};

function todayKey() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? '';

  return `${get('year')}-${get('month')}-${get('day')}`;
}

function validDate(s: unknown): s is string {
  if (
    typeof s !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(s)
  ) {
    return false;
  }

  const date = new Date(`${s}T12:00:00Z`);

  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === s
  );
}

function moveDay(date: string, offset: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

function dateHeading(date: string) {
  return new Intl.DateTimeFormat('vi-VN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: TZ,
  }).format(new Date(`${date}T12:00:00Z`));
}

function localTime(iso: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

function WaterJournal({ user }: { user: User }) {
  const router = useRouter();

  const params = useLocalSearchParams<{
    date?: string;
    savedAmount?: string;
    savedTime?: string;
    edited?: string;
  }>();

  const [today] = useState(todayKey);

  const [date, setDate] = useState(() =>
    validDate(params.date) ? params.date : today
  );

  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    version: number;
    amount: number;
  } | null>(null);

  const [actionTarget, setActionTarget] = useState<{
    id: string;
    version: number;
    amount: number;
  } | null>(null);

  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState('');
  const [deletedNotice, setDeletedNotice] = useState('');

  const {
    data,
    loading,
    error,
    refresh,
  } = useWaterDay(date, user);

  // Tự tải lại khi trở về màn hình Nhật ký.
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  // Mở màn hình Ghi nước.
  const goNew = () =>
    router.push({
      pathname: '/water/new',
      params: { date },
    });

  // Mở form sửa một lần uống.
  const goEdit = (entryId: string) =>
    router.push({
      pathname: '/water/new',
      params: {
        date,
        editId: entryId,
      },
    });

  // Chuyển ngày đang xem.
  const changeDay = (offset: number) => {
    setDate((old) => moveDay(old, offset));

    setDeleteTarget(null);
    setActionTarget(null);
    setActionError('');
    setDeletedNotice('');

    router.setParams({
      savedAmount: '',
      savedTime: '',
      edited: '',
    });
  };

  // Xóa bản ghi.
  const doDelete = async () => {
    if (!deleteTarget || deleting) return;

    setDeleting(true);
    setActionError('');

    try {
      await deleteWaterEntry(
        user,
        deleteTarget.id,
        deleteTarget.version
      );

      setDeleteTarget(null);
      setDeletedNotice('Đã xóa lần uống nước.');

      refresh();
    } catch (cause) {
      setActionError(
        cause instanceof Error
          ? cause.message
          : 'Không thể xóa bản ghi. Hãy tải lại và thử lại.'
      );
    } finally {
      setDeleting(false);
    }
  };

  // Thông báo khi thêm hoặc sửa thành công.
  const hasSaveFlash =
    !!params.savedTime &&
    !!params.savedAmount &&
    Number(params.savedAmount) > 0;

  const flash =
    params.edited === '1'
      ? 'Đã lưu thay đổi lần uống nước.'
      : hasSaveFlash
        ? `Đã lưu ${ml(
            Number(params.savedAmount)
          )} mL lúc ${params.savedTime}.`
        : '';

  const status =
    data?.recordStatus === 'confirmed'
      ? 'Đã xác nhận đầy đủ'
      : data?.recordStatus === 'partial'
        ? 'Đã ghi một phần'
        : 'Chưa có dữ liệu';

  return (
    <SafeAreaView
      style={s.safe}
      edges={['top', 'bottom']}
    >
      <ScrollView
        style={s.fill}
        contentContainerStyle={s.content}
      >

        {/* HEADER  */}
        <View style={s.brandRow}>
        <View style={{ flex: 1 }}>
            <AccountBrand />
        </View>

        <Pressable
            style={s.avatar}
            onPress={() => router.push('/profile')}
            accessibilityRole="button"
            accessibilityLabel="Mở hồ sơ cá nhân"
        >
            <Ionicons
            name="person-outline"
            size={20}
            color={C.green}
            />
        </Pressable>
        </View>


        {/* NGÀY NHẬT KÝ */}
        <View style={s.dayRow}>
          <Text style={s.dayText}>
            {dateHeading(date)}
          </Text>

          <Pressable
            style={s.dayArrow}
            onPress={() => changeDay(-1)}
            accessibilityLabel="Ngày trước"
          >
            <Ionicons
              name="chevron-back"
              size={18}
              color={C.green}
            />
          </Pressable>

          <Pressable
            style={s.dayArrow}
            onPress={() => changeDay(1)}
            accessibilityLabel="Ngày sau"
          >
            <Ionicons
              name="chevron-forward"
              size={18}
              color={C.green}
            />
          </Pressable>
        </View>

        <Text style={s.title}>
          Nhật ký
        </Text>

        {/* THÔNG BÁO THÀNH CÔNG */}
        {flash || deletedNotice ? (
          <View style={s.noticeRow}>
            <Ionicons
              name="checkmark-circle-outline"
              color={C.green}
              size={17}
            />

            <Text style={s.noticeText}>
              {deletedNotice || flash}
            </Text>

            <Pressable
              onPress={() => {
                setDeletedNotice('');

                router.setParams({
                  savedAmount: '',
                  savedTime: '',
                  edited: '',
                });
              }}
              accessibilityLabel="Đóng thông báo"
            >
              <Ionicons
                name="close"
                color={C.green}
                size={18}
              />
            </Pressable>
          </View>
        ) : null}

        {actionError ? (
          <Text style={s.error}>
            {actionError}
          </Text>
        ) : null}

        {/* TRẠNG THÁI TẢI DỮ LIỆU */}
        {loading ? (
          <View style={s.center}>
            <ActivityIndicator color={C.green} />
            <Text style={s.muted}>
              Đang tải nhật ký...
            </Text>
          </View>
        ) : error || !data ? (
          <View style={s.center}>
            <Text style={s.error}>
              Không tải được dữ liệu:{' '}
              {error ?? 'Vui lòng thử lại'}
            </Text>

            <Pressable
              style={s.retry}
              onPress={refresh}
            >
              <Text style={s.retryText}>
                Thử lại
              </Text>
            </Pressable>
          </View>
        ) : (
          <>
            {/* THẺ TỔNG NƯỚC */}
            <View style={s.summary}>
              <View style={s.summaryTitleRow}>
                <Ionicons
                  name="water-outline"
                  size={20}
                  color={C.green}
                />

                <Text style={s.summaryTitle}>
                  {date === today
                    ? 'Nước đã ghi hôm nay'
                    : `Nước đã ghi · ${dateLabel(date)}`}
                </Text>
              </View>

              <Text style={s.summaryValue}>
                {data.totalWaterMl === null
                  ? 'Chưa có dữ liệu'
                  : `${ml(data.totalWaterMl)} mL`}
              </Text>

              <View style={s.summaryBottom}>
                <Text style={s.muted}>
                  {status}
                </Text>

                <Pressable
                  style={s.create}
                  onPress={goNew}
                >
                  <Text style={s.createText}>
                    + Ghi nước
                  </Text>
                </Pressable>
              </View>
            </View>

            {/* DANH SÁCH BẢN GHI */}
            <View style={s.sectionRow}>
              <Text style={s.sectionTitle}>
                Các bản ghi
              </Text>

              <Pressable onPress={goNew}>
                <Text style={s.addText}>
                  + Thêm bản ghi
                </Text>
              </Pressable>
            </View>

            {data.items.length === 0 ? (
              <Text style={s.empty}>
                Chưa có lần uống nào trong ngày này.
              </Text>
            ) : (
              data.items.map((item) => (
                <Pressable
                  style={s.entry}
                  key={item.entryId}
                  onPress={() => {
                    setActionTarget({
                      id: item.entryId,
                      version: item.version,
                      amount: item.volumeMl,
                    });
                    setActionError('');
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={
                    `Nước ${ml(item.volumeMl)} mL ` +
                    `lúc ${localTime(item.loggedAt)}. ` +
                    'Chạm để sửa hoặc xóa'
                  }
                >
                  <View style={s.entryIcon}>
                    <Ionicons
                      name="water-outline"
                      size={19}
                      color={C.green}
                    />
                  </View>

                  <View style={s.entryContent}>
                    <Text style={s.entryName}>
                      Nước · {ml(item.volumeMl)} mL
                    </Text>

                    <Text
                      style={s.muted}
                      numberOfLines={1}
                    >
                      {item.note || 'Đã lưu'}
                    </Text>
                  </View>

                  <Text style={s.entryTime}>
                    {localTime(item.loggedAt)}
                  </Text>
                </Pressable>
              ))
            )}
          </>
        )}
      </ScrollView>

      {/* MENU SỬA / XÓA */}
      {actionTarget !== null &&
        deleteTarget === null && (
          <View style={s.overlay}>
            <View style={s.dialog}>
              <Text style={s.dialogTitle}>
                Lần uống {ml(actionTarget.amount)} mL
              </Text>

              <Text style={s.dialogBody}>
                Bạn muốn thực hiện thao tác nào?
              </Text>

              <Pressable
                style={s.actionRow}
                onPress={() => {
                  const id = actionTarget.id;
                  setActionTarget(null);
                  goEdit(id);
                }}
              >
                <Ionicons
                  name="create-outline"
                  size={19}
                  color={C.green}
                />

                <Text style={s.actionText}>
                  Sửa lần uống
                </Text>
              </Pressable>

              <Pressable
                style={s.actionRow}
                onPress={() => {
                  setDeleteTarget(actionTarget);
                  setActionTarget(null);
                }}
              >
                <Ionicons
                  name="trash-outline"
                  size={19}
                  color={C.red}
                />

                <Text style={s.deleteText}>
                  Xóa lần uống
                </Text>
              </Pressable>

              <Pressable
                style={s.cancel}
                onPress={() => setActionTarget(null)}
              >
                <Text style={s.cancelText}>
                  Đóng
                </Text>
              </Pressable>
            </View>
          </View>
        )}

      {/* XÁC NHẬN XÓA */}
      {deleteTarget !== null && (
        <View style={s.overlay}>
          <View style={s.dialog}>
            <Text style={s.dialogTitle}>
              Xóa lần uống?
            </Text>

            <Text style={s.dialogBody}>
              Bạn muốn xóa bản ghi{' '}
              {ml(deleteTarget.amount)} mL?
              Thao tác này không thể hoàn tác.
            </Text>

            <View style={s.dialogActions}>
              <Pressable
                style={s.cancelHalf}
                disabled={deleting}
                onPress={() => setDeleteTarget(null)}
              >
                <Text style={s.cancelText}>
                  Hủy
                </Text>
              </Pressable>

              <Pressable
                style={s.confirmDelete}
                disabled={deleting}
                onPress={() => {
                  void doDelete();
                }}
              >
                <Text style={s.confirmText}>
                  {deleting
                    ? 'Đang xóa...'
                    : 'Xác nhận xóa'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

export default function WaterScreen() {
  const { session } = useSession();

  if (session.status !== 'active') {
    return null;
  }

  return (
    <WaterJournal
      key={session.user.uid}
      user={session.user}
    />
  );
}

const s = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: C.bg,
    width: '100%',
    maxWidth: 400,
    alignSelf: 'center',
  },
  fill: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 36,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginBottom: 23,
  },
  logo: {
    width: 30,
    height: 30,
    borderRadius: 9,
    backgroundColor: C.green,
    justifyContent: 'center',
    alignItems: 'center',
  },
  brand: {
    flex: 1,
    color: C.text,
    fontSize: 19,
    fontFamily: 'Roboto_700Bold',
  },
  avatar: {
    width: 34,
    height: 34,
    backgroundColor: C.pale,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  dayText: {
    color: C.muted,
    fontFamily: 'Roboto_400Regular',
    fontSize: 14,
    flex: 1,
  },
  dayArrow: {
    width: 29,
    height: 29,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 32,
    fontFamily: 'Roboto_700Bold',
    color: C.text,
    marginTop: 4,
    marginBottom: 16,
  },
  summary: {
    backgroundColor: C.white,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
  },
  summaryTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginBottom: 7,
  },
  summaryTitle: {
    fontFamily: 'Roboto_700Bold',
    color: C.text,
    fontSize: 15,
  },
  summaryValue: {
    fontFamily: 'Roboto_700Bold',
    color: C.text,
    fontSize: 27,
    marginTop: 2,
    marginBottom: 8,
  },
  summaryBottom: {
    flexDirection: 'row',
    gap: 7,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  muted: {
    color: C.muted,
    fontFamily: 'Roboto_400Regular',
    fontSize: 13,
  },
  create: {
    width: 122,
    height: 39,
    backgroundColor: C.pale,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  createText: {
    color: C.green,
    fontFamily: 'Roboto_700Bold',
    fontSize: 14,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    marginTop: 24,
    marginBottom: 17,
  },
  sectionTitle: {
    fontFamily: 'Roboto_700Bold',
    color: C.text,
    fontSize: 19,
  },
  addText: {
    color: C.green,
    fontFamily: 'Roboto_700Bold',
    fontSize: 13,
  },
  empty: {
    color: C.muted,
    fontSize: 14,
    marginTop: 12,
  },
  entry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 51,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  entryIcon: {
    width: 35,
    height: 35,
    borderRadius: 10,
    backgroundColor: C.pale,
    justifyContent: 'center',
    alignItems: 'center',
  },
  entryContent: {
    flex: 1,
    gap: 2,
  },
  entryName: {
    fontFamily: 'Roboto_700Bold',
    color: C.text,
    fontSize: 14,
  },
  entryTime: {
    color: C.muted,
    fontFamily: 'Roboto_400Regular',
    fontSize: 12,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  error: {
    color: C.red,
    fontSize: 13,
    marginBottom: 12,
  },
  retry: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    backgroundColor: C.pale,
    borderRadius: 10,
  },
  retryText: {
    color: C.green,
    fontFamily: 'Roboto_700Bold',
  },
  noticeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 10,
    padding: 10,
    backgroundColor: C.pale,
    marginBottom: 8,
  },
  noticeText: {
    flex: 1,
    color: C.green,
    fontSize: 12,
    fontFamily: 'Roboto_400Regular',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    justifyContent: 'center',
    padding: 20,
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  dialog: {
    backgroundColor: C.white,
    borderRadius: 17,
    padding: 19,
    gap: 13,
  },
  dialogTitle: {
    color: C.text,
    fontFamily: 'Roboto_700Bold',
    fontSize: 19,
  },
  dialogBody: {
    color: C.muted,
    fontSize: 13,
    lineHeight: 20,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  actionText: {
    color: C.green,
    fontFamily: 'Roboto_700Bold',
    fontSize: 14,
  },
  deleteText: {
    color: C.red,
    fontFamily: 'Roboto_700Bold',
    fontSize: 14,
  },
  cancel: {
    minHeight: 43,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: C.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelText: {
    color: C.green,
    fontFamily: 'Roboto_700Bold',
  },
  dialogActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 5,
  },
  cancelHalf: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  confirmDelete: {
    flex: 1,
    minHeight: 44,
    backgroundColor: C.red,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  confirmText: {
    color: C.white,
    fontFamily: 'Roboto_700Bold',
    fontSize: 13,
  },
});

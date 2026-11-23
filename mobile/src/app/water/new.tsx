
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { User } from 'firebase/auth';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AccountBrand } from '@/components/account-ui';
import { useSession } from '@/hooks/use-session';
import { useWaterDay } from '@/hooks/use-water-day';
import { AccountRequestError } from '@/services/session';

import {
  createWaterEntry,
  getWaterDay,
  updateWaterEntry,
} from '@/services/waterApi';

type Unit = 'mL' | 'L';

type EditableWater = {
  entryId: string;
  volumeMl: number;
  version: number;
  loggedAt: string;
  note: string | null;
};

const TZ = 'Asia/Ho_Chi_Minh';

const C = {
  bg: '#F8F8F1',
  text: '#19342C',
  muted: '#617368',
  green: '#174E40',
  pale: '#E6EDDB',
  white: '#FFFFFF',
  border: '#D8E1D5',
  red: '#B43E34',
  amber: '#94601D',
};

const formatMl = (n: number) =>
  new Intl.NumberFormat('vi-VN', {
    maximumFractionDigits: 2,
  }).format(n);

const displayDate = (s: string) => {
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
};

function todayKey() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const part = (key: string) =>
    parts.find((p) => p.type === key)?.value ?? '';

  return `${part('year')}-${part('month')}-${part('day')}`;
}

function isDateKey(s: unknown): s is string {
  if (
    typeof s !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(s)
  ) {
    return false;
  }

  const d = new Date(`${s}T12:00:00Z`);

  return (
    !Number.isNaN(d.getTime()) &&
    d.toISOString().slice(0, 10) === s
  );
}

function currentTime() {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date());
}

function timeFromIso(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
}

function toVolumeMl(
  text: string,
  unit: Unit
): number | null {
  const raw = text.trim().replace(/\s/g, '');

  if (!raw) return null;

  let normalized: string;

  // 11.000 mL = 11000 mL theo cách viết Việt Nam.
  if (
    unit === 'mL' &&
    /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(raw)
  ) {
    normalized = raw
      .replace(/\./g, '')
      .replace(',', '.');
  } else if (/^\d+([.,]\d+)?$/.test(raw)) {
    normalized = raw.replace(',', '.');
  } else {
    return null;
  }

  const value =
    Number(normalized) *
    (unit === 'L' ? 1000 : 1);

  return Number.isFinite(value) && value > 0
    ? value
    : null;
}

function fromVolumeMl(value: number, unit: Unit) {
  return String(
    unit === 'L' ? value / 1000 : value
  ).replace('.', ',');
}

function dateTimeIso(
  day: string,
  hhmm: string
): string | null {
  if (
    !isDateKey(day) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(hhmm)
  ) {
    return null;
  }

  const date = new Date(
    `${day}T${hhmm}:00+07:00`
  );

  return Number.isNaN(date.getTime())
    ? null
    : date.toISOString();
}

// ==================================================
// BIỂU MẪU THÊM / SỬA NƯỚC UỐNG
// ==================================================

function WaterForm({
  user,
  date,
  record,
  dayTotal,
}: {
  user: User;
  date: string;
  record?: EditableWater;
  dayTotal: number | null;
}) {
  const router = useRouter();

  const edit = !!record;

  const [amount, setAmount] = useState(() =>
    record ? String(record.volumeMl) : '250'
  );

  const [unit, setUnit] = useState<Unit>('mL');

  const [time, setTime] = useState(() =>
    record
      ? timeFromIso(record.loggedAt)
      : currentTime()
  );

  const [note, setNote] = useState(
    record?.note ?? ''
  );

  const [amountError, setAmountError] =
    useState('');

  const [timeError, setTimeError] =
    useState('');

  const [apiError, setApiError] =
    useState('');

  const [warningTotal, setWarningTotal] =
    useState<number | null>(null);

  const [saving, setSaving] = useState(false);

  // Giữ entryId khi gửi lại cùng nội dung
  // để hạn chế tạo bản ghi trùng do lỗi mạng.
  const pending = useRef<{
    id: string;
    fingerprint: string;
  } | null>(null);

  const savingRef = useRef(false);

  const volumeMl = toVolumeMl(amount, unit);

  const previous = Math.max(
    0,
    (dayTotal ?? 0) - (record?.volumeMl ?? 0)
  );

  const estimated =
    volumeMl === null
      ? null
      : previous + volumeMl;

  // Xóa lỗi khi người dùng thay đổi dữ liệu.
  const changed = () => {
    setWarningTotal(null);
    setAmountError('');
    setTimeError('');
    setApiError('');
  };

  // Chuyển đơn vị mL/L.
  const changeUnit = (next: Unit) => {
    if (next === unit) return;

    setAmount(
      volumeMl === null
        ? amount
        : fromVolumeMl(volumeMl, next)
    );

    setUnit(next);
    changed();
  };

  // Chọn nhanh lượng nước.
  const choose = (value: number) => {
    setUnit('mL');
    setAmount(String(value));
    changed();
  };

  // ==================================================
  // XỬ LÝ LƯU NƯỚC
  // ==================================================

  const handleSave = async (
    confirmLarge: boolean,
    nowMs: number,
    freshEntryId: string
  ) => {
    if (savingRef.current) return;

    setAmountError('');
    setTimeError('');
    setApiError('');

    // 1. Kiểm tra lượng nước.
    if (volumeMl === null) {
      setAmountError(
        'Nhập lượng nước lớn hơn 0 mL, ví dụ 250 mL.'
      );
      return;
    }

    // 2. Kiểm tra thời điểm uống.
    const iso = dateTimeIso(date, time);

    if (!iso) {
      setTimeError(
        'Nhập giờ hợp lệ từ 00:00 đến 23:59, ví dụ 14:30.'
      );
      return;
    }

    if (
      Date.parse(iso) >
      nowMs + 5 * 60_000
    ) {
      setTimeError(
        'Chọn giờ uống không muộn hơn giờ hiện tại 5 phút.'
      );
      return;
    }

    // 3. Chuẩn bị dữ liệu gửi Backend.
    const trimNote = note.trim();

    const amountValue =
      unit === 'L'
        ? volumeMl / 1000
        : volumeMl;

    const payload = {
      amount: amountValue,
      unit,
      loggedAt: iso,
      timeZone: TZ,
      note: trimNote,
    };

    const fingerprint = JSON.stringify(payload);

    // Tránh tạo trùng nếu lần gửi trước
    // chưa xác định được kết quả.
    if (
      !edit &&
      pending.current &&
      pending.current.fingerprint !== fingerprint
    ) {
      setApiError(
        'Nội dung đã đổi sau một lần gửi chưa rõ kết quả. ' +
        'Hãy quay về Nhật ký và kiểm tra bản ghi trước ' +
        'khi tạo lần uống khác, tránh lưu trùng.'
      );
      return;
    }

    savingRef.current = true;
    setSaving(true);

    try {
      // 4. Lấy dữ liệu mới nhất từ Backend.
      const latest = await getWaterDay(date, user);

      const original = edit
        ? latest.items.find(
            (item) => item.entryId === record?.entryId
          )
        : undefined;

      // Kiểm tra phiên bản trước khi sửa.
      if (
        edit &&
        (
          !original ||
          original.version !== record?.version
        )
      ) {
        setApiError(
          'Bản ghi đã thay đổi hoặc bị xóa. ' +
          'Quay lại Nhật ký và tải lại trước khi sửa.'
        );
        return;
      }

      // 5. Tính tổng nước sau khi lưu.
      const nextTotal =
        Math.max(0, latest.totalWaterMl ?? 0) -
        (original?.volumeMl ?? 0) +
        volumeMl;

      // 6. Cảnh báo nếu vượt 10.000 mL.
      if (
        nextTotal > 10_000 &&
        (
          !confirmLarge ||
          warningTotal !== nextTotal
        )
      ) {
        setWarningTotal(nextTotal);
        return;
      }

      setWarningTotal(null);

      // 7. Gọi API thêm hoặc sửa.
      if (record) {
        await updateWaterEntry(
          user,
          record.entryId,
          {
            version: record.version,
            ...payload,
          }
        );
      } else {
        if (!pending.current) {
          pending.current = {
            id: freshEntryId,
            fingerprint,
          };
        }

        await createWaterEntry(user, {
          entryId: pending.current.id,
          ...payload,
        });
      }

      // 8. Quay về Nhật ký sau khi lưu.
      router.replace({
        pathname: '/water',
        params: {
          date,
          ...(edit
            ? { edited: '1' }
            : {
                savedAmount: String(volumeMl),
                savedTime: time,
              }),
        },
      });
    } catch (cause) {
      // Phản hồi 4xx là lỗi xác định.
      if (
        cause instanceof AccountRequestError &&
        cause.status >= 400 &&
        cause.status < 500
      ) {
        pending.current = null;
      }

      setApiError(
        cause instanceof Error
          ? cause.message
          : 'Không thể lưu nhật ký. Vui lòng thử lại.'
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  // ==================================================
  // GIAO DIỆN GHI NƯỚC
  // ==================================================

  return (
    <SafeAreaView
      style={s.safe}
      edges={['top', 'bottom']}
    >
      <KeyboardAvoidingView
        style={s.fill}
        behavior={
          Platform.OS === 'ios'
            ? 'padding'
            : undefined
        }
      >
        <ScrollView
          style={s.fill}
          contentContainerStyle={s.content}
          keyboardShouldPersistTaps="handled"
        >
          {/* LOGO GIỐNG TRANG LOGIN */}
          <View style={s.brandContainer}>
            <AccountBrand />
          </View>

          {/* NÚT QUAY LẠI */}
          <Pressable
            style={s.back}
            onPress={() => router.back()}
          >
            <Ionicons
              name="arrow-back"
              size={20}
              color={C.green}
            />

            <Text style={s.backText}>
              Quay lại
            </Text>
          </Pressable>

          {/* TIÊU ĐỀ */}
          <Text style={s.kicker}>
            Nhật ký · {displayDate(date)}
          </Text>

          <Text style={s.title}>
            {edit
              ? 'Sửa lần uống'
              : 'Ghi nước'}
          </Text>

          {/* LƯỢNG NƯỚC */}
          <Text style={s.label}>
            Lượng nước
          </Text>

          <View
            style={[
              s.field,
              amountError
                ? s.fieldError
                : warningTotal !== null
                  ? s.fieldWarning
                  : undefined,
            ]}
          >
            <Ionicons
              name="water-outline"
              size={22}
              color={C.muted}
            />

            <TextInput
              style={s.valueInput}
              value={amount}
              onChangeText={(value) => {
                setAmount(value);
                changed();
              }}
              keyboardType="decimal-pad"
              placeholder="250"
              editable={!saving}
              placeholderTextColor={C.muted}
              accessibilityLabel="Lượng nước"
            />

            {/* CHỌN ĐƠN VỊ */}
            <View style={s.units}>
              {(['mL', 'L'] as const).map(
                (option) => (
                  <Pressable
                    key={option}
                    onPress={() =>
                      changeUnit(option)
                    }
                    disabled={saving}
                    style={[
                      s.unitButton,
                      unit === option &&
                        s.unitSelected,
                    ]}
                  >
                    <Text
                      style={[
                        s.unitText,
                        unit === option &&
                          s.unitSelectedText,
                      ]}
                    >
                      {option}
                    </Text>
                  </Pressable>
                )
              )}
            </View>
          </View>

          {/* LỖI LƯỢNG NƯỚC */}
          {amountError ? (
            <Text style={s.errorField}>
              {amountError}
            </Text>
          ) : null}

          {/* CẢNH BÁO LƯỢNG NƯỚC LỚN */}
          {warningTotal !== null &&
          !amountError ? (
            <View style={s.warningRow}>
              <Ionicons
                name="warning-outline"
                size={18}
                color={C.amber}
              />

              <Text style={s.warningText}>
                Tổng ngày sẽ là{' '}
                {formatMl(warningTotal)} mL,
                vượt mức kiểm tra 10.000 mL.
                Kiểm tra số mL trước khi lưu.
              </Text>
            </View>
          ) : null}

          {/* CHỌN NHANH 150 / 250 / 500 ML */}
          <View style={s.quickRow}>
            {[150, 250, 500].map((value) => (
              <Pressable
                key={value}
                disabled={saving}
                onPress={() => choose(value)}
                style={[
                  s.quick,
                  unit === 'mL' &&
                    volumeMl === value &&
                    s.quickActive,
                ]}
              >
                <Text
                  style={[
                    s.quickText,
                    unit === 'mL' &&
                      volumeMl === value &&
                      s.quickActiveText,
                  ]}
                >
                  {value} mL
                </Text>
              </Pressable>
            ))}
          </View>

          {/* THỜI ĐIỂM UỐNG */}
          <Text
            style={[
              s.label,
              s.timeLabel,
            ]}
          >
            Thời điểm uống
          </Text>

          <View
            style={[
              s.field,
              timeError
                ? s.fieldError
                : undefined,
            ]}
          >
            <Ionicons
              name="time-outline"
              size={22}
              color={C.muted}
            />

            <TextInput
              style={s.valueInput}
              value={time}
              onChangeText={(value) => {
                setTime(value);
                changed();
              }}
              placeholder="HH:mm"
              maxLength={5}
              editable={!saving}
              keyboardType="numbers-and-punctuation"
              placeholderTextColor={C.muted}
              accessibilityLabel="Thời điểm uống"
            />
          </View>

          {/* LỖI THỜI GIAN */}
          {timeError ? (
            <Text style={s.errorField}>
              {timeError}
            </Text>
          ) : null}

          {/* GHI CHÚ */}
          <Text
            style={[
              s.label,
              s.noteLabel,
            ]}
          >
            Ghi chú (không bắt buộc)
          </Text>

          <TextInput
            style={s.noteInput}
            multiline
            maxLength={200}
            editable={!saving}
            value={note}
            onChangeText={(value) => {
              setNote(value);
              changed();
            }}
            placeholder="Ví dụ: Uống nước sau khi tập"
            placeholderTextColor={C.muted}
            textAlignVertical="top"
            accessibilityLabel="Ghi chú"
          />

          {/* TỔNG NƯỚC SAU KHI LƯU */}
          <View style={s.totalCard}>
            <Text style={s.totalTitle}>
              Tổng sau khi lưu
            </Text>

            <Text style={s.totalValue}>
              {estimated === null
                ? 'Nhập lượng nước hợp lệ'
                : `${formatMl(estimated)} mL`}
            </Text>

            <Text style={s.totalDescription}>
              {dayTotal === null
                ? 'Chưa có bản ghi nước trước đó'
                : `Đã ghi trước đó ${formatMl(
                    previous
                  )} mL`}
            </Text>
          </View>
        </ScrollView>

        {/* FOOTER CỐ ĐỊNH */}
        <View style={s.footer}>
          {/* HIỂN THỊ LỖI API GẦN NÚT LƯU */}
          {apiError ? (
            <Text style={s.apiError}>
              {apiError}
            </Text>
          ) : null}

          {warningTotal !== null && (
            <Pressable
              disabled={saving}
              style={s.secondary}
              onPress={() =>
                setWarningTotal(null)
              }
            >
              <Text style={s.secondaryText}>
                Sửa lại
              </Text>
            </Pressable>
          )}

          <Pressable
            disabled={saving}
            style={[
              s.saveButton,
              saving && s.saving,
            ]}
            onPress={() => {
              // Chỉ tạo thời gian và ID
              // khi người dùng nhấn nút.
              const nowMs = Date.now();

              const freshEntryId =
                `water-${nowMs}-${Math.random()
                  .toString(36)
                  .slice(2, 10)}`;

              void handleSave(
                warningTotal !== null,
                nowMs,
                freshEntryId
              );
            }}
          >
            {saving ? (
              <ActivityIndicator
                color={C.white}
              />
            ) : (
              <Text style={s.saveText}>
                {warningTotal !== null
                  ? 'Xác nhận và lưu'
                  : edit
                    ? 'Lưu thay đổi'
                    : 'Lưu vào nhật ký'}
              </Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ==================================================
// TẢI DỮ LIỆU NHẬT KÝ
// ==================================================

function FormGate({
  user,
  date,
  editId,
}: {
  user: User;
  date: string;
  editId?: string;
}) {
  const {
    data,
    loading,
    error,
    refresh,
  } = useWaterDay(date, user);

  if (loading) {
    return (
      <SafeAreaView style={s.center}>
        <ActivityIndicator
          color={C.green}
        />

        <Text>
          Đang tải nhật ký nước...
        </Text>
      </SafeAreaView>
    );
  }

  if (error || !data) {
    return (
      <SafeAreaView style={s.center}>
        <Text style={s.apiError}>
          Không tải được nhật ký:{' '}
          {error ?? 'Không có dữ liệu'}
        </Text>

        <Pressable
          onPress={refresh}
          style={s.secondary}
        >
          <Text style={s.secondaryText}>
            Thử lại
          </Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const record = editId
    ? data.items.find(
        (item) => item.entryId === editId
      )
    : undefined;

  if (editId && !record) {
    return (
      <SafeAreaView style={s.center}>
        <Text style={s.apiError}>
          Không tìm thấy bản ghi cần sửa.
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <WaterForm
      key={`${editId ?? 'new'}:${record?.version ?? 0}:${date}`}
      user={user}
      date={date}
      record={record}
      dayTotal={data.totalWaterMl}
    />
  );
}

// ==================================================
// MÀN HÌNH CHÍNH
// ==================================================

export default function NewWaterScreen() {
  const { session } = useSession();

  const params = useLocalSearchParams<{
    date?: string;
    editId?: string;
  }>();

  const [defaultDate] = useState(todayKey);

  const date = isDateKey(params.date)
    ? params.date
    : defaultDate;

  if (session.status !== 'active') {
    return null;
  }

  return (
    <FormGate
      key={`${session.user.uid}:${date}:${params.editId ?? ''}`}
      user={session.user}
      date={date}
      editId={params.editId}
    />
  );
}

// ==================================================
// STYLESHEET
// ==================================================

const s = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: C.bg,
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
  },

  brandContainer: {
    alignSelf: 'flex-start',
    marginBottom: 16,
  },

  fill: {
    flex: 1,
  },

  center: {
    flex: 1,
    backgroundColor: C.bg,
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 24,
  },

  content: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 18,
    paddingBottom: 28,
  },

  back: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    alignSelf: 'flex-start',
    minHeight: 36,
  },

  backText: {
    color: C.green,
    fontFamily: 'Roboto_400Regular',
    fontSize: 14,
  },

  kicker: {
    color: C.muted,
    marginTop: 30,
    fontFamily: 'Roboto_400Regular',
    fontSize: 14,
  },

  title: {
    color: C.text,
    fontFamily: 'Roboto_700Bold',
    fontSize: 29,
    marginTop: 8,
    marginBottom: 43,
  },

  label: {
    color: C.text,
    fontFamily: 'Roboto_700Bold',
    fontSize: 15,
    marginBottom: 13,
  },

  field: {
    minHeight: 54,
    paddingHorizontal: 12,
    borderRadius: 13,
    borderColor: C.border,
    borderWidth: 1,
    backgroundColor: C.white,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },

  fieldError: {
    borderColor: C.red,
    borderWidth: 1.5,
  },

  fieldWarning: {
    borderColor: C.amber,
    borderWidth: 1.5,
  },

  valueInput: {
    flex: 1,
    minWidth: 44,
    color: C.text,
    fontFamily: 'Roboto_400Regular',
    fontSize: 19,
    paddingVertical: 0,
  },

  units: {
    flexDirection: 'row',
    gap: 4,
  },

  unitButton: {
    backgroundColor: C.bg,
    borderRadius: 7,
    paddingHorizontal: 9,
    paddingVertical: 8,
  },

  unitSelected: {
    backgroundColor: C.pale,
  },

  unitText: {
    color: C.muted,
    fontFamily: 'Roboto_400Regular',
    fontSize: 12,
  },

  unitSelectedText: {
    color: C.green,
    fontFamily: 'Roboto_700Bold',
  },

  errorField: {
    color: C.red,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 8,
  },

  warningRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
    marginTop: 10,
  },

  warningText: {
    flex: 1,
    color: C.amber,
    fontFamily: 'Roboto_400Regular',
    fontSize: 13,
    lineHeight: 19,
  },

  quickRow: {
    flexDirection: 'row',
    gap: 9,
    marginTop: 16,
  },

  quick: {
    flex: 1,
    minHeight: 42,
    backgroundColor: C.white,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
  },

  quickActive: {
    borderColor: C.green,
    backgroundColor: C.pale,
  },

  quickText: {
    color: C.muted,
    fontSize: 14,
    fontFamily: 'Roboto_400Regular',
  },

  quickActiveText: {
    color: C.green,
    fontFamily: 'Roboto_700Bold',
  },

  timeLabel: {
    marginTop: 36,
  },

  noteLabel: {
    marginTop: 27,
  },

  noteInput: {
    minHeight: 76,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 13,
    backgroundColor: C.white,
    padding: 12,
    fontFamily: 'Roboto_400Regular',
    color: C.text,
    fontSize: 14,
  },

  totalCard: {
    backgroundColor: C.pale,
    borderRadius: 17,
    marginTop: 32,
    padding: 18,
    gap: 9,
  },

  totalTitle: {
    fontFamily: 'Roboto_700Bold',
    fontSize: 15,
    color: C.green,
  },

  totalValue: {
    fontFamily: 'Roboto_700Bold',
    fontSize: 26,
    color: C.text,
  },

  totalDescription: {
    fontFamily: 'Roboto_400Regular',
    fontSize: 13,
    color: C.muted,
  },

  apiError: {
    color: C.red,
    fontSize: 13,
    marginTop: 12,
    lineHeight: 19,
  },

  footer: {
    backgroundColor: C.bg,
    paddingHorizontal: 24,
    paddingTop: 10,
    paddingBottom: 12,
    gap: 10,
  },

  secondary: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    backgroundColor: C.white,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },

  secondaryText: {
    color: C.green,
    fontFamily: 'Roboto_700Bold',
    fontSize: 15,
  },

  saveButton: {
    backgroundColor: C.green,
    borderRadius: 13,
    minHeight: 51,
    justifyContent: 'center',
    alignItems: 'center',
  },

  saveText: {
    color: C.white,
    fontFamily: 'Roboto_700Bold',
    fontSize: 16,
  },

  saving: {
    opacity: 0.65,
  },
});

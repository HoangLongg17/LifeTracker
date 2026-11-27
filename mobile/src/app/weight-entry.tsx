import { router, useLocalSearchParams, usePreventRemove } from 'expo-router';
import type { User } from 'firebase/auth';

import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { AccountButton, accountStyles as ui, colors, ErrorMessage } from '@/components/account-ui';
import { FormHeading, j, JournalBack, JournalDialog, JournalHeader, JournalIcon, JournalPage } from '@/components/journal-ui';
import { useSession } from '@/hooks/use-session';
import { loadProfile, type PersonalProfile } from '@/services/profile';
import { AccountRequestError } from '@/services/session';
import {
  createWeight, formatWeight, getWeight, updateWeight, weightToKg, weightValueInUnit, type WeightEntry,
} from '@/services/weights';
import { dayKey, displayDate, instant, wallTime } from '@/utils/journal-time';

type Params = { date?: string; editId?: string; returnTo?: string };
type Loaded = { profile: PersonalProfile; record: WeightEntry | null };

function entryId() {
  return `weight-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function numberText(value: number) {
  return value
    .toFixed(2)
    .replace(/(\.\d*?)0+$/, '$1')
    .replace(/\.$/, '')
    .replace('.', ',');
}

function normalizeMeasurementDate(value: string) {
  const raw = value.trim();
  const strict = dayKey(raw);
  if (strict) return displayDate(strict);
  const parts = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (!parts) return null;
  const normalized = dayKey(`${parts[3]}-${parts[2].padStart(2, '0')}-${parts[1].padStart(2, '0')}`);
  return normalized ? displayDate(normalized) : null;
}

function normalizeMeasurementTime(value: string) {
  const parts = /^(\d{1,2}):(\d{1,2})$/.exec(value.trim());
  if (!parts) return null;
  const hour = Number(parts[1]);
  const minute = Number(parts[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function requestMessage(error: unknown) {
  if (error instanceof AccountRequestError) {
    if (error.code === 'VERSION_CONFLICT') return 'Bản ghi đã thay đổi ở nơi khác. Hãy tải lại rồi thử lại.';
    if (error.code === 'ENTRY_ID_CONFLICT') return 'Không thể xác nhận lần lưu trước. Hãy tải lại lịch sử cân nặng.';
    if (error.status === 401) return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
    if (error.status === 403) return 'Bạn không có quyền cập nhật lịch sử cân nặng này.';
    if (error.status === 400) return 'Thông tin cân nặng hoặc thời điểm đo không hợp lệ.';
    if (error.status >= 500) return 'Máy chủ chưa thể lưu lần đo. Vui lòng thử lại.';
  }
  return 'Không thể lưu lần đo cân nặng. Vui lòng thử lại.';
}

function WeightForm({ user, date, editId, returnTo }: {
  user: User; date: string; editId?: string; returnTo?: string;
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState('');
  const [weightText, setWeightText] = useState('');
  const [dateText, setDateText] = useState('');
  const [timeText, setTimeText] = useState('');
  const [timeZone, setTimeZone] = useState('Asia/Ho_Chi_Minh');
  const [weightTouched, setWeightTouched] = useState(false);
  const [saveAttempted, setSaveAttempted] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);
  const [draftDate, setDraftDate] = useState('');
  const [draftTime, setDraftTime] = useState('');
  const [timeError, setTimeError] = useState('');
  const [warningOpen, setWarningOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [formKey, setFormKey] = useState(0);
  const savingRef = useRef(false);
  const pending = useRef<{ id: string; fingerprint: string } | null>(null);
  const [initialSnapshot, setInitialSnapshot] = useState({ weight: '', date: '', time: '' });
const [hasPending, setHasPending] = useState(false);
const [confirmLeave, setConfirmLeave] = useState(false);
const allowExitRef = useRef(false);
const leaveAction = useRef<() => void>(() => {});

const isDirty =
  weightText !== initialSnapshot.weight ||
  dateText !== initialSnapshot.date ||
  timeText !== initialSnapshot.time;

usePreventRemove(!allowExitRef.current && (isDirty || saving || hasPending), ({ repeat }) => {
  if (allowExitRef.current) {
    repeat();
    return;
  }
  if (savingRef.current) return;
  leaveAction.current = repeat;
  setConfirmLeave(true);
});
  const paramsDate = dayKey(date);

  useEffect(() => {
    let active = true;
    void Promise.all([
      loadProfile(user),
      editId ? getWeight(user, editId) : Promise.resolve(null),
    ]).then(([profile, record]) => {
      if (!active) return;
      const zone = record?.timeZone ?? profile.timeZone;
      const local = record ? wallTime(record.measuredAt, zone) : null;
      const currentDay = dayKey(wallTime(Date.now(), zone).date)!;
      const initialDay = (local ? dayKey(local.date) : null) ?? paramsDate ?? currentDay;
      setLoadError('');
      setLoaded({ profile, record });
      setTimeZone(zone);
      setDateText(displayDate(initialDay));
      setTimeText(local?.time ?? wallTime(Date.now(), zone).time);
      setWeightText(record
        ? numberText(weightValueInUnit(record.weightKg, profile.preferredUnits.weight))
        : '');
      const initDate = displayDate(initialDay);
      const initTime = local?.time ?? wallTime(Date.now(), zone).time;
      const initWeight = record
    ? numberText(weightValueInUnit(record.weightKg, profile.preferredUnits.weight))
    : '';
setInitialSnapshot({ weight: initWeight, date: initDate, time: initTime });  
      setWeightTouched(false);
      setSaveAttempted(false);
      setTimeError('');
      setError('');
    }).catch(() => {
      if (active) setLoadError('Không thể tải thông tin hồ sơ hoặc bản ghi cân nặng.');
    });
    return () => { active = false; };
  }, [user, editId, paramsDate, formKey]);

  const profile = loaded?.profile;
  const record = loaded?.record;
  const unit = profile?.preferredUnits.weight ?? 'kg';
  const parsedValue = weightText.trim() && /^\d+(?:[.,]\d{1,2})?$/.test(weightText.trim())
    ? Number(weightText.trim().replace(',', '.'))
    : Number.NaN;
  const validWeight = Number.isFinite(parsedValue) && parsedValue > 0;
  const weightKg = validWeight ? weightToKg(parsedValue, unit) : null;
  const hardLimitExceeded = weightKg !== null && weightKg >= 1000;
  const weightError = weightTouched || saveAttempted
    ? !weightText.trim() || parsedValue === 0
      ? `Nhập cân nặng lớn hơn 0 ${unit}.`
      : hardLimitExceeded ? 'Cân nặng không được đạt 1000 kg trở lên.'
      : !validWeight ? `Nhập cân nặng hợp lệ bằng ${unit}.` : ''
    : '';
  const measuredAt = profile ? instant({ date: dateText, time: timeText }, timeZone, record?.measuredAt) : null;
  const timeLabel = `${dateText} · ${timeText}`;
  const weightLabel = weightKg !== null ? formatWeight(weightKg, unit) : 'Chờ cân nặng hợp lệ.';
  const warningRequired = weightKg !== null && !hardLimitExceeded && (weightKg < 20 || weightKg > 300);
  const canSave = !!profile && validWeight && !hardLimitExceeded && !saving;

  async function save(confirmWarning = false) {
    if (!profile || !weightKg || savingRef.current) return;
    setSaveAttempted(true);
    if (hardLimitExceeded) {
      setError('Cân nặng không được đạt 1000 kg trở lên.');
      return;
    }
    if (!measuredAt || Date.parse(measuredAt) > Date.now() + 5 * 60 * 1000) {
      setTimeError('Nhập ngày và giờ đo hợp lệ, không ở tương lai.');
      setTimeOpen(true);
      return;
    }
    if (warningRequired && !confirmWarning) {
      setWarningOpen(true);
      return;
    }

    const body = {
      weightKg,
      measuredAt,
      timeZone,
      warningConfirmed: confirmWarning,
    };
    const fingerprint = JSON.stringify(body);
    if (!pending.current || pending.current.fingerprint !== fingerprint) {
      pending.current = { id: entryId(), fingerprint };
      setHasPending(true);
    }

    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      const saved = record
        ? await updateWeight(user, record.entryId, { ...body, version: record.version })
        : await createWeight(user, { ...body, entryId: pending.current.id });
      pending.current = null;
      setWarningOpen(false);
      allowExitRef.current = true; setHasPending(false);
      if (returnTo === 'journal') {
        const notice = record
          ? `Đã cập nhật lần đo ${formatWeight(saved.weightKg, unit)}.`
          : `Đã lưu lần đo ${formatWeight(saved.weightKg, unit)}.`;
        router.replace({ pathname: '/journal', params: { date: saved.localDate, notice } });
      } else {
        router.replace({ pathname: '/weight-history', params: {
          notice: record ? 'Đã cập nhật lần đo cân nặng.' : 'Đã lưu lần đo cân nặng.',
        } });
      }
    } catch (cause) {
      setError(requestMessage(cause));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function openTimeEditor() {
    setDraftDate(dateText);
    setDraftTime(timeText);
    setTimeError('');
    setTimeOpen(true);
  }

  function applyTime() {
    const normalizedDate = normalizeMeasurementDate(draftDate);
    const normalizedTime = normalizeMeasurementTime(draftTime);
    if (!normalizedDate || !normalizedTime) {
      setTimeError('Nhập ngày và giờ đo hợp lệ, không ở tương lai.');
      return;
    }
    const next = instant({ date: normalizedDate, time: normalizedTime }, timeZone, record?.measuredAt);
    if (!next || Date.parse(next) > Date.now() + 5 * 60 * 1000) {
      setTimeError('Nhập ngày và giờ đo hợp lệ, không ở tương lai.');
      return;
    }
    setDateText(normalizedDate);
    setTimeText(normalizedTime);
    setTimeError('');
    setError('');
    setTimeOpen(false);
  }

  if (loadError) return <JournalPage>
    <JournalHeader /><JournalBack />
    <View style={{ gap: 12, marginTop: 24 }}>
      <ErrorMessage message={loadError} />
      <AccountButton label="Thử lại" onPress={() => { setLoadError(''); setFormKey(value => value + 1); }} />
    </View>
  </JournalPage>;
  if (!loaded) return <JournalPage><JournalHeader /><ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} accessibilityLabel="Đang tải biểu mẫu cân nặng" /></JournalPage>;

  const dateForHeading = dayKey(dateText) ?? paramsDate;
  return <JournalPage footer={<AccountButton label="Lưu vào nhật ký" disabled={!canSave} busy={saving} onPress={() => void save()} />}>
    <JournalHeader />
    <JournalBack />
    <FormHeading title={record ? 'Sửa cân nặng' : 'Ghi nhận cân nặng'} date={dateForHeading ? displayDate(dateForHeading) : 'Hôm nay'} />

    <View style={{ marginTop: 28, gap: 20 }}>
      <View>
        <Text style={ui.label}>Cân nặng</Text>
        <View style={[ui.inputBox, { marginTop: 7, minHeight: 52 },
          !!weightError && { borderColor: colors.error, borderWidth: 2 }]}>
          <JournalIcon name="scale" size={17} />
          <TextInput accessibilityLabel={`Cân nặng (${unit})`} value={weightText} editable={!saving}
            onChangeText={value => { setWeightText(value); setWeightTouched(true); setError(''); }}
            keyboardType="decimal-pad" placeholder={`Nhập cân nặng (${unit})`}
            placeholderTextColor={colors.muted} style={[ui.input, { minHeight: 50 }]} />
          <Text style={j.small}>{unit}</Text>
        </View>
        {!!weightError && <ErrorMessage message={weightError} />}
      </View>

      <View>
        <Text style={ui.label}>Thời điểm đo</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`Thời điểm đo: ${timeLabel}`}
          onPress={openTimeEditor} disabled={saving}
          style={[ui.inputBox, { marginTop: 7, minHeight: 52 }]}>
          <JournalIcon name="clock" size={17} />
          <Text style={[j.text, { flex: 1 }]}>{timeLabel}</Text>
          <JournalIcon name="chevron" size={15} />
        </Pressable>
        {!!timeError && <ErrorMessage message={timeError} />}
      </View>

      <View style={[j.card, { minHeight: 122, justifyContent: 'center', backgroundColor: colors.pale, borderWidth: 0, paddingHorizontal: 18, gap: 7 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <JournalIcon name="check" size={16} tint={colors.primary} />
          <Text style={j.strong}>Lần đo mới</Text>
        </View>
        <Text style={[j.heading, { marginTop: 0, fontSize: 24, lineHeight: 32 }]}>{weightLabel}</Text>
        <Text style={j.small}>{timeLabel}</Text>
      </View>
      {!!error && <ErrorMessage message={error} />}
    </View>

    {timeOpen && <JournalDialog title="Thời điểm đo" onClose={() => setTimeOpen(false)}>
      <Text style={j.small}>Ngày đo</Text>
      <TextInput accessibilityLabel="Ngày đo" value={draftDate} onChangeText={setDraftDate}
        placeholder="dd/mm/yyyy" placeholderTextColor={colors.muted} keyboardType="numbers-and-punctuation"
        style={[ui.inputBox, ui.input, { marginTop: 0, minHeight: 48, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 11 }]} />
      <Text style={j.small}>Giờ đo (24 giờ)</Text>
      <TextInput accessibilityLabel="Giờ đo" value={draftTime} onChangeText={setDraftTime}
        placeholder="HH:mm" placeholderTextColor={colors.muted} keyboardType="numbers-and-punctuation"
        style={[ui.inputBox, ui.input, { marginTop: 0, minHeight: 48, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 11 }]} />
      {!!timeError && <ErrorMessage message={timeError} />}
      <AccountButton label="Xác nhận thời điểm" onPress={applyTime} />
      <AccountButton label="Hủy" outline onPress={() => setTimeOpen(false)} />
    </JournalDialog>}
    {warningOpen && <JournalDialog title="Xác nhận số đo" onClose={() => setWarningOpen(false)}>
      <Text style={j.text}>Số đo {weightLabel} nằm ngoài khoảng thông thường. Bạn có muốn lưu số đo này không?</Text>
      <AccountButton label="Xác nhận lưu" busy={saving} onPress={() => void save(true)} />
      <AccountButton label="Kiểm tra lại" outline onPress={() => setWarningOpen(false)} />
    </JournalDialog>}
    {confirmLeave && <JournalDialog title="Bỏ thay đổi?" onClose={() => setConfirmLeave(false)}>
  <Text style={j.text}>
    {hasPending
      ? 'Lần lưu trước chưa được xác nhận. Bạn vẫn muốn rời màn hình?'
      : 'Dữ liệu cân nặng chưa được lưu sẽ mất. Bạn có muốn rời đi không?'}
  </Text>
  <AccountButton label="Rời đi" onPress={() => { setConfirmLeave(false); leaveAction.current(); }} />
  <AccountButton label="Tiếp tục nhập" outline onPress={() => setConfirmLeave(false)} />
</JournalDialog>}
  </JournalPage>;
}

export default function WeightEntryScreen() {
  const params = useLocalSearchParams<Params>();
  const date = typeof params.date === 'string' ? params.date : '';
  const editId = typeof params.editId === 'string' ? params.editId : undefined;
  const returnTo = typeof params.returnTo === 'string' ? params.returnTo : undefined;
  const { session } = useSession();
  return session.status === 'active'
    ? <WeightForm key={`${session.user.uid}/${editId ?? ''}/${date}`} user={session.user} date={date} editId={editId} returnTo={returnTo} />
    : null;
}

import { StatusBar } from 'expo-status-bar';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { accountStyles as ui, colors } from '@/components/account-ui';
import { useSession } from '@/hooks/use-session';
import {
  addWeightMeasurement, loadProfile, type PersonalProfile, type PreferredUnits, updateProfile,
} from '@/services/profile';
import { AccountRequestError } from '@/services/session';

type Draft = {
  displayName: string;
  birthDate: string;
  birthYear: string;
  height: string;
  weight: string;
  activityLevel: PersonalProfile['activityLevel'];
  units: PreferredUnits;
  timeZone: string;
};

type FieldErrors = Partial<Record<keyof Draft | 'form', string>>;

const activities = [
  { value: 'sedentary', label: 'Ít vận động', note: 'Chủ yếu ngồi trong ngày' },
  { value: 'light', label: 'Nhẹ', note: 'Vận động nhẹ 1–3 ngày/tuần' },
  { value: 'moderate', label: 'Vừa phải', note: 'Vận động 3–5 ngày/tuần' },
  { value: 'active', label: 'Năng động', note: 'Vận động 6–7 ngày/tuần' },
  { value: 'very_active', label: 'Rất năng động', note: 'Hoạt động thể lực cường độ cao' },
] as const;

const heightEpsilonCm = 0.01;
const weightEpsilonKg = 0.005;

function displayNumber(value: number | null, divisor = 1, digits = 2) {
  return value === null ? '' : String(Number((value / divisor).toFixed(digits)));
}

function numericValue(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value.trim().replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
    && date.getTime() <= Date.now();
}

function toDraft(profile: PersonalProfile): Draft {
  return {
    displayName: profile.displayName,
    birthDate: profile.birthDate ?? '',
    birthYear: profile.birthYear?.toString() ?? '',
    height: displayNumber(profile.heightCm, profile.preferredUnits.height === 'in' ? 2.54 : 1),
    weight: displayNumber(profile.currentWeightKg, profile.preferredUnits.weight === 'lb' ? 1 / 2.2046226218 : 1),
    activityLevel: profile.activityLevel,
    units: profile.preferredUnits,
    timeZone: profile.timeZone,
  };
}

function errorMessage(error: unknown) {
  if (error instanceof AccountRequestError) {
    if (error.code === 'PROFILE_VERSION_CONFLICT') return 'Hồ sơ đã được cập nhật ở nơi khác. Tải lại rồi thử lại nhé.';
    if (error.code === 'PROFILE_UNAVAILABLE') return 'Backend không hoàn tất được thao tác Firestore. Hãy xem nhật ký Backend để biết mã lỗi.';
    if (error.code === 'WARNING_CONFIRMATION_REQUIRED') return 'Vui lòng xác nhận lại số đo nằm ngoài khoảng cảnh báo.';
    if (error.status === 401) return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
    if (error.status === 403) return 'Bạn không có quyền cập nhật hồ sơ này.';
    if (error.status >= 500) return 'Máy chủ chưa thể lưu dữ liệu. Vui lòng thử lại.';
    return 'Thông tin chưa hợp lệ. Hãy kiểm tra lại các trường được đánh dấu.';
  }
  return 'Không thể kết nối để lưu hồ sơ. Vui lòng thử lại.';
}

function FormField({
  label, value, onChangeText, placeholder, inputMode = 'text', error,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  inputMode?: 'text' | 'numeric' | 'decimal';
  error?: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={ui.label}>{label}</Text>
      <View style={[ui.inputBox, styles.fieldBox, !!error && styles.fieldInvalid]}>
        <TextInput
          accessibilityLabel={label}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.muted}
          inputMode={inputMode}
          autoCapitalize="none"
          style={ui.input}
        />
      </View>
      {!!error && <Text style={styles.fieldError}>{error}</Text>}
    </View>
  );
}

function ChoiceGroup<T extends string>({
  label, options, value, onChange,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.field}>
      <Text style={ui.label}>{label}</Text>
      <View style={styles.choices}>
        {options.map(option => {
          const selected = value === option.value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              onPress={() => onChange(option.value)}
              style={[styles.choice, selected && styles.choiceSelected]}>
              <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function entryId() {
  return `weight-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export default function PersonalProfileScreen() {
  const { session, updateDisplayName } = useSession();
  const activeUser = session.status === 'active' ? session.user : null;
  const insets = useSafeAreaInsets();
  const [profile, setProfile] = useState<PersonalProfile | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirmedWarning, setConfirmedWarning] = useState(false);
  const [message, setMessage] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});

  useEffect(() => {
    if (!activeUser) return;
    let active = true;
    loadProfile(activeUser).then(result => {
      if (!active) return;
      setProfile(result);
      setDraft(toDraft(result));
      updateDisplayName(result.displayName.trim() || null);
    }).catch(error => {
      if (active) setMessage(errorMessage(error));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [activeUser, updateDisplayName]);

  const warningNeeded = useMemo(() => {
    if (!draft) return false;
    const heightCm = numericValue(draft.height);
    const displayedWeight = numericValue(draft.weight);
    const weightKg = displayedWeight === null ? null
      : displayedWeight / (draft.units.weight === 'lb' ? 2.2046226218 : 1);
    const heightChanged = heightCm !== null && Number.isFinite(heightCm)
      && Math.abs(heightCm * (draft.units.height === 'in' ? 2.54 : 1) - (profile?.heightCm ?? 0)) > heightEpsilonCm;
    const weightChanged = weightKg !== null && Number.isFinite(weightKg)
      && Math.abs(weightKg - (profile?.currentWeightKg ?? 0)) > weightEpsilonKg;
    const heightOutOfRange = heightChanged
      && (heightCm! * (draft.units.height === 'in' ? 2.54 : 1) < 50
        || heightCm! * (draft.units.height === 'in' ? 2.54 : 1) > 250);
    const weightOutOfRange = weightChanged && weightKg! > 0 && (weightKg! < 20 || weightKg! > 300);
    return heightOutOfRange || weightOutOfRange;
  }, [draft, profile]);

  if (session.status !== 'active') return null;

  async function reload() {
    if (session.status !== 'active') return;
    setLoading(true);
    setMessage('');
    try {
      const result = await loadProfile(session.user);
      setProfile(result);
      setDraft(toDraft(result));
      setErrors({});
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    if (!profile || !draft || session.status !== 'active' || saving) return;
    const nextErrors: FieldErrors = {};
    const name = draft.displayName.trim();
    const nameLength = Array.from(name).length;
    if (nameLength < 1 || nameLength > 100) nextErrors.displayName = 'Tên hiển thị cần từ 1 đến 100 ký tự.';
    if (draft.birthDate && !validDate(draft.birthDate)) nextErrors.birthDate = 'Nhập ngày hợp lệ theo dạng YYYY-MM-DD, không ở tương lai.';
    if (draft.birthYear && (!/^\d{1,4}$/.test(draft.birthYear)
        || Number(draft.birthYear) < 1 || Number(draft.birthYear) > new Date().getFullYear())) {
      nextErrors.birthYear = 'Nhập năm sinh hợp lệ, không ở tương lai.';
    }
    if (draft.birthDate && draft.birthYear
        && Number(draft.birthDate.slice(0, 4)) !== Number(draft.birthYear)) {
      nextErrors.birthYear = 'Ngày sinh và năm sinh không khớp.';
    }
    const height = numericValue(draft.height);
    const heightCm = height === null ? null : height * (draft.units.height === 'in' ? 2.54 : 1);
    if (height !== null && (!Number.isFinite(heightCm) || heightCm! <= 0)) nextErrors.height = 'Chiều cao phải là số lớn hơn 0.';
    const weight = numericValue(draft.weight);
    const weightKg = weight === null ? null : weight / (draft.units.weight === 'lb' ? 2.2046226218 : 1);
    if (weight !== null && (!Number.isFinite(weightKg) || weightKg! <= 0)) nextErrors.weight = 'Cân nặng phải là số lớn hơn 0.';
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: draft.timeZone }).format();
    } catch {
      nextErrors.timeZone = 'Nhập múi giờ IANA hợp lệ, ví dụ Asia/Ho_Chi_Minh.';
    }
    if (warningNeeded && !confirmedWarning) nextErrors.form = 'Hãy xác nhận số đo nằm ngoài khoảng cảnh báo.';
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      setMessage('');
      return;
    }

    const patch: Parameters<typeof updateProfile>[1] = { version: profile.version };
    if (name !== profile.displayName) patch.displayName = name;
    const birthDateChanged = draft.birthDate !== (profile.birthDate ?? '');
    const birthYearChanged = draft.birthYear !== (profile.birthYear?.toString() ?? '');
    if (draft.birthDate && birthDateChanged) {
      patch.birthDate = draft.birthDate;
      patch.birthYear = null;
    } else if (draft.birthYear && birthYearChanged) {
      patch.birthYear = draft.birthYear ? Number(draft.birthYear) : null;
      patch.birthDate = null;
    } else if (birthDateChanged) {
      patch.birthDate = null;
    } else if (birthYearChanged) {
      patch.birthYear = null;
    }
    const originalHeightCm = profile.heightCm;
    if ((heightCm === null ? originalHeightCm !== null
      : originalHeightCm === null || Math.abs(heightCm - originalHeightCm) > heightEpsilonCm)) {
      patch.heightCm = heightCm;
    }
    if (draft.activityLevel !== profile.activityLevel) patch.activityLevel = draft.activityLevel;
    const unitChanges: Partial<PreferredUnits> = {};
    if (draft.units.weight !== profile.preferredUnits.weight) unitChanges.weight = draft.units.weight;
    if (draft.units.height !== profile.preferredUnits.height) unitChanges.height = draft.units.height;
    if (draft.units.water !== profile.preferredUnits.water) unitChanges.water = draft.units.water;
    if (Object.keys(unitChanges).length > 0) patch.preferredUnits = unitChanges;
    if (draft.timeZone !== profile.timeZone) patch.timeZone = draft.timeZone;
    const heightChanged = heightCm === null ? profile.heightCm !== null
      : profile.heightCm === null || Math.abs(heightCm - profile.heightCm) > heightEpsilonCm;
    const heightOutOfRange = heightChanged && heightCm !== null && (heightCm < 50 || heightCm > 250);
    if (heightOutOfRange) patch.warningConfirmed = true;

    const weightChanged = weightKg !== null && (profile.currentWeightKg === null
      || Math.abs(weightKg - profile.currentWeightKg) > weightEpsilonKg);
    setSaving(true);
    setMessage('');
    setErrors({});
    let savedProfile = profile;
    try {
      if (Object.keys(patch).some(key => key !== 'version' && key !== 'warningConfirmed')) {
        savedProfile = await updateProfile(session.user, patch);
        setProfile(savedProfile);
        updateDisplayName(savedProfile.displayName.trim() || null);
      }
      if (weightChanged) {
        await addWeightMeasurement(session.user, {
          entryId: entryId(),
          weightKg,
          measuredAt: new Date().toISOString(),
          timeZone: draft.timeZone,
          ...(warningNeeded ? { warningConfirmed: true } : {}),
        });
        savedProfile = { ...savedProfile, currentWeightKg: weightKg };
      }
      setProfile(savedProfile);
      setDraft(toDraft(savedProfile));
      setConfirmedWarning(false);
      setMessage('Đã lưu hồ sơ cá nhân.');
    } catch (error) {
      setMessage(weightChanged && savedProfile !== profile
        ? 'Thông tin hồ sơ đã lưu, nhưng chưa lưu được cân nặng. Hãy thử lưu lại.'
        : errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  function setField<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft(current => current ? { ...current, [key]: value } : current);
    setErrors(current => ({ ...current, [key]: undefined, form: undefined }));
    if (key === 'height' || key === 'weight' || key === 'units') setConfirmedWarning(false);
  }

  return (
    <SafeAreaView style={ui.page} edges={['left', 'right']}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={[ui.content, {
        paddingTop: Math.max(insets.top, 24) + 10, paddingBottom: Math.max(insets.bottom, 24) + 20,
      }]}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.back}>
          <Text style={styles.backText}>‹ Tài khoản</Text>
        </Pressable>
        <Text style={styles.eyebrow}>HỒ SƠ CỦA BẠN</Text>
        <Text accessibilityRole="header" style={styles.title}>Thông tin cá nhân</Text>
        <Text style={styles.subtitle}>Thông tin này giúp Life Tracker theo dõi và phân tích thói quen sinh hoạt của bạn.</Text>

        {loading ? (
          <View style={styles.loading}><ActivityIndicator color={colors.primary} /><Text style={styles.helper}>Đang tải hồ sơ...</Text></View>
        ) : !draft || !profile ? (
          <View style={styles.card}>
            <Text style={styles.message}>{message || 'Chưa thể tải hồ sơ cá nhân.'}</Text>
            <Pressable accessibilityRole="button" onPress={reload} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>Thử lại</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Thông tin cơ bản</Text>
              <FormField label="Tên hiển thị" value={draft.displayName} onChangeText={value => setField('displayName', value)}
                placeholder="Tên bạn muốn sử dụng" error={errors.displayName} />
              <FormField label="Ngày sinh" value={draft.birthDate} onChangeText={value => {
                setField('birthDate', value);
                if (value) setField('birthYear', '');
              }} placeholder="YYYY-MM-DD" error={errors.birthDate} />
              <FormField label="Hoặc chỉ nhập năm sinh" value={draft.birthYear} onChangeText={value => {
                setField('birthYear', value);
                if (value) setField('birthDate', '');
              }} placeholder="VD: 1995" inputMode="numeric" error={errors.birthYear} />
              <FormField label={`Chiều cao (${draft.units.height})`} value={draft.height}
                onChangeText={value => setField('height', value)} placeholder={draft.units.height === 'cm' ? 'VD: 170' : 'VD: 67'}
                inputMode="decimal" error={errors.height} />
              <FormField label={`Cân nặng hiện tại (${draft.units.weight})`} value={draft.weight}
                onChangeText={value => setField('weight', value)} placeholder={draft.units.weight === 'kg' ? 'VD: 65' : 'VD: 143'}
                inputMode="decimal" error={errors.weight} />
              <Text style={styles.helper}>Số đo cân nặng mới được thêm vào lịch sử, không ghi đè các lần đo trước.</Text>
              <View style={styles.field}>
                <Text style={ui.label}>Mức độ vận động</Text>
                <View style={styles.activityList}>
                  {activities.map(item => {
                    const selected = draft.activityLevel === item.value;
                    return (
                      <Pressable key={item.value} accessibilityRole="radio" accessibilityState={{ checked: selected }}
                        onPress={() => setField('activityLevel', item.value)}
                        style={[styles.activity, selected && styles.activitySelected]}>
                        <View style={styles.activityCopy}>
                          <Text style={[styles.activityTitle, selected && styles.choiceTextSelected]}>{item.label}</Text>
                          <Text style={styles.helper}>{item.note}</Text>
                        </View>
                        <View style={[styles.radio, selected && styles.radioSelected]} />
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Đơn vị và múi giờ</Text>
              <ChoiceGroup label="Cân nặng" options={[{ value: 'kg', label: 'kg' }, { value: 'lb', label: 'lb' }]}
                value={draft.units.weight} onChange={value => {
                  const amount = numericValue(draft.weight);
                  const kg = amount === null ? null : amount / (draft.units.weight === 'lb' ? 2.2046226218 : 1);
                  setField('units', { ...draft.units, weight: value });
                  if (kg !== null) setField('weight', displayNumber(kg * (value === 'lb' ? 2.2046226218 : 1)));
                }} />
              <ChoiceGroup label="Chiều cao" options={[{ value: 'cm', label: 'cm' }, { value: 'in', label: 'in' }]}
                value={draft.units.height} onChange={value => {
                  const amount = numericValue(draft.height);
                  const cm = amount === null ? null : amount * (draft.units.height === 'in' ? 2.54 : 1);
                  setField('units', { ...draft.units, height: value });
                  if (cm !== null) setField('height', displayNumber(cm / (value === 'in' ? 2.54 : 1)));
                }} />
              <ChoiceGroup label="Thể tích nước" options={[{ value: 'mL', label: 'mL' }, { value: 'L', label: 'L' }]}
                value={draft.units.water} onChange={value => setField('units', { ...draft.units, water: value })} />
              <FormField label="Múi giờ" value={draft.timeZone} onChangeText={value => setField('timeZone', value)}
                placeholder="Asia/Ho_Chi_Minh" error={errors.timeZone} />
              <Text style={styles.helper}>Dùng tên múi giờ IANA. Thay đổi chỉ áp dụng cho dữ liệu và lịch mới.</Text>
            </View>

            {!!warningNeeded && (
              <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: confirmedWarning }}
                onPress={() => setConfirmedWarning(value => !value)} style={styles.warning}>
                <View style={[styles.checkbox, confirmedWarning && styles.checkboxChecked]}>
                  {confirmedWarning && <Text style={styles.checkmark}>✓</Text>}
                </View>
                <Text style={styles.warningText}>Tôi xác nhận số đo nằm ngoài khoảng cảnh báo và muốn lưu.</Text>
              </Pressable>
            )}
            {!!errors.form && <Text style={styles.formError}>{errors.form}</Text>}
            {!!message && <Text accessibilityRole="alert" style={[styles.message, message === 'Đã lưu hồ sơ cá nhân.' && styles.successMessage]}>{message}</Text>}
            <Pressable accessibilityRole="button" accessibilityState={{ disabled: saving, busy: saving }}
              disabled={saving} onPress={save} style={[ui.button, saving && ui.disabledButton]}>
              {saving ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={ui.buttonText}>Lưu thông tin</Text>}
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  back: { minHeight: 34, justifyContent: 'center', alignSelf: 'flex-start', marginBottom: 21 },
  backText: { color: colors.link, fontFamily: 'Roboto_700Bold', fontSize: 14 },
  eyebrow: { color: colors.muted, fontFamily: 'Roboto_700Bold', fontSize: 11, letterSpacing: 1.1 },
  title: { marginTop: 7, color: colors.ink, fontFamily: 'Roboto_700Bold', fontSize: 28, lineHeight: 36 },
  subtitle: { marginTop: 7, marginBottom: 20, color: colors.muted, fontFamily: 'Roboto_400Regular', fontSize: 14, lineHeight: 21 },
  card: { marginBottom: 16, padding: 16, gap: 15, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.divider, borderRadius: 16 },
  sectionTitle: { color: colors.ink, fontFamily: 'Roboto_700Bold', fontSize: 16, lineHeight: 23 },
  field: { gap: 6 },
  fieldBox: { marginTop: 0 },
  fieldInvalid: { borderColor: colors.error },
  fieldError: { color: colors.error, fontFamily: 'Roboto_400Regular', fontSize: 12, lineHeight: 17 },
  helper: { color: colors.muted, fontFamily: 'Roboto_400Regular', fontSize: 12, lineHeight: 17 },
  activityList: { gap: 7 },
  activity: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: colors.divider, borderRadius: 12 },
  activitySelected: { borderColor: colors.primary, backgroundColor: colors.pale },
  activityCopy: { flex: 1, gap: 2 },
  activityTitle: { color: colors.ink, fontFamily: 'Roboto_700Bold', fontSize: 13, lineHeight: 18 },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 1, borderColor: colors.border },
  radioSelected: { borderWidth: 5, borderColor: colors.primary },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { minHeight: 38, minWidth: 58, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.paper },
  choiceSelected: { borderColor: colors.primary, backgroundColor: colors.pale },
  choiceText: { color: colors.muted, fontFamily: 'Roboto_700Bold', fontSize: 13 },
  choiceTextSelected: { color: colors.primary },
  warning: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 13, borderRadius: 12, backgroundColor: '#FFF7E8' },
  checkbox: { width: 20, height: 20, borderWidth: 1, borderColor: colors.muted, borderRadius: 5, alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkmark: { color: colors.onPrimary, fontSize: 13, lineHeight: 16 },
  warningText: { flex: 1, color: colors.ink, fontFamily: 'Roboto_400Regular', fontSize: 13, lineHeight: 19 },
  formError: { color: colors.error, fontFamily: 'Roboto_400Regular', fontSize: 13, lineHeight: 18 },
  message: { marginBottom: 12, color: colors.error, fontFamily: 'Roboto_400Regular', fontSize: 13, lineHeight: 19 },
  successMessage: { color: colors.primary },
  loading: { minHeight: 180, alignItems: 'center', justifyContent: 'center', gap: 10 },
  secondaryButton: { minHeight: 42, borderWidth: 1, borderColor: colors.border, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  secondaryButtonText: { color: colors.link, fontFamily: 'Roboto_700Bold', fontSize: 14 },
});

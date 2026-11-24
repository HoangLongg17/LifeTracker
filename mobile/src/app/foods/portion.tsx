import { router, useLocalSearchParams, usePreventRemove } from 'expo-router';
import type { User } from 'firebase/auth';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import type { MealDraft, MealEditor, MealType, MealWarning, PortionItem } from '../../../../shared/food';
import { AccountButton, accountStyles as ui, colors, ErrorMessage } from '@/components/account-ui';
import { FoodError, FoodLink, LoadingFood, f, foodErrorMessage } from '@/components/food-ui';
import { JournalBack, JournalDialog, JournalIcon, JournalPage, j } from '@/components/journal-ui';
import { useSession } from '@/hooks/use-session';
import { calculatePortion, getFood, getMealEditor, saveMeal } from '@/services/foods';
import { loadProfile } from '@/services/profile';
import { AccountRequestError } from '@/services/session';
import {
  basisText, mealLabels, numberText, nutrientLabels, nutrientText, permittedUnits, portionText, readPortion,
  type Food, type FoodUnit, type PortionInput,
} from '@/utils/food';
import { dayKey, displayDate, instant, normalizeTime, wallTime } from '@/utils/journal-time';

type Preview = Awaited<ReturnType<typeof calculatePortion>>;
type Estimate = { key: string; result?: Preview; error?: string; reloadEntry?: boolean };
const warningText: Record<MealWarning, string> = {
  HIGH_PORTION_MASS: 'Lượng thực phẩm vượt 5.000 g.',
  HIGH_MEAL_ENERGY: 'Năng lượng bữa này vượt 3.500 kcal.',
  HIGH_DAY_ENERGY: 'Tổng năng lượng đã ghi trong ngày sẽ vượt 15.000 kcal.',
};

function estimateError(error: unknown) {
  if (error instanceof AccountRequestError) {
    if (error.code === 'VERSION_CONFLICT') return 'Bữa ăn đã được chỉnh sửa. Tải lại bản ghi để tiếp tục.';
    if (error.code === 'ENTRY_NOT_FOUND') return 'Bữa ăn này đã được xóa khỏi Nhật ký.';
    if (error.status === 400) {
      const detail = error.body as { error?: { message?: string } } | null;
      return detail?.error?.message || 'Hãy kiểm tra lượng và đơn vị đã nhập.';
    }
    if (error.status === 404) return 'Thực phẩm hoặc tài khoản hiện không có để tính khẩu phần.';
    if (error.status === 401 || error.status === 403) return 'Phiên truy cập không còn hợp lệ. Vui lòng đăng nhập lại.';
  }
  return 'Chưa tính được dinh dưỡng. Kiểm tra kết nối rồi thử lại.';
}

function useEstimate(user: User, items: PortionItem[] | null, edit?: MealEditor) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<Estimate>();
  const key = JSON.stringify([user.uid, items, edit?.entryId, edit?.version, attempt]);
  useEffect(() => {
    if (!items) return;
    let active = true;
    const timer = setTimeout(() => {
      calculatePortion(user, items, edit).then(result => {
        if (active) setState({ key, result });
      }).catch(error => {
        if (active) setState({ key, error: estimateError(error), reloadEntry: error instanceof AccountRequestError && error.code === 'VERSION_CONFLICT' });
      });
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [user, items, edit, key]);
  return { current: items && state?.key === key ? state : undefined, retry: () => setAttempt(n => n + 1) };
}

function EstimateCard({ state, input, invalid, retry }: { state?: Estimate; input: boolean; invalid: boolean; retry: () => void }) {
  const result = state?.result;
  return <View style={[f.info, f.block]} accessibilityLiveRegion="polite">
    <Text accessibilityRole="header" style={j.section}>Dinh dưỡng ước tính</Text>
    {result ? <>
      <Text style={[j.heading, { color: colors.primary, fontSize: 28 }]}>{portionText(result.totals.energyKcal, 'kcal')}</Text>
      {nutrientLabels.slice(1).map(([name, label, suffix]) =>
        <View style={f.nutrientRow} key={name}><Text style={j.text}>{label}</Text>
          <Text style={j.strong}>{portionText(result.totals[name], suffix)}</Text></View>)}
      {result.warnings.length > 0 && <Text style={j.strong} accessibilityRole="alert">
        {result.warnings.map(w => warningText[w]).join(' ')} Hãy kiểm tra lại lượng đã nhập.</Text>}
    </> : state?.error ? <><ErrorMessage message={state.error} /><FoodLink label={state.reloadEntry ? 'Tải lại bản ghi' : 'Thử tính lại'} onPress={retry} /></>
      : <Text style={j.text}>{invalid ? 'Chưa tính được khi khẩu phần chưa hợp lệ.'
        : input ? 'Đang tính dinh dưỡng…' : 'Nhập lượng thực dùng để xem kết quả.'}</Text>}
  </View>;
}

function MealMoment({ selected, time, date, zone, close, apply }: {
  selected: MealType; time: string; date: string; zone: string; close: () => void; apply: (type: MealType, time: string) => void;
}) {
  const [type, setType] = useState(selected);
  const [clock, setClock] = useState(time);
  const [error, setError] = useState('');
  function accept() {
    const formatted = normalizeTime(clock);
    const stamp = formatted && instant({ date, time: formatted }, zone);
    if (!formatted || !stamp) { setError('Nhập giờ hợp lệ theo HH:mm.'); return; }
    if (Date.parse(stamp) > Date.now() + 300000) { setError('Giờ ăn đã nhập ở tương lai.'); return; }
    apply(type, formatted);
  }
  return <JournalDialog title="Bữa ăn và giờ ghi nhận" onClose={close}>
    <Text style={j.small}>{displayDate(date)} · {zone}</Text>
    <View accessibilityRole="radiogroup" style={[f.inline, { flexWrap: 'wrap' }]}>
      {(Object.keys(mealLabels) as MealType[]).map(option => <Pressable key={option} accessibilityRole="radio"
        aria-checked={type === option} accessibilityState={{ checked: type === option }}
        style={[f.chip, type === option && f.selected]} onPress={() => setType(option)}><Text style={j.strong}>{mealLabels[option]}</Text></Pressable>)}
    </View>
    <Text style={ui.label}>Giờ ăn</Text>
    <View style={ui.inputBox}><TextInput accessibilityLabel="Giờ ăn" value={clock} onChangeText={v => { setClock(v); setError(''); }}
      placeholder="HH:mm" keyboardType="numbers-and-punctuation" maxLength={5} style={ui.input} /></View>
    {!!error && <ErrorMessage message={error} />}
    <AccountButton label="Áp dụng" onPress={accept} /><AccountButton outline label="Đóng" onPress={close} />
  </JournalDialog>;
}

type LineField = { food: Food; savedFood?: Food; initial?: PortionInput; unit: FoodUnit; text: string };

function enteredAmount(input: PortionInput) {
  if (input.quantity !== undefined) return { unit: 'serving' as const, value: input.quantity };
  if (input.consumedMl !== undefined) return { unit: 'mL' as const, value: input.consumedMl };
  return { unit: 'g' as const, value: input.consumedGrams };
}

function originalAmount(line: LineField) {
  if (!line.initial) return false;
  const saved = enteredAmount(line.initial);
  return saved.unit === line.unit && Number(line.text.trim().replace(',', '.')) === saved.value;
}

function lineFood(line: LineField) {
  return line.savedFood && originalAmount(line) ? line.savedFood : line.food;
}

function PortionForm({ initialFood, user, date, zone, edit, reload }: {
  initialFood: Food; user: User; date: string; zone: string; edit?: MealEditor; reload: () => void;
}) {
  const [lines, setLines] = useState<LineField[]>(() => edit ? edit.lines.map(line => {
    const { unit, value } = enteredAmount(line.input);
    return { food: line.currentFood ?? line.food, savedFood: line.food, initial: line.input, unit, text: String(value).replace('.', ',') };
  }) : [{ food: initialFood, unit: initialFood.referenceUnit, text: '' }]);
  const [selected, setSelected] = useState(0);
  const line = lines[selected];
  const food = lineFood(line);
  const unit = line.unit;
  const value = line.text;
  const units = [...new Set([...permittedUnits(food), ...permittedUnits(line.food)])];
  const [touched, setTouched] = useState(false);
  const [focused, setFocused] = useState(false);
  function editLine(values: Partial<LineField>) {
    setLines(before => before.map((row, i) => i === selected ? { ...row, ...values } : row));
  }
  const items = useMemo(() => {
    const result: PortionItem[] = [];
    for (const row of lines) {
      const amount = readPortion(row.text, row.unit, lineFood(row));
      if (!amount) return null;
      result.push({ foodId: row.food.foodId, ...amount });
    }
    return result;
  }, [lines]);
  const { current, retry } = useEstimate(user, items, edit);
  const invalid = !readPortion(value, unit, food) && (touched || value.trim() !== '');
  const label = unit === 'serving' ? 'Số phần thực dùng' : unit === 'mL' ? 'Thể tích thực dùng' : 'Khối lượng thực dùng';
  const [mealType, setMealType] = useState<MealType>(edit?.mealType ?? 'snack');
  const [opened] = useState(() => edit?.loggedAt ?? new Date().toISOString());
  const initialTime = wallTime(opened, zone).time;
  const [time, setTime] = useState(initialTime);
  const [entryId] = useState(() => edit?.entryId ?? 'meal-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2));
  const dirty = edit ? mealType !== edit.mealType || time !== initialTime || lines.some(row => !originalAmount(row)) : !!value.trim();
  const [momentOpen, setMomentOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<MealDraft | null>(null);
  const [warning, setWarning] = useState<{ draft: MealDraft; codes: MealWarning[] } | null>(null);
  const [changedFood, setChangedFood] = useState(false);
  const [message, setMessage] = useState('');
  const [staleEntry, setStaleEntry] = useState(false);
  const [savedDay, setSavedDay] = useState('');
  const [leaving, setLeaving] = useState(false);
  const nextAction = useRef<() => void>(() => {});
  const busy = useRef(false);
  const alive = useRef(true);
  const locked = saving || !!pending || !!savedDay;
  const needsRefresh = changedFood || !!current?.result?.items.some((record, i) => record.foodVersion !== lineFood(lines[i]).version);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  usePreventRemove(!savedDay && (dirty || !!pending), ({ repeat }) => {
    if (busy.current) return;
    nextAction.current = repeat;
    setLeaving(true);
  });
  useEffect(() => {
    if (savedDay) router.dismissTo({ pathname: '/journal', params: { date: savedDay, notice: edit ? 'Đã cập nhật bữa ăn.' : 'Đã lưu bữa ăn.', savedAmount: '', savedTime: '', edited: '' } });
  }, [savedDay, edit]);

  async function refreshFood() {
    setMessage('');
    try {
      const updated = await Promise.all(lines.map(async row => {
        if (edit && originalAmount(row)) return row;
        const fresh = await getFood(user, row.food.foodId);
        return permittedUnits(fresh).includes(row.unit) ? { ...row, food: fresh } : { ...row, food: fresh, unit: fresh.referenceUnit, text: '' };
      }));
      if (!alive.current) return;
      setLines(updated); setTouched(false); setChangedFood(false); retry();
    } catch (error) { if (alive.current) setMessage(foodErrorMessage(error)); }
  }

  async function submit(confirmed?: MealDraft) {
    if (busy.current || savedDay || (!pending && needsRefresh)) return;
    let draft = confirmed ?? pending;
    if (!draft) {
      const loggedAt = instant({ date, time }, zone, opened);
      if (!items || !current?.result || !loggedAt || (edit && !dirty)) return;
      draft = { entryId, timeZone: zone, loggedAt, mealType, items, previewTag: current.result.previewTag };
    }
    busy.current = true; setSaving(true); setWarning(null); setMessage('');
    try {
      const storedDay = await saveMeal(user, draft, edit?.version);
      if (alive.current) { setPending(null); setSavedDay(storedDay); }
    } catch (error) {
      if (!alive.current) return;
      if (!(error instanceof AccountRequestError) || error.status >= 500) {
        setPending(draft);
        setMessage('Chưa nhận được xác nhận lưu. Nhấn Thử lưu lại để kiểm tra cùng bản ghi.');
      } else {
        setPending(null);
        if (error.code === 'WARNING_CONFIRMATION_REQUIRED') {
          const body = error.body as { warnings: MealWarning[] };
          setWarning({ draft, codes: body.warnings });
        } else if (error.code === 'FOOD_CHANGED' || error.code === 'FOOD_NOT_FOUND') {
          setChangedFood(true);
        } else if (error.code === 'VERSION_CONFLICT' || error.code === 'ENTRY_NOT_FOUND') {
          setStaleEntry(true); setMessage(estimateError(error));
        } else if (error.status === 401 || error.status === 403) setMessage('Phiên truy cập hiện không thể lưu bữa ăn. Vui lòng kiểm tra tài khoản.');
        else if (error.code === 'ENTRY_ID_CONFLICT' || error.code === 'ENTRY_ALREADY_DELETED') setMessage('Mã bữa ăn này đã được sử dụng. Hãy quay về Nhật ký để kiểm tra.');
        else if (error.code === 'FUTURE_TIME') setMessage('Hãy chọn ngày và giờ ăn đã qua.');
        else setMessage('Chưa lưu được bữa ăn. Vui lòng kiểm tra lại thông tin.');
      }
    } finally { busy.current = false; if (alive.current) setSaving(false); }
  }

  return <JournalPage footer={<View style={{ gap: 8 }}>
    {!!message && <ErrorMessage message={message} />}
    {staleEntry && <FoodLink label="Tải lại bản ghi" onPress={reload} />}
    {needsRefresh && !pending && <>
      <ErrorMessage message="Danh mục đã thay đổi. Cập nhật thực phẩm và kiểm tra lại khẩu phần." />
      <FoodLink label="Cập nhật thực phẩm" onPress={refreshFood} />
    </>}
    <AccountButton label={pending ? 'Thử lưu lại' : edit ? 'Lưu thay đổi' : 'Lưu bữa ăn'} onPress={() => { void submit(); }} busy={saving}
      disabled={!!savedDay || staleEntry || (!pending && (needsRefresh || !current?.result || (!!edit && !dirty)))} />
  </View>}>
    <JournalBack />
    <View style={{ marginTop: 12 }}>
      <Pressable disabled={locked} accessibilityRole="button" accessibilityLabel="Đổi bữa ăn và giờ ghi nhận"
        onPress={() => setMomentOpen(true)} style={[f.inline, { alignSelf: 'flex-start', minHeight: 32 }]}>
        <Text style={j.eyebrow}>{mealLabels[mealType]} · {displayDate(date)}, {time}</Text><JournalIcon name="chevron" size={12} />
      </Pressable>
      <Text accessibilityRole="header" style={j.heading}>{edit ? 'Chỉnh sửa bữa ăn' : 'Khẩu phần bữa ăn'}</Text>
    </View>
    {lines.length > 1 && <View accessibilityRole="radiogroup" style={[f.inline, { flexWrap: 'wrap' }]}>
      {lines.map((row, i) => <Pressable key={i} disabled={locked} accessibilityRole="radio" aria-checked={selected === i}
        accessibilityState={{ checked: selected === i }} style={[f.chip, selected === i && f.selected]}
        onPress={() => { setSelected(i); setTouched(false); }}><Text style={j.strong}>{row.food.foodName}</Text></Pressable>)}
    </View>}
    <View style={[j.card, f.block]}><Text style={j.section}>{food.foodName}</Text>
      <Text style={j.small}>{food.foodState || 'Chưa rõ trạng thái'} · {food.foodSource}</Text>
      <Text style={j.small}>{food.energyKcal === null ? 'Chưa có dữ liệu năng lượng' : nutrientText(food.energyKcal, 'kcal')} / {basisText(food)}</Text></View>
    <View style={f.block}>
      {units.length > 1 && <View accessibilityRole="radiogroup" style={f.inline}>
        {units.map(option => <Pressable key={option} disabled={locked} accessibilityRole="radio" aria-checked={option === unit} accessibilityState={{ checked: option === unit }}
          style={[f.chip, option === unit && f.selected]} onPress={() => {
            if (option !== unit) { editLine({ unit: option, text: '' }); setTouched(false); setMessage(''); }
          }}><Text style={j.strong}>{option === 'serving' ? 'Phần' : option}</Text></Pressable>)}
      </View>}
      <Text style={ui.label}>{label}</Text>
      <View style={[ui.inputBox, { marginTop: 0 }, focused && { borderColor: colors.primary, borderWidth: 2 }, invalid && { borderColor: colors.error, borderWidth: 2 }]}>
        <TextInput accessibilityLabel={label} editable={!locked} keyboardType="decimal-pad" placeholder="Nhập số lượng" placeholderTextColor={colors.muted}
          style={[ui.input, { outlineWidth: 0 }]} value={value} onChangeText={v => { editLine({ text: v }); setMessage(''); }}
          onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); setTouched(true); }} maxLength={20} />
        <Text style={j.small}>{unit === 'serving' ? 'phần' : unit}</Text></View>
      {invalid && <ErrorMessage message={'Nhập ' + label.toLowerCase() + ' lớn hơn 0' + (unit === 'serving' ? '.' : ' ' + unit + '.')} />}
      {unit === 'serving' && <Text style={j.small}>Một phần · {food.servingLabel || 'Phần theo nguồn'} · {numberText(food.servingSize!)} {food.servingUnit}</Text>}
    </View>
    <EstimateCard state={current} input={!!items} invalid={invalid} retry={current?.reloadEntry ? reload : retry} />
    {momentOpen && <MealMoment selected={mealType} time={time} date={date} zone={zone} close={() => setMomentOpen(false)}
      apply={(type, clock) => { setMealType(type); setTime(clock); setMomentOpen(false); setMessage(''); }} />}
    {warning && <JournalDialog title="Kiểm tra lại khẩu phần" onClose={() => setWarning(null)}>
      {warning.codes.map(code => <Text key={code} style={j.text}>{warningText[code]}</Text>)}
      <AccountButton label="Xác nhận lưu" onPress={() => { void submit({ ...warning.draft, warningConfirmed: true }); }} />
      <AccountButton label="Sửa khẩu phần" outline onPress={() => setWarning(null)} />
    </JournalDialog>}
    {leaving && <JournalDialog title="Rời màn khẩu phần?" onClose={() => setLeaving(false)}>
      <Text style={j.text}>{pending ? 'Chưa nhận được xác nhận lưu. Bạn có thể kiểm tra bản ghi trong Nhật ký.' : 'Khẩu phần đang nhập chưa được lưu.'}</Text>
      <AccountButton label="Tiếp tục nhập" onPress={() => setLeaving(false)} />
      <AccountButton label="Rời màn hình" outline onPress={() => { setLeaving(false); nextAction.current(); }} />
    </JournalDialog>}
  </JournalPage>;
}

export default function FoodPortion() {
  const params = useLocalSearchParams<{ foodId?: string; date?: string; editId?: string }>();
  const { session } = useSession();
  const user = session.status === 'active' ? session.user : null;
  const [attempt, setAttempt] = useState(0);
  const [boot, setBoot] = useState<{ key: string; food?: Food; zone?: string; date?: string; edit?: MealEditor; error?: string }>();
  const { foodId, editId, date } = params;
  const key = JSON.stringify([user?.uid, foodId, editId, date, attempt]);
  useEffect(() => {
    if (!user || (!foodId && !editId)) return;
    let active = true;
    const request = editId ? getMealEditor(user, editId).then(edit => ({
      food: edit.lines[0].food, zone: edit.timeZone, date: edit.localDate, edit,
    })) : Promise.all([getFood(user, foodId!), loadProfile(user)]).then(([food, profile]) => ({
      food, zone: profile.timeZone, date: dayKey(date ?? '') ?? dayKey(wallTime(Date.now(), profile.timeZone).date)!,
    }));
    request.then(result => { if (active) setBoot({ key, ...result }); })
      .catch(error => { if (active) setBoot({ key, error: editId ? estimateError(error) : foodErrorMessage(error) }); });
    return () => { active = false; };
  }, [user, foodId, editId, date, key]);
  const loaded = boot?.key === key ? boot : undefined;
  const reload = () => setAttempt(n => n + 1);
  if (user && loaded?.food && loaded.zone && loaded.date) {
    return <PortionForm key={key} initialFood={loaded.food} date={loaded.date} zone={loaded.zone} user={user} edit={loaded.edit} reload={reload} />;
  }
  return <JournalPage><JournalBack />{loaded?.error || (!foodId && !editId)
    ? <FoodError message={loaded?.error ?? 'Chưa chọn thực phẩm.'} retry={reload} /> : <LoadingFood />}</JournalPage>;
}

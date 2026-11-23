import Feather from '@expo/vector-icons/Feather';
import { router, useLocalSearchParams, usePreventRemove } from 'expo-router';
import type { User } from 'firebase/auth';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { AccountButton, accountStyles as ui, colors, ErrorMessage } from '@/components/account-ui';
import { FormHeading, j, JournalBack, JournalDialog, JournalIcon, JournalPage } from '@/components/journal-ui';
import { useSession } from '@/hooks/use-session';
import { loadProfile } from '@/services/profile';
import { AccountRequestError, apiRequest } from '@/services/session';
import { activities, isCrossTypeOverlap, journalError, readTimedEntry, saveTimedEntry, type ActivityType, type Kind, type TimedEntry, type TimedInput } from '@/services/timed-journal';
import { evaluate, initialDraft, type Draft } from '@/utils/journal-form';
import { dayKey, displayDate, durationText, normalizeTime, type WallTime } from '@/utils/journal-time';

type Boot = { zone: string; entry?: TimedEntry; draft: Draft };
type Pending = { input: TimedInput; minutes: number };
const names = { activity: 'vận động', sleep: 'giấc ngủ' };

function Field({ name, error, children }: { name: string; error?: string; children: ReactNode }) {
  return <View><Text style={ui.label}>{name}</Text>
    <View style={[ui.inputBox, error && { borderColor: colors.error, borderWidth: 1.5 }]}>{children}</View>
    {!!error && <ErrorMessage message={error} />}</View>;
}
function MomentInputs({ label, value, change, locked, activity }: {
  label: string; value: WallTime; change: (next: WallTime) => void; locked: boolean; activity?: boolean;
}) {
  const date = <TextInput key="date" accessibilityLabel={'Ngày ' + label} editable={!locked} placeholder="DD/MM/YYYY" maxLength={10}
    value={value.date} onChangeText={date => change({ ...value, date })} style={[ui.input, { flex: 0, minWidth: 96 }]} />;
  const time = <TextInput key="time" accessibilityLabel={'Giờ ' + label} editable={!locked} placeholder="HH:mm" maxLength={5}
    value={value.time} onChangeText={time => change({ ...value, time })} onBlur={() => {
      const formatted = normalizeTime(value.time);
      if (formatted && formatted !== value.time) change({ ...value, time: formatted });
    }} style={[ui.input, { flex: 0, minWidth: 52 }]} />;
  return <>{activity ? time : date}<Text style={j.small}>·</Text>{activity ? date : time}</>;
}
function matchesSaved(entry: TimedEntry, input: TimedInput) {
  if (entry.timeZone !== input.timeZone) return false;
  if ('startedAt' in entry && 'startedAt' in input) return Date.parse(entry.startedAt) === Date.parse(input.startedAt) &&
    entry.durationMinutes === input.durationMinutes && entry.activityType === input.activityType;
  return 'sleepStart' in entry && 'sleepStart' in input && Date.parse(entry.sleepStart) === Date.parse(input.sleepStart) &&
    Date.parse(entry.sleepEnd) === Date.parse(input.sleepEnd);
}

function Editor({ kind, user, boot, reload }: { kind: Kind; user: User; boot: Boot; reload: () => void }) {
  const { zone, entry } = boot;
  const [id] = useState(() => entry?.entryId ?? kind + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2));
  const [draft, setDraft] = useState(boot.draft);
  const [submitted, setSubmitted] = useState(false);
  const [message, setMessage] = useState('');
  const [dialog, setDialog] = useState<'type' | 'long' | 'leave' | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [conflict, setConflict] = useState(false);
  const [completed, setCompleted] = useState<{ date: string; notice: string } | null>(null);
  const [preview, setPreview] = useState<{ key: string; total: number | null; overlap?: string; activityOverlap?: boolean } | null>(null);
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const saving = useRef(false);
  const alive = useRef(true);
  const leave = useRef<() => void>(() => {});
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const check = useMemo(() => evaluate(kind, draft, zone, entry), [kind, draft, zone, entry]);
  const previewKey = check.input ? JSON.stringify(check.input) : '';
  useEffect(() => {
    if (!previewKey) return;
    let active = true;
    const timer = setTimeout(() => {
      apiRequest(user, '/me/logs/' + kind + '/preview', 'POST', { ...JSON.parse(previewKey), entryId: id })
        .then(result => {
          const data = result as { totalMinutes?: number; overlapStatus?: string } | null;
          const total = data?.totalMinutes;
          if (active) setPreview({
            key: previewKey, total: typeof total === 'number' && Number.isFinite(total) ? total : null,
            activityOverlap: data?.overlapStatus === 'needs_review',
          });
        }).catch(error => {
          if (active) setPreview({ key: previewKey, total: null, overlap: isCrossTypeOverlap(error) ? journalError(error, zone) : undefined });
        });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [user, id, kind, zone, previewKey, previewAttempt]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(boot.draft);
  usePreventRemove(!completed && (dirty || !!pending || busy), ({ repeat }) => {
    if (saving.current) return;
    leave.current = repeat; setDialog('leave');
  });
  useEffect(() => {
    if (completed) router.dismissTo({ pathname: '/journal', params: { ...completed, savedTime: '', savedAmount: '', edited: '' } });
  }, [completed]);

  function change(next: Partial<Draft>) { setDraft(value => ({ ...value, ...next })); setMessage(''); }
  function finish(day: string, item: Pending) {
    const desc = 'activityType' in item.input ? durationText(item.minutes) + ' ' + activities[item.input.activityType].toLocaleLowerCase('vi')
      : 'phiên ngủ ' + durationText(item.minutes);
    setPending(null); setCompleted({ date: day, notice: (entry ? 'Đã cập nhật ' : 'Đã lưu ') + desc + '.' });
  }
  async function save(confirmed = false) {
    if (saving.current || completed || conflict) return;
    setSubmitted(true); setDialog(null); setMessage('');
    const current = evaluate(kind, draft, zone, entry);
    if (!pending && (!current.input || current.minutes === undefined)) return;
    if (!pending && !confirmed && current.minutes! > (kind === 'activity' ? 360 : 1440)) { setDialog('long'); return; }
    const item = pending ?? { minutes: current.minutes!, input: { ...current.input!, ...(confirmed ? { warningConfirmed: true } : {}) } };
    saving.current = true; setBusy(true);
    try {
      const day = await saveTimedEntry(user, kind, id, item.input, entry?.version);
      if (alive.current) finish(day, item);
    } catch (err) {
      if (!alive.current) return;
      if (err instanceof AccountRequestError && err.status < 500) {
        if (pending && entry && err.code === 'VERSION_CONFLICT') {
          try {
            const stored = await readTimedEntry(user, kind, id);
            if (!alive.current) return;
            if (stored.version === entry.version + 1 && matchesSaved(stored, item.input)) { finish(stored.localDate, item); return; }
          } catch { /* Keep the original request available for another verification. */
            if (alive.current) setMessage('Chưa kiểm tra được lần lưu trước. Hãy thử lại.'); return;
          }
        }
        setPending(null);
        setConflict((err.status === 409 && !isCrossTypeOverlap(err)) || err.code === 'ENTRY_NOT_FOUND');
        setMessage(journalError(err, zone));
      } else {
        setPending(item); setMessage('Chưa xác nhận được kết quả lưu. Hãy thử lưu lại để kiểm tra cùng bản ghi.');
      }
    } finally { saving.current = false; if (alive.current) setBusy(false); }
  }
  const locked = busy || !!pending || conflict;
  const startError = submitted ? check.startError : undefined;
  const endError = submitted ? check.endError : undefined;
  const durationError = submitted ? check.durationError : undefined;
  const currentPreview = preview?.key === previewKey ? preview : null;
  const total = currentPreview?.total;
  const overlap = currentPreview?.overlap;
  const activityHint = currentPreview?.activityOverlap
    ? 'Trùng giờ với buổi vận động khác. Phần trùng chỉ tính một lần.'
    : 'Tổng thời lượng sau khi lưu.';
  const feedback = message || overlap;
  const summary = !check.input ? (kind === 'activity' ? 'Chờ thời lượng hợp lệ.' : 'Chờ hai mốc giờ hợp lệ.')
    : kind === 'sleep' ? durationText(check.minutes!) : overlap ? 'Khung giờ bị trùng' : total === null ? 'Chưa tải được tổng' : total === undefined ? 'Đang tính…' : durationText(total);
  const label = kind === 'sleep' ? 'Thời lượng phiên' : durationError ? 'Thời lượng đã ghi' : 'Vận động trong ngày';

  return <JournalPage footer={<View style={{ gap: 8 }}>{!!feedback && <ErrorMessage message={feedback} />}
    <AccountButton label={pending ? 'Thử lưu lại' : 'Lưu vào nhật ký'} busy={busy} disabled={conflict || (submitted && !check.input)} onPress={() => save()} /></View>}>
    <JournalBack /><FormHeading title={(entry ? 'Sửa ' : 'Ghi ') + names[kind]} date={(kind === 'activity' ? draft.start : draft.end).date} />
    <View style={{ gap: 22, marginTop: 32 }}>
      {kind === 'activity' && <Field name="Loại hoạt động"><JournalIcon name="activity" size={17} />
        <Pressable style={{ flex: 1, minHeight: 46, justifyContent: 'center' }} accessibilityRole="button" accessibilityLabel={'Loại hoạt động: ' + activities[draft.activity]}
          disabled={locked} onPress={() => setDialog('type')}><Text style={j.text}>{activities[draft.activity]}</Text></Pressable></Field>}
      <Field name={kind === 'activity' ? 'Thời gian bắt đầu' : 'Bắt đầu'} error={startError}>
        {kind === 'activity' ? <Feather name="clock" size={17} color={colors.muted} /> : <JournalIcon name="moon" size={17} />}
        <MomentInputs label="bắt đầu" value={draft.start} change={start => change({ start })} locked={locked} activity={kind === 'activity'} />
      </Field>
      {kind === 'activity' ? <Field name="Thời lượng" error={durationError}><Feather name="clock" size={17} color={colors.muted} />
        <TextInput accessibilityLabel="Thời lượng vận động" keyboardType="decimal-pad" editable={!locked} value={draft.duration}
          onChangeText={duration => change({ duration })} style={ui.input} /><Text style={j.eyebrow}>phút</Text></Field> :
        <Field name="Thức dậy" error={endError}><Feather name="sun" size={17} color={colors.muted} />
          <MomentInputs label="thức dậy" value={draft.end} change={end => change({ end })} locked={locked} /></Field>}
    </View>
    <View style={[j.card, { marginTop: kind === 'activity' ? 48 : 69, minHeight: 123, justifyContent: 'space-between' }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><JournalIcon name={kind} size={17} /><Text style={j.strong}>{label}</Text></View>
      <Text style={[j.heading, { fontSize: check.input ? 24 : 17, marginTop: 0 }]}>{summary}</Text>
      {check.input && !overlap && (kind === 'activity' && total === null
        ? <Pressable accessibilityRole="button" style={j.linkRow} disabled={locked} onPress={() => {
            setPreview(null);
            setPreviewAttempt(attempt => attempt + 1);
          }}><Text style={j.link}>Tính lại tổng</Text></Pressable>
        : <Text accessibilityLiveRegion="polite" style={[j.small, currentPreview?.activityOverlap && { color: '#865619' }]}>
          {kind === 'activity' ? activityHint : 'Phiên được ghi vào ngày thức dậy ' + displayDate(check.day!).slice(0, 5) + '.'}</Text>)}
    </View>
    {conflict && <AccountButton outline label="Tải lại bản ghi" onPress={reload} />}
    {dialog && <JournalDialog title={dialog === 'type' ? 'Loại hoạt động' : dialog === 'long' ? 'Xác nhận thời lượng' : 'Bỏ thay đổi?'}
      onClose={() => setDialog(null)}>
      {dialog === 'type' ? (Object.keys(activities) as ActivityType[]).map(type =>
        <Pressable key={type} accessibilityRole="button" onPress={() => { change({ activity: type }); setDialog(null); }}
          style={{ minHeight: 40, justifyContent: 'center' }}><Text style={type === draft.activity ? j.strong : j.text}>{activities[type]}</Text></Pressable>) :
       dialog === 'long' ? <><Text style={j.text}>Phiên {names[kind]} dài {durationText(check.minutes!)}. Bạn muốn lưu thời lượng này?</Text>
         <AccountButton label="Xác nhận lưu" onPress={() => save(true)} /></> :
        <><Text style={j.text}>{pending ? 'Lần lưu trước chưa được xác nhận. Bạn vẫn muốn rời đi?' : 'Thay đổi chưa lưu sẽ mất khi bạn rời màn hình.'}</Text>
          <AccountButton label="Rời đi" onPress={() => { setDialog(null); leave.current(); }} /></>}
      <AccountButton outline label={dialog === 'type' ? 'Đóng' : 'Tiếp tục chỉnh sửa'} onPress={() => setDialog(null)} />
    </JournalDialog>}
  </JournalPage>;
}
function LoadForm({ kind, user, date, id }: { kind: Kind; user: User; date: string | null; id?: string }) {
  const [boot, setBoot] = useState<Boot | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const reload = () => { setBoot(null); setError(''); setRevision(n => n + 1); };
  useEffect(() => {
    let active = true;
    Promise.all([loadProfile(user), id ? readTimedEntry(user, kind, id) : undefined]).then(([profile, entry]) => {
      const zone = entry?.timeZone ?? profile.timeZone;
      if (active) setBoot({ zone, entry, draft: initialDraft(kind, date, zone, entry) });
    }).catch(cause => { if (active) setError(journalError(cause)); });
    return () => { active = false; };
  }, [user, kind, date, id, revision]);
  if (boot) return <Editor kind={kind} user={user} boot={boot} reload={reload} />;
  return <JournalPage><JournalBack />{error ? <><ErrorMessage message={error} /><AccountButton outline label="Thử lại" onPress={reload} /></> :
    <ActivityIndicator color={colors.primary} accessibilityLabel="Đang tải bản ghi" />}</JournalPage>;
}
export function TimedJournalForm({ kind }: { kind: Kind }) {
  const { session } = useSession();
  const { date, editId } = useLocalSearchParams<{ date?: string; editId?: string }>();
  return session.status === 'active' ? <LoadForm key={[session.user.uid, kind, date, editId].join('/')} kind={kind}
    user={session.user} date={dayKey(date ?? '')} id={editId} /> : null;
}

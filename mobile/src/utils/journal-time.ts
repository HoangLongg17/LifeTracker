export type WallTime = { date: string; time: string };

export function normalizeTime(raw: string): string | null {
  const value = raw;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  return value;
}

export function displayDate(day: string) {
  return day.split('-').reverse().join('/');
}

export function dayKey(text: string) {
  const parts = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  const day = parts ? [parts[3], parts[2], parts[1]].join('-') : text;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day.startsWith('0000')) return null;
  const stamp = new Date(day + 'T00:00:00Z');
  return Number.isFinite(stamp.getTime()) && stamp.toISOString().slice(0, 10) === day ? day : null;
}

export function shiftDay(day: string, offset: number) {
  const date = new Date(day + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

const clocks = new Map<string, Intl.DateTimeFormat>();
export function wallTime(stamp: string | number, zone: string): WallTime {
  let clock = clocks.get(zone);
  if (!clock) {
    clock = new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    clocks.set(zone, clock);
  }
  const parts = Object.fromEntries(clock.formatToParts(new Date(stamp)).map(p => [p.type, p.value]));
  return { date: [parts.day, parts.month, parts.year].join('/'), time: parts.hour + ':' + parts.minute };
}

// Verify the result against the profile's IANA time zone, including daylight-saving transitions.
export function instant(wall: WallTime, zone: string, original?: string) {
  const day = dayKey(wall.date);
  const time = normalizeTime(wall.time);
  if (!day || !time) return null;
  const matches = (stamp: string | number) => {
    const local = wallTime(stamp, zone);
    return dayKey(local.date) === day && local.time === time;
  };
  if (original && matches(original)) return original;
  const nominal = Date.parse(day + 'T' + time + ':00Z');
  const candidates = new Set<number>();
  for (const delta of [-86400000, 0, 86400000]) {
    const sample = nominal + delta;
    const local = wallTime(sample, zone);
    const offset = Date.parse(dayKey(local.date) + 'T' + local.time + ':00Z') - sample;
    candidates.add(nominal - offset);
  }
  for (const candidate of [...candidates].sort((a, b) => a - b)) {
    if (matches(candidate)) return new Date(candidate).toISOString();
  }
  return null;
}

export function durationText(minutes: number) {
  const value = Math.round(minutes);
  const hours = Math.floor(value / 60);
  return hours ? hours + ' giờ' + (value % 60 ? ' ' + value % 60 + ' phút' : '') : value + ' phút';
}

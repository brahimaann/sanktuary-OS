// Dates the way people type them: "fri", "next sat 8pm", "oct 12", "12/3", "in 2 weeks", "tomorrow at noon".
// Returns YYYY-MM-DD (and HH:MM when a time was given) or null. The UI always shows what it understood,
// so an unexpected reading is caught before saving.
const DAYS = [/^sun(day)?$/, /^mon(day)?$/, /^tue(s|sday)?$/, /^wed(s|nesday)?$/, /^thu(r|rs|rsday)?$/, /^fri(day)?$/, /^sat(urday)?$/];
const MONTHS = [
  /^jan(uary)?$/,
  /^feb(ruary)?$/,
  /^mar(ch)?$/,
  /^apr(il)?$/,
  /^may$/,
  /^june?$/,
  /^july?$/,
  /^aug(ust)?$/,
  /^sept?(ember)?$/,
  /^oct(ober)?$/,
  /^nov(ember)?$/,
  /^dec(ember)?$/,
];
const dayOf = (w: string) => DAYS.findIndex((re) => re.test(w));
const monthOf = (w: string) => MONTHS.findIndex((re) => re.test(w));

const ymd = (d: Date) => d.toLocaleDateString('en-CA');
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

export interface When {
  date: string;
  time: string; // "" or "20:00"
}

function parseTime(s: string): { time: string; rest: string } {
  const words: Record<string, string> = { noon: '12:00', midday: '12:00', midnight: '00:00' };
  for (const [w, t] of Object.entries(words)) {
    const re = new RegExp(`\\b(?:at\\s+)?${w}\\b`);
    if (re.test(s)) return { time: t, rest: s.replace(re, ' ') };
  }
  // 8pm, 8:30 pm, 20:00, at 8
  const m =
    s.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)\b/) ||
    s.match(/\b(?:at\s+)?(\d{1,2}):(\d{2})\b/) ||
    s.match(/\bat\s+(\d{1,2})\b/);
  if (!m) return { time: '', rest: s };
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  const ap = m[3]?.[0];
  if (ap === 'p' && h < 12) h += 12;
  if (ap === 'a' && h === 12) h = 0;
  if (!ap && !m[2] && h >= 1 && h <= 7) h += 12; // "at 5" with no am/pm means 5pm
  if (h > 23 || min > 59) return { time: '', rest: s };
  return { time: `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`, rest: s.replace(m[0], ' ') };
}

export function parseWhen(input: string, now = new Date()): When | null {
  const lower = input
    .toLowerCase()
    .replace(/(\d)(st|nd|rd|th)\b/g, '$1')
    .replace(/,/g, ' ')
    .trim();
  if (!lower) return null;
  const { time, rest } = parseTime(lower);
  const s = rest.replace(/\s+/g, ' ').trim();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const done = (d: Date | null) => (d && !isNaN(d.getTime()) ? { date: ymd(d), time } : null);

  if (!s || /^(today|tonight|this (evening|afternoon|morning))$/.test(s)) return done(s || time ? today : null);
  if (/^(tomorrow|tmrw|tmr)( (night|morning|evening))?$/.test(s)) return done(addDays(today, 1));
  let m = s.match(/^in (\d{1,3}|a|an|one|two|three) (day|week|month)s?$/);
  if (m) {
    const n = ({ a: 1, an: 1, one: 1, two: 2, three: 3 } as Record<string, number>)[m[1]] ?? Number(m[1]);
    if (m[2] === 'month') return done(new Date(today.getFullYear(), today.getMonth() + n, today.getDate()));
    return done(addDays(today, n * (m[2] === 'week' ? 7 : 1)));
  }
  if (s === 'next week') return done(addDays(today, 7));
  if (s === 'next month') return done(new Date(today.getFullYear(), today.getMonth() + 1, 1));
  if (s === 'this weekend' || s === 'weekend') return done(addDays(today, (6 - today.getDay() + 7) % 7));

  // fri / friday / this fri / next fri (the one after the coming one)
  m = s.match(/^(?:(this|next|on) )?([a-z]+)$/);
  if (m && dayOf(m[2]) >= 0) {
    const ahead = (dayOf(m[2]) - today.getDay() + 7) % 7;
    return done(addDays(today, ahead + (m[1] === 'next' ? 7 : 0)));
  }

  // 2027-06-01
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return done(valid(+m[1], +m[2], +m[3]));
  // 6/1, 6/1/27, 6/1/2027 (month first)
  m = s.match(/^(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2}|\d{4}))?$/);
  if (m) return done(upcoming(today, +m[1], +m[2], m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : null));
  // oct 12 / october 12 2027 / sat oct 12 / 12 oct
  m = s.match(/^(?:([a-z]+) )?([a-z]+)\.? (\d{1,2})(?: (\d{4}))?$/);
  if (m && monthOf(m[2]) >= 0 && (!m[1] || dayOf(m[1]) >= 0 || m[1] === 'on'))
    return done(upcoming(today, monthOf(m[2]) + 1, +m[3], m[4] ? +m[4] : null));
  m = s.match(/^(\d{1,2}) ([a-z]+)\.?(?: (\d{4}))?$/);
  if (m && monthOf(m[2]) >= 0) return done(upcoming(today, monthOf(m[2]) + 1, +m[1], m[3] ? +m[3] : null));
  return null;
}

function valid(y: number, mo: number, d: number) {
  const x = new Date(y, mo - 1, d);
  return x.getMonth() === mo - 1 && x.getDate() === d ? x : null;
}
/** A day with no year given: this year's, or next year's if it has passed. */
function upcoming(today: Date, mo: number, d: number, y: number | null) {
  if (y) return valid(y, mo, d);
  const x = valid(today.getFullYear(), mo, d);
  return x && x < today ? valid(today.getFullYear() + 1, mo, d) : x;
}

/** "Fri, Oct 2" (+ ", 8:00 PM") for showing what was understood. */
export function describeWhen(w: When) {
  const [y, mo, d] = w.date.split('-').map(Number);
  const date = new Date(y, mo - 1, d);
  const nowY = new Date().getFullYear();
  let text = date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(y !== nowY ? { year: 'numeric' } : {}),
  });
  if (w.time) {
    const [h, m] = w.time.split(':').map(Number);
    text += `, ${new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  }
  return text;
}

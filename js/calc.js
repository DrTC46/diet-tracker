// Pure calculations: no DOM, no storage. All dates are local 'YYYY-MM-DD' strings.

export const KCAL_PER_KG = 7700;
export const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'];
export const MEAL_LABELS = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snacks' };
// Name given to entries logged with numbers only. It says nothing about the food itself.
export const QUICK_ENTRY_NAME = 'Quick entry';

const pad = (n) => String(n).padStart(2, '0');

export const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function fromISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export const todayISO = () => toISO(new Date());

export function addDays(iso, n) {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

const dayNumber = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
};

export const diffDays = (from, to) => dayNumber(to) - dayNumber(from);

export function dateRange(start, end) {
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

export function startOfWeek(iso) {
  const weekday = (fromISO(iso).getDay() + 6) % 7; // Monday = 0
  return addDays(iso, -weekday);
}

export const endOfWeek = (iso) => addDays(startOfWeek(iso), 6);
export const startOfMonth = (iso) => `${iso.slice(0, 7)}-01`;

export function endOfMonth(iso) {
  const d = fromISO(startOfMonth(iso));
  d.setMonth(d.getMonth() + 1);
  d.setDate(0);
  return toISO(d);
}

export function isWeekend(iso) {
  const day = fromISO(iso).getDay();
  return day === 0 || day === 6;
}

export function previousRange(start, end) {
  const length = diffDays(start, end) + 1;
  return { start: addDays(start, -length), end: addDays(start, -1) };
}

// A day counts only with burned kcal and at least one food entry.
// Missing days are never treated as zero.
export function summarizeDay(date, record, entries) {
  const burned = record?.burnedKcal ?? null;
  const consumed = entries.reduce((sum, e) => sum + e.kcal, 0);
  const counted = burned !== null && entries.length > 0;
  return {
    date,
    consumed,
    burned,
    protein: entries.reduce((sum, e) => sum + (e.proteinG ?? 0), 0),
    // Protein is optional per entry, so a day's total is only reliable if every entry has it.
    proteinComplete: entries.length > 0 && entries.every((e) => e.proteinG !== null && e.proteinG !== undefined),
    entryCount: entries.length,
    counted,
    balance: counted ? consumed - burned : null,
    weightKg: record?.weightKg ?? null,
  };
}

export function buildDays(start, end, records, entries) {
  const recordByDate = new Map(records.map((r) => [r.date, r]));
  const entriesByDate = new Map();
  for (const e of entries) {
    if (!entriesByDate.has(e.date)) entriesByDate.set(e.date, []);
    entriesByDate.get(e.date).push(e);
  }
  return dateRange(start, end).map((date) =>
    summarizeDay(date, recordByDate.get(date), entriesByDate.get(date) ?? [])
  );
}

const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

export function summarizePeriod(days) {
  const counted = days.filter((d) => d.counted);
  const n = counted.length;
  const consumed = counted.reduce((s, d) => s + d.consumed, 0);
  const burned = counted.reduce((s, d) => s + d.burned, 0);
  const balance = consumed - burned;
  return {
    totalDays: days.length,
    loggedDays: n,
    consumed,
    burned,
    balance,
    avgConsumed: n ? consumed / n : null,
    avgBurned: n ? burned / n : null,
    avgBalance: n ? balance / n : null,
    avgProtein: mean(counted.filter((d) => d.proteinComplete).map((d) => d.protein)),
    estimatedKg: balance / KCAL_PER_KG,
    // What the logged average would add up to over every day of the period.
    projectedKg: n ? ((balance / n) * days.length) / KCAL_PER_KG : null,
  };
}

// 7-day trailing average of the weigh-ins, one point per weigh-in date.
export function weightTrend(days) {
  const weighIns = days.filter((d) => d.weightKg !== null);
  return weighIns.map((d) => {
    const window = weighIns.filter((w) => {
      const age = diffDays(w.date, d.date);
      return age >= 0 && age < 7;
    });
    return { date: d.date, weightKg: d.weightKg, trendKg: mean(window.map((w) => w.weightKg)) };
  });
}

// Weight implied by the logged calories, starting from the first weigh-in of the period.
export function estimatedWeight(days) {
  const startIndex = days.findIndex((d) => d.weightKg !== null);
  if (startIndex < 0) return [];
  let weight = days[startIndex].weightKg;
  return days.slice(startIndex).map((d, i) => {
    if (i > 0 && d.counted) weight += d.balance / KCAL_PER_KG;
    return { date: d.date, estimatedKg: weight };
  });
}

export const CALIBRATION_MIN_DAYS = 14;
export const CALIBRATION_MIN_WEIGHINS = 4;

// Compares logged balance with measured weight change. Averages the first and last week of
// weigh-ins so a single water-weight day can't swing the result.
// A positive error means the real balance is higher than logged: burn overestimated or food under-logged.
export function calibrate(days) {
  const counted = days.filter((d) => d.counted);
  const weighIns = days.filter((d) => d.weightKg !== null);
  if (counted.length < CALIBRATION_MIN_DAYS || weighIns.length < CALIBRATION_MIN_WEIGHINS) return null;

  const first = weighIns[0].date;
  const last = weighIns[weighIns.length - 1].date;
  if (diffDays(first, last) < CALIBRATION_MIN_DAYS) return null;

  const offset = (d) => diffDays(first, d.date);
  const firstWindow = weighIns.filter((d) => offset(d) < 7);
  const lastWindow = weighIns.filter((d) => diffDays(d.date, last) < 7);
  const fromDay = mean(firstWindow.map(offset));
  const toDay = mean(lastWindow.map(offset));
  const gap = toDay - fromDay;

  const between = counted.filter((d) => offset(d) > fromDay && offset(d) <= toDay);
  if (between.length < CALIBRATION_MIN_DAYS / 2) return null;

  const measuredKg = mean(lastWindow.map((d) => d.weightKg)) - mean(firstWindow.map((d) => d.weightKg));
  const avgBalance = mean(between.map((d) => d.balance));
  const estimatedKg = (avgBalance * gap) / KCAL_PER_KG;
  return {
    measuredKg,
    estimatedKg,
    spanDays: gap,
    countedDays: between.length,
    weighIns: weighIns.length,
    errorKcalPerDay: ((measuredKg - estimatedKg) * KCAL_PER_KG) / gap,
  };
}

export function latestWeight(days) {
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].weightKg !== null) return days[i].weightKg;
  }
  return null;
}

// An explicit target wins; otherwise 1.6 g per kg of body weight.
export function proteinTarget(settings, weightKg) {
  if (settings.proteinTargetG) return settings.proteinTargetG;
  const weight = weightKg ?? settings.startWeightKg;
  return weight ? Math.round(weight * 1.6) : null;
}

const countedDates = (days) => new Set(days.filter((d) => d.counted).map((d) => d.date));

export function mealBreakdown(days, entries) {
  const dates = countedDates(days);
  const totals = Object.fromEntries(MEALS.map((m) => [m, 0]));
  for (const e of entries) {
    if (dates.has(e.date)) totals[e.meal] += e.kcal;
  }
  const total = MEALS.reduce((s, m) => s + totals[m], 0);
  return MEALS.map((meal) => ({ meal, kcal: totals[meal], share: total ? totals[meal] / total : 0 }));
}

export function topFoods(days, entries, limit = 5) {
  const dates = countedDates(days);
  const foods = new Map();
  let total = 0;
  for (const e of entries) {
    if (!dates.has(e.date)) continue;
    total += e.kcal;
    if (e.name === QUICK_ENTRY_NAME) continue;
    const key = e.name.trim().toLowerCase();
    const food = foods.get(key) ?? { name: e.name.trim(), kcal: 0, proteinG: 0, count: 0, proteinKnown: true };
    food.kcal += e.kcal;
    food.proteinG += e.proteinG ?? 0;
    food.count += 1;
    food.proteinKnown &&= e.proteinG !== null && e.proteinG !== undefined;
    foods.set(key, food);
  }
  return [...foods.values()]
    .map((f) => ({ ...f, share: total ? f.kcal / total : 0 }))
    .sort((a, b) => b.kcal - a.kcal)
    .slice(0, limit);
}

export function bestWorstDays(days, limit = 3) {
  const sorted = days.filter((d) => d.counted).sort((a, b) => a.balance - b.balance);
  return { best: sorted.slice(0, limit), worst: sorted.slice(-limit).reverse() };
}

export function weekSplit(days) {
  const part = (list) => ({
    days: list.length,
    totalBalance: list.reduce((s, d) => s + d.balance, 0),
    avgBalance: mean(list.map((d) => d.balance)),
    avgConsumed: mean(list.map((d) => d.consumed)),
  });
  const counted = days.filter((d) => d.counted);
  return {
    weekday: part(counted.filter((d) => !isWeekend(d.date))),
    weekend: part(counted.filter((d) => isWeekend(d.date))),
  };
}

function csvField(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value);
  // A leading formula character would run as a formula when opened in a spreadsheet.
  const text = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const toCsv = (header, rows) => [header, ...rows].map((r) => r.map(csvField).join(',')).join('\n');

export const daysToCsv = (days) =>
  toCsv(
    ['date', 'consumed_kcal', 'burned_kcal', 'balance_kcal', 'protein_g', 'weight_kg', 'counted'],
    days.map((d) => [d.date, d.consumed, d.burned, d.balance, d.protein, d.weightKg, d.counted ? 'yes' : 'no'])
  );

export const entriesToCsv = (entries) =>
  toCsv(
    ['date', 'meal', 'name', 'kcal', 'protein_g'],
    [...entries]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((e) => [e.date, e.meal, e.name, e.kcal, e.proteinG ?? null])
  );

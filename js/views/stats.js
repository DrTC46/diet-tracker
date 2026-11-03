import {
  MEAL_LABELS, addDays, bestWorstDays, buildDays, calibrate, endOfMonth, endOfWeek, estimatedWeight,
  mealBreakdown, previousRange, startOfMonth, startOfWeek, summarizePeriod, todayISO, topFoods, weekSplit, weightTrend,
} from '../calc.js';
import { balanceChart, lineChart, segmentedBar } from '../charts.js';
import * as db from '../db.js';
import { balanceWord, esc, fmtG, fmtKcal, fmtKgSigned, fmtNum, fmtSigned, longDate, shortDate } from '../ui.js';

const WHITE = '#ffffff';
const NEAR_BLACK = '#0b0b0b'; // yellow is too light to carry white text
const MEAL_COLORS = {
  breakfast: ['var(--series-1)', WHITE],
  lunch: ['var(--series-2)', WHITE],
  dinner: ['var(--series-3)', WHITE],
  snack: ['var(--series-4)', NEAR_BLACK],
};

// Kept between visits, so returning to Stats shows the same period.
const state = { mode: 'week', anchor: null, from: null, to: null };

function ranges(today) {
  const anchor = state.anchor ?? today;
  if (state.mode === 'week') {
    const start = startOfWeek(anchor);
    const full = endOfWeek(anchor);
    const previous = addDays(start, -7);
    return {
      start, end: full < today ? full : today, previous: { start: previous, end: addDays(previous, 6) },
      label: `${shortDate(start)} to ${shortDate(full)}`, unit: 'last week', isCurrent: full >= today,
    };
  }
  if (state.mode === 'month') {
    const start = startOfMonth(anchor);
    const full = endOfMonth(anchor);
    const previousEnd = addDays(start, -1);
    return {
      start, end: full < today ? full : today, previous: { start: startOfMonth(previousEnd), end: previousEnd },
      label: new Date(`${start}T12:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }), unit: 'last month', isCurrent: full >= today,
    };
  }
  const end = state.to ?? today;
  const start = state.from ?? addDays(end, -29);
  return { start, end, previous: previousRange(start, end), label: '', unit: 'the period before', isCurrent: true };
}

function step(direction, today) {
  const anchor = state.anchor ?? today;
  const next = state.mode === 'week'
    ? addDays(anchor, 7 * direction)
    : addDays(direction < 0 ? startOfMonth(anchor) : endOfMonth(anchor), direction);
  state.anchor = next > today ? today : next;
}

function deltaText(now, before, format, unit) {
  if (now === null || before === null) return `No data for ${unit}`;
  return `${format(now - before)} vs ${unit}`;
}

const tile = (label, value, delta) => `
  <div class="tile">
    <div class="tile-label">${label}</div>
    <div class="tile-value">${value}</div>
    <div class="tile-delta">${delta}</div>
  </div>`;

function chartCard(title, subtitle = '') {
  const card = document.createElement('section');
  card.className = 'card';
  const head = document.createElement('h2');
  head.textContent = title;
  card.append(head);
  if (subtitle) {
    const sub = document.createElement('p');
    sub.className = 'small muted';
    sub.style.marginBottom = '8px';
    sub.textContent = subtitle;
    card.append(sub);
  } else {
    head.style.marginBottom = '8px';
  }
  return card;
}

export async function renderStats(root) {
  const today = todayISO();
  const range = ranges(today);
  const widest = range.previous.start;
  const [records, entries, settings] = await Promise.all([
    db.getDays(widest, range.end), db.getEntries(widest, range.end), db.getSettings(),
  ]);
  const inRange = (from, to) => (item) => item.date >= from && item.date <= to;
  const periodEntries = entries.filter(inRange(range.start, range.end));
  const days = buildDays(range.start, range.end, records.filter(inRange(range.start, range.end)), periodEntries);
  const previousDays = buildDays(range.previous.start, range.previous.end,
    records.filter(inRange(range.previous.start, range.previous.end)),
    entries.filter(inRange(range.previous.start, range.previous.end)));
  const period = summarizePeriod(days);
  const previous = summarizePeriod(previousDays);
  const hasData = period.loggedDays > 0;

  root.innerHTML = `
    <h1>Statistics</h1>
    <div class="chips" role="group" aria-label="Period">
      ${[['week', 'Week'], ['month', 'Month'], ['custom', 'Custom']].map(([mode, label]) =>
        `<button class="chip" type="button" data-mode="${mode}" aria-pressed="${state.mode === mode}">${label}</button>`).join('')}
    </div>
    ${state.mode === 'custom' ? `
      <div class="field-grid" style="margin-bottom:12px">
        <label class="field">From <input type="date" id="from" value="${range.start}" max="${today}"></label>
        <label class="field">To <input type="date" id="to" value="${range.end}" max="${today}"></label>
      </div>
      <p class="form-error" id="range-error" hidden></p>` : `
      <div class="range-nav">
        <button class="icon-btn" type="button" data-step="-1" aria-label="Previous ${state.mode}">‹</button>
        <b>${esc(range.label)}</b>
        <button class="icon-btn" type="button" data-step="1" aria-label="Next ${state.mode}" ${range.isCurrent ? 'disabled' : ''}>›</button>
      </div>`}
    <div id="stats-body"></div>`;

  root.querySelectorAll('[data-mode]').forEach((chip) => chip.addEventListener('click', () => {
    state.mode = chip.dataset.mode;
    if (state.mode === 'custom') {
      state.to = range.end;
      state.from = range.start;
    }
    renderStats(root);
  }));
  root.querySelectorAll('[data-step]').forEach((button) => button.addEventListener('click', () => {
    step(Number(button.dataset.step), today);
    renderStats(root);
  }));
  if (state.mode === 'custom') {
    const onDate = () => {
      const from = root.querySelector('#from').value;
      const to = root.querySelector('#to').value;
      const error = root.querySelector('#range-error');
      const valid = from && to && from <= to;
      error.hidden = Boolean(valid);
      if (!valid) {
        error.textContent = 'The start date must be on or before the end date.';
        return;
      }
      state.from = from;
      state.to = to;
      renderStats(root);
    };
    root.querySelector('#from').addEventListener('change', onDate);
    root.querySelector('#to').addEventListener('change', onDate);
  }

  const body = root.querySelector('#stats-body');
  if (!hasData) {
    body.innerHTML = `
      <section class="card">
        <h2>No complete days in this period</h2>
        <p class="small muted" style="margin-top:4px">A day counts once it has both calories burned and at least one food. ${period.totalDays} days in this period, none complete yet.</p>
      </section>`;
    return;
  }

  const showProjection = period.loggedDays < period.totalDays;
  body.innerHTML = `
    <section class="card">
      <div class="hero-label">Estimated weight change</div>
      <div class="hero-value">${fmtKgSigned(period.estimatedKg)}</div>
      <p class="small" style="margin-top:4px">${fmtSigned(period.balance)} total ${balanceWord(period.balance)} · ${period.loggedDays} of ${period.totalDays} days logged</p>
      ${showProjection ? `<p class="small muted" style="margin-top:2px">If the unlogged days matched your average: ${fmtKgSigned(period.projectedKg)}</p>` : ''}
    </section>
    <div class="tiles">
      ${tile('Average eaten', fmtKcal(period.avgConsumed), deltaText(period.avgConsumed, previous.avgConsumed, fmtSigned, range.unit))}
      ${tile('Average burned', fmtKcal(period.avgBurned), deltaText(period.avgBurned, previous.avgBurned, fmtSigned, range.unit))}
      ${tile('Average balance', fmtSigned(period.avgBalance), deltaText(period.avgBalance, previous.avgBalance, fmtSigned, range.unit))}
      ${tile('Average protein', fmtG(period.avgProtein), deltaText(period.avgProtein, previous.avgProtein, (n) => fmtSigned(n, 'g'), range.unit))}
    </div>`;

  // --- Charts ---
  const dates = days.map((d) => d.date);
  const balanceCard = chartCard('Daily balance');
  body.append(balanceCard);
  balanceChart(balanceCard, {
    points: days.map((d) => ({ date: d.date, value: d.balance })),
    target: settings.targetBalanceKcal,
    labelOf: (p) => shortDate(p.date),
    titleOf: (p) => longDate(p.date),
    valueOf: (v) => fmtSigned(v),
  });

  if (period.loggedDays >= 2) {
    const flowCard = chartCard('Eaten and burned');
    body.append(flowCard);
    lineChart(flowCard, {
      dates,
      ariaLabel: 'Calories eaten and burned per day',
      series: [
        { name: 'Eaten', color: 'var(--series-1)', values: days.map((d) => (d.counted ? d.consumed : null)) },
        { name: 'Burned', color: 'var(--series-2)', values: days.map((d) => (d.counted ? d.burned : null)) },
      ],
      labelOf: shortDate,
      titleOf: longDate,
      valueOf: fmtKcal,
    });
  }

  const trend = weightTrend(days);
  if (trend.length >= 2) {
    const trendByDate = new Map(trend.map((t) => [t.date, t.trendKg]));
    const estimateByDate = new Map(estimatedWeight(days).map((e) => [e.date, e.estimatedKg]));
    const calibration = calibrate(days);
    const weightCard = chartCard('Weight', calibration
      ? `Measured ${calibration.measuredKg.toFixed(1)} kg vs estimated ${calibration.estimatedKg.toFixed(1)} kg over ${Math.round(calibration.spanDays)} days`
      : 'Your 7-day average against what the calories predict');
    body.append(weightCard);
    const kg = (v) => `${v.toFixed(1)} kg`;
    lineChart(weightCard, {
      dates,
      ariaLabel: 'Measured weight trend and weight estimated from calories',
      ticks: 3,
      series: [
        { name: 'Measured (7-day average)', color: 'var(--series-1)', connect: true, values: dates.map((d) => trendByDate.get(d) ?? null) },
        { name: 'Estimated from calories', color: 'var(--series-2)', values: dates.map((d) => estimateByDate.get(d) ?? null) },
      ],
      labelOf: shortDate,
      titleOf: longDate,
      valueOf: kg,
    });
  }

  const mealCard = chartCard('Calories by meal');
  body.append(mealCard);
  segmentedBar(mealCard, mealBreakdown(days, periodEntries).map((m) => ({
    name: MEAL_LABELS[m.meal],
    value: fmtKcal(m.kcal),
    share: m.share,
    color: MEAL_COLORS[m.meal][0],
    ink: MEAL_COLORS[m.meal][1],
  })));

  // --- Tables ---
  const { best, worst } = bestWorstDays(days, 3);
  const dayRows = (list) => list.map((d) => `<tr><td>${longDate(d.date)}</td><td class="r">${fmtSigned(d.balance)}</td></tr>`).join('');
  const split = weekSplit(days);
  const splitRow = (label, part) => `<tr><td>${label}</td><td class="r">${part.days}</td><td class="r">${fmtKcal(part.avgConsumed)}</td><td class="r">${fmtSigned(part.avgBalance)}</td></tr>`;
  const foods = topFoods(days, periodEntries, 5);

  const tables = document.createElement('div');
  tables.innerHTML = `
    ${period.loggedDays >= 2 ? `
      <section class="card">
        <h2>Lowest and highest balance</h2>
        <h3>Lowest</h3>
        <table class="data-table"><tbody>${dayRows(best)}</tbody></table>
        <h3>Highest</h3>
        <table class="data-table"><tbody>${dayRows(worst)}</tbody></table>
      </section>` : ''}
    <section class="card">
      <h2 style="margin-bottom:6px">Weekdays and weekends</h2>
      <table class="data-table">
        <thead><tr><th></th><th class="r">Days</th><th class="r">Eaten</th><th class="r">Balance</th></tr></thead>
        <tbody>${splitRow('Weekdays', split.weekday)}${splitRow('Weekends', split.weekend)}</tbody>
      </table>
      <p class="hint">Eaten and balance are daily averages.</p>
    </section>
    ${foods.length ? `
      <section class="card">
        <h2 style="margin-bottom:6px">Top foods by calories</h2>
        <table class="data-table">
          <thead><tr><th>Food</th><th class="r">Times</th><th class="r">Calories</th><th class="r">Share</th></tr></thead>
          <tbody>${foods.map((f) => `<tr><td>${esc(f.name)}</td><td class="r">${f.count}</td><td class="r">${fmtNum(f.kcal)}</td><td class="r">${Math.round(f.share * 100)}%</td></tr>`).join('')}</tbody>
        </table>
      </section>` : ''}`;
  body.append(tables);
}

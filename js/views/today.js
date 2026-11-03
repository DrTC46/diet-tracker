import { KCAL_PER_KG, MEALS, MEAL_LABELS, addDays, buildDays, diffDays, latestWeight, proteinTarget, summarizeDay, todayISO, toISO } from '../calc.js';
import * as db from '../db.js';
import { balanceWord, dateLabel, esc, fmtG, fmtKcal, fmtKgSigned, fmtNum, fmtSigned, navigate, parseNum, refreshView, toast } from '../ui.js';

const BACKUP_REMINDER_DAYS = 14;
const MAX_BURNED = 20000;
const MIN_WEIGHT = 20;
const MAX_WEIGHT = 400;

function backupDue(settings, today) {
  const last = settings.lastBackupAt ?? settings.firstUseAt;
  return last ? diffDays(toISO(new Date(last)), today) >= BACKUP_REMINDER_DAYS : false;
}

function summaryHtml(day, target) {
  const consumed = fmtKcal(day.consumed);
  const burned = fmtKcal(day.burned);
  let hero;
  if (day.counted) {
    hero = `
      <div class="hero-label">Balance (${balanceWord(day.balance)})</div>
      <div class="hero-value">${fmtSigned(day.balance, '')} <span class="small muted">kcal</span></div>
      <p class="small muted">About ${fmtKgSigned(day.balance / KCAL_PER_KG)} of body weight</p>`;
  } else {
    const missing = day.burned === null && !day.entryCount ? 'calories burned and food'
      : day.burned === null ? 'calories burned' : 'food';
    hero = `
      <div class="hero-label">Balance</div>
      <p>Add ${missing} to see this day's balance.</p>`;
  }
  const proteinShare = target ? Math.min(100, (day.protein / target) * 100) : 0;
  return `
    ${hero}
    <div class="sum-row">
      <div><span>Eaten</span><b>${consumed}</b></div>
      <div><span>Burned</span><b>${burned}</b></div>
      <div><span>Protein${target ? ` · goal ${target}` : ''}</span><b>${fmtG(day.protein)}</b></div>
    </div>
    ${target ? `<div class="meter" role="img" aria-label="Protein ${Math.round(day.protein)} of ${target} grams"><i style="width:${proteinShare}%"></i></div>` : ''}`;
}

function mealHtml(meal, entries, date) {
  const total = entries.reduce((s, e) => s + e.kcal, 0);
  const rows = entries.map((e) => `
    <div class="entry">
      <button class="entry-main" type="button" data-edit="${esc(e.id)}">
        <span class="entry-name">${esc(e.name)}</span>
        <span class="entry-values">${fmtNum(e.kcal)} kcal${e.proteinG === null || e.proteinG === undefined ? '' : ` · ${Math.round(e.proteinG)} g`}</span>
      </button>
      <button class="icon-btn" type="button" data-delete="${esc(e.id)}" aria-label="Delete ${esc(e.name)}">✕</button>
    </div>`).join('');
  return `
    <section class="card">
      <div class="card-head" ${entries.length ? '' : 'style="margin-bottom:0"'}>
        <h2>${MEAL_LABELS[meal]}${total ? ` <span class="muted small num">${fmtNum(total)} kcal</span>` : ''}</h2>
        <a class="btn btn-small" href="#/add?date=${date}&meal=${meal}">+ Add</a>
      </div>
      ${rows}
    </section>`;
}

export async function renderToday(root, params) {
  const today = todayISO();
  const date = params.get('date') && params.get('date') <= today ? params.get('date') : today;

  const [record, entries, settings, recentRecords] = await Promise.all([
    db.getDay(date), db.getEntries(date, date), db.getSettings(), db.getDays(addDays(date, -90), date),
  ]);
  const weight = latestWeight(buildDays(addDays(date, -90), date, recentRecords, []));
  const target = proteinTarget(settings, weight);
  let current = record ?? { date, burnedKcal: null, weightKg: null };

  root.innerHTML = `
    <div class="date-bar">
      <a class="icon-btn" style="display:grid;place-items:center;text-decoration:none" href="#/today?date=${addDays(date, -1)}" aria-label="Previous day">‹</a>
      <div class="date-title">${dateLabel(date)}</div>
      ${date < today
        ? `<a class="icon-btn" style="display:grid;place-items:center;text-decoration:none" href="#/today?date=${addDays(date, 1)}" aria-label="Next day">›</a>`
        : '<span class="icon-btn" aria-hidden="true"></span>'}
    </div>
    ${backupDue(settings, today) ? `
      <div class="card banner">
        <span>Your data is only on this phone. It's time for a backup.</span>
        <a class="btn btn-small" href="#/settings">Back up</a>
      </div>` : ''}
    <section class="card" id="summary"></section>
    <section class="card">
      <div class="field-grid">
        <label class="field">Calories burned (Garmin)
          <input id="burned" inputmode="numeric" autocomplete="off" enterkeyhint="done" placeholder="e.g. 2450" value="${current.burnedKcal ?? ''}">
        </label>
        <label class="field">Weight in kg (optional)
          <input id="weight" inputmode="decimal" autocomplete="off" enterkeyhint="done" placeholder="e.g. 80.5" value="${current.weightKg ?? ''}">
        </label>
      </div>
      <p class="hint">Use Garmin's end-of-day total (active + resting). It keeps rising during the day, so a morning number makes your deficit look smaller than it is.</p>
      <p class="form-error" id="day-error" hidden></p>
    </section>
    ${MEALS.map((meal) => mealHtml(meal, entries.filter((e) => e.meal === meal), date)).join('')}`;

  const refreshSummary = () => {
    root.querySelector('#summary').innerHTML = summaryHtml(summarizeDay(date, current, entries), target);
  };
  refreshSummary();

  const bindField = (selector, key, isValid, message) => {
    const input = root.querySelector(selector);
    const error = root.querySelector('#day-error');
    input.addEventListener('change', async () => {
      const value = parseNum(input.value);
      const valid = value === null || isValid(value);
      input.setAttribute('aria-invalid', String(!valid));
      error.hidden = valid;
      if (!valid) {
        error.textContent = message;
        return;
      }
      current = await db.updateDay(date, { [key]: value });
      refreshSummary();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
    });
  };
  bindField('#burned', 'burnedKcal', (v) => v <= MAX_BURNED, `Calories burned must be between 0 and ${fmtNum(MAX_BURNED)}.`);
  bindField('#weight', 'weightKg', (v) => v >= MIN_WEIGHT && v <= MAX_WEIGHT, `Weight must be between ${MIN_WEIGHT} and ${MAX_WEIGHT} kg.`);

  root.addEventListener('click', async (event) => {
    const editButton = event.target.closest('[data-edit]');
    if (editButton) {
      navigate(`#/add?date=${date}&edit=${encodeURIComponent(editButton.dataset.edit)}`);
      return;
    }
    const deleteButton = event.target.closest('[data-delete]');
    if (!deleteButton) return;
    const entry = entries.find((e) => e.id === deleteButton.dataset.delete);
    await db.deleteEntry(entry.id);
    refreshView();
    toast(`Deleted ${entry.name}`, {
      label: 'Undo',
      run: async () => {
        await db.saveEntry(entry);
        refreshView();
      },
    });
  });
}

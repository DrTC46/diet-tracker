import { addDays, buildDays, daysToCsv, entriesToCsv, latestWeight, proteinTarget, todayISO } from '../calc.js';
import * as db from '../db.js';
import { esc, fmtNum, longDate, parseNum, parseSigned, refreshView, saveFile, toast } from '../ui.js';

const EARLIEST = '2000-01-01';
const isoStamp = () => todayISO();

function validationMessage({ target, protein, goal, start }) {
  if (Number.isNaN(target)) return 'Enter the daily target as a number, such as -500.';
  if (Number.isNaN(protein) || Number.isNaN(goal) || Number.isNaN(start)) return 'Enter numbers only, or leave the field empty.';
  return null;
}

export async function renderSettings(root) {
  const today = todayISO();
  const [settings, foods, templates, recentRecords] = await Promise.all([
    db.getSettings(), db.getFoods(), db.getTemplates(), db.getDays(addDays(today, -90), today),
  ]);
  const weight = latestWeight(buildDays(addDays(today, -90), today, recentRecords, []));
  const derivedProtein = proteinTarget({ ...settings, proteinTargetG: null }, weight);
  const persisted = await navigator.storage?.persisted?.();

  root.innerHTML = `
    <h1>Settings</h1>

    <form class="card" id="targets" novalidate>
      <h2 style="margin-bottom:10px">Targets</h2>
      <div class="field-grid">
        <label class="field">Daily balance (kcal)
          <input id="target" inputmode="text" autocomplete="off" value="${settings.targetBalanceKcal ?? ''}">
        </label>
        <label class="field">Protein per day (g)
          <input id="protein" inputmode="numeric" autocomplete="off" placeholder="${derivedProtein ?? 'auto'}" value="${settings.proteinTargetG ?? ''}">
        </label>
        <label class="field">Goal weight (kg)
          <input id="goal" inputmode="decimal" autocomplete="off" value="${settings.goalWeightKg ?? ''}">
        </label>
        <label class="field">Current weight (kg)
          <input id="start" inputmode="decimal" autocomplete="off" value="${settings.startWeightKg ?? ''}">
        </label>
      </div>
      <p class="hint">Daily balance: negative is a deficit, positive is a surplus. Leave protein empty to use 1.6 g per kg of body weight. Current weight is only used until you log a weigh-in.</p>
      <p class="form-error" id="targets-error" hidden></p>
      <button class="btn btn-primary btn-wide" type="submit" style="margin-top:10px">Save targets</button>
    </form>

    <section class="card">
      <h2>Backup</h2>
      <p class="small" style="margin:4px 0 10px">Your data is stored only on this phone. If you delete the app or lose the phone, anything not exported is gone.</p>
      <p class="small muted" style="margin-bottom:10px">Last backup: ${settings.lastBackupAt ? longDate(settings.lastBackupAt.slice(0, 10)) : 'never'}${persisted === false ? '<br>Your browser may clear this data if storage runs low. Installing the app to your home screen makes that less likely.' : ''}</p>
      <div class="field-grid">
        <button class="btn" type="button" id="export">Export backup</button>
        <label class="btn">Restore backup<input type="file" id="import" accept="application/json,.json" hidden></label>
        <button class="btn" type="button" id="csv-days">Daily totals CSV</button>
        <button class="btn" type="button" id="csv-entries">Food log CSV</button>
      </div>
    </section>

    <section class="card">
      <h2 style="margin-bottom:6px">My foods (${foods.length})</h2>
      ${foods.length ? foods.sort((a, b) => a.name.localeCompare(b.name)).map((f) => `
        <div class="entry">
          <span class="grow entry-name">${esc(f.name)}</span>
          <span class="entry-values">${fmtNum(f.kcal)} kcal${f.basis === '100g' ? ' /100 g' : ''}</span>
          <button class="icon-btn" type="button" data-delete-food="${esc(f.id)}" aria-label="Delete ${esc(f.name)}">✕</button>
        </div>`).join('') : '<p class="small muted">Nothing saved yet.</p>'}
    </section>

    <section class="card">
      <h2 style="margin-bottom:6px">Saved meals (${templates.length})</h2>
      ${templates.length ? templates.sort((a, b) => a.name.localeCompare(b.name)).map((t) => `
        <div class="entry">
          <span class="grow entry-name">${esc(t.name)}</span>
          <span class="entry-values">${t.items.length} item${t.items.length === 1 ? '' : 's'}</span>
          <button class="icon-btn" type="button" data-delete-template="${esc(t.id)}" aria-label="Delete ${esc(t.name)}">✕</button>
        </div>`).join('') : '<p class="small muted">Nothing saved yet.</p>'}
    </section>

    <section class="card">
      <h2>About the numbers</h2>
      <p class="small muted" style="margin-top:4px">Weight estimates use 7,700 kcal per kg of body weight. That's a common rule of thumb, and real change varies. Scanning sends only the barcode to Open Food Facts; nothing else leaves this phone.</p>
      <button class="btn btn-danger btn-wide" type="button" id="clear" style="margin-top:12px">Erase all data</button>
    </section>`;

  const $ = (selector) => root.querySelector(selector);

  $('#targets').addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = {
      target: parseSigned($('#target').value),
      protein: parseNum($('#protein').value),
      goal: parseNum($('#goal').value),
      start: parseNum($('#start').value),
    };
    const problem = validationMessage(values);
    $('#targets-error').hidden = !problem;
    if (problem) {
      $('#targets-error').textContent = problem;
      return;
    }
    await db.updateSettings({
      targetBalanceKcal: values.target, proteinTargetG: values.protein, goalWeightKg: values.goal, startWeightKg: values.start,
    });
    toast('Targets saved');
    refreshView();
  });

  $('#export').addEventListener('click', async () => {
    const data = await db.exportAll();
    const saved = await saveFile(`diet-backup-${isoStamp()}.json`, JSON.stringify(data, null, 1), 'application/json');
    if (!saved) return;
    await db.updateSettings({ lastBackupAt: new Date().toISOString() });
    toast('Backup exported');
    refreshView();
  });

  $('#import').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      toast("This file can't be read as a backup.");
      return;
    }
    const problem = db.validateBackup(data);
    if (problem) {
      toast(problem);
      return;
    }
    const summary = `${data.days.length} days and ${data.entries.length} food entries`;
    if (!confirm(`Restore ${summary}? This replaces all data currently on this phone.`)) return;
    await db.importAll(data);
    toast(`Restored ${summary}`);
    refreshView();
  });

  $('#csv-days').addEventListener('click', async () => {
    const entries = await db.getEntries(EARLIEST, today);
    const records = await db.getDays(EARLIEST, today);
    const dates = [...entries, ...records].map((x) => x.date).sort();
    if (!dates.length) {
      toast('There is nothing to export yet.');
      return;
    }
    await saveFile(`diet-days-${isoStamp()}.csv`, daysToCsv(buildDays(dates[0], today, records, entries)), 'text/csv');
  });

  $('#csv-entries').addEventListener('click', async () => {
    const entries = await db.getEntries(EARLIEST, today);
    if (!entries.length) {
      toast('There is nothing to export yet.');
      return;
    }
    await saveFile(`diet-food-log-${isoStamp()}.csv`, entriesToCsv(entries), 'text/csv');
  });

  $('#clear').addEventListener('click', async () => {
    if (!confirm('Erase all your days, food entries, saved foods and targets from this phone? This cannot be undone unless you have a backup.')) return;
    await db.clearAll();
    await db.updateSettings({ firstUseAt: new Date().toISOString() });
    toast('All data erased');
    refreshView();
  });

  root.addEventListener('click', async (event) => {
    const food = event.target.closest('[data-delete-food]');
    const template = event.target.closest('[data-delete-template]');
    if (food) {
      const item = foods.find((f) => f.id === food.dataset.deleteFood);
      await db.deleteFood(item.id);
      toast(`Deleted ${item.name}`, { label: 'Undo', run: async () => { await db.saveFood(item); refreshView(); } });
      refreshView();
    } else if (template) {
      const item = templates.find((t) => t.id === template.dataset.deleteTemplate);
      await db.deleteTemplate(item.id);
      toast(`Deleted ${item.name}`, { label: 'Undo', run: async () => { await db.saveTemplate(item); refreshView(); } });
      refreshView();
    }
  });
}

import { MEALS, MEAL_LABELS, QUICK_ENTRY_NAME, addDays, todayISO } from '../calc.js';
import * as db from '../db.js';
import { lookupBarcode } from '../off.js';
import { scanBarcode } from '../scanner.js';
import { esc, fmtG, fmtKcal, fmtNum, navigate, parseNum, toast } from '../ui.js';

const RECENT_LIMIT = 8;
const FOOD_LIMIT = 30;
const MAX_KCAL = 10000;
const round1 = (n) => Math.round(n * 10) / 10;

const foodLine = (kcal, protein, suffix = '') =>
  `${fmtNum(kcal)} kcal${protein === null || protein === undefined ? '' : ` · ${round1(protein)} g`}${suffix}`;

export async function renderAddFood(root, params) {
  const date = params.get('date') ?? todayISO();
  const editing = params.get('edit') ? await db.getEntry(params.get('edit')) : null;
  let meal = editing?.meal ?? (MEALS.includes(params.get('meal')) ? params.get('meal') : 'lunch');
  let scannedBarcode = null;
  let portionFood = null;

  const back = `#/today?date=${date}`;

  root.innerHTML = `
    <div class="spread" style="margin-bottom:8px">
      <h1 style="margin:0">${editing ? 'Edit food' : 'Add food'}</h1>
      <a class="btn btn-small" href="${back}">Done</a>
    </div>
    <div class="chips" role="group" aria-label="Meal">
      ${MEALS.map((m) => `<button class="chip" type="button" data-meal="${m}">${MEAL_LABELS[m]}</button>`).join('')}
    </div>
    <div id="notice" class="notice" role="status" hidden></div>

    <section class="card" id="portion" hidden></section>

    <form class="card" id="manual" novalidate>
      <div class="field-grid">
        <label class="field">Calories
          <input id="kcal" inputmode="numeric" autocomplete="off" required placeholder="kcal" value="${editing?.kcal ?? ''}">
        </label>
        <label class="field">Protein (optional)
          <input id="protein" inputmode="decimal" autocomplete="off" placeholder="g" value="${editing?.proteinG ?? ''}">
        </label>
      </div>
      <label class="field" style="margin-top:10px">Name (optional)
        <input id="name" autocomplete="off" placeholder="e.g. Chicken salad" value="${editing && editing.name !== QUICK_ENTRY_NAME ? esc(editing.name) : ''}">
      </label>
      ${editing ? '' : `
        <label class="check"><input type="checkbox" id="save-food"> Save to my foods</label>`}
      <p class="form-error" id="manual-error" hidden></p>
      <button class="btn btn-primary btn-wide" type="submit" style="margin-top:8px">${editing ? 'Save changes' : 'Add'}</button>
    </form>

    ${editing ? '' : `
      <button class="btn btn-wide" type="button" id="scan" style="margin-bottom:12px">Scan a barcode</button>
      <section class="card" id="recent-card" hidden>
        <div class="card-head"><h2>Recent for this meal</h2></div>
        <div class="pick-list" id="recent"></div>
      </section>
      <section class="card" id="foods-card">
        <div class="card-head"><h2>My foods</h2></div>
        <input id="food-search" class="btn-wide" style="width:100%;margin-bottom:6px" autocomplete="off" placeholder="Search" aria-label="Search my foods">
        <div class="pick-list" id="foods"></div>
      </section>
      <section class="card">
        <div class="card-head"><h2>Saved meals</h2></div>
        <div class="pick-list" id="templates"></div>
        <form id="template-form" class="row" style="margin-top:8px" hidden>
          <input id="template-name" class="grow" autocomplete="off" placeholder="Name for this meal" aria-label="Name for this meal">
          <button class="btn" type="submit">Save</button>
        </form>
        <p class="hint" id="template-hint"></p>
      </section>`}`;

  const $ = (selector) => root.querySelector(selector);

  const showNotice = (message) => {
    const notice = $('#notice');
    notice.hidden = !message;
    notice.textContent = message ?? '';
  };

  const syncChips = () => {
    root.querySelectorAll('[data-meal]').forEach((chip) => chip.setAttribute('aria-pressed', String(chip.dataset.meal === meal)));
  };
  syncChips();

  const logEntry = async (values) => {
    const entry = await db.saveEntry({ date, meal, ...values });
    toast(`Added ${entry.name}`, {
      label: 'Undo',
      run: async () => {
        await db.deleteEntry(entry.id);
        await refreshLists();
      },
    });
    await refreshLists();
  };

  const markUsed = (food) => db.saveFood({ ...food, lastUsed: date, useCount: (food.useCount ?? 0) + 1 });

  // --- Manual form ---
  $('#manual').addEventListener('submit', async (event) => {
    event.preventDefault();
    const kcal = parseNum($('#kcal').value);
    const protein = parseNum($('#protein').value);
    const error = $('#manual-error');
    const kcalBad = kcal === null || Number.isNaN(kcal) || kcal > MAX_KCAL;
    const proteinBad = Number.isNaN(protein);
    $('#kcal').setAttribute('aria-invalid', String(kcalBad));
    $('#protein').setAttribute('aria-invalid', String(proteinBad));
    error.hidden = !(kcalBad || proteinBad);
    if (kcalBad) {
      error.textContent = `Enter calories as a number from 0 to ${fmtNum(MAX_KCAL)}.`;
      return;
    }
    if (proteinBad) {
      error.textContent = 'Enter protein as a number, or leave it empty.';
      return;
    }
    const name = $('#name').value.trim();
    if (editing) {
      await db.saveEntry({ ...editing, meal, name: name || QUICK_ENTRY_NAME, kcal, proteinG: protein });
      navigate(back);
      return;
    }
    if ($('#save-food').checked) {
      if (!name) {
        error.hidden = false;
        error.textContent = 'Add a name to save this to your foods.';
        return;
      }
      await db.saveFood({ name, basis: 'serving', kcal, proteinG: protein, barcode: scannedBarcode ?? undefined, lastUsed: date, useCount: 1 });
    }
    await logEntry({ name: name || QUICK_ENTRY_NAME, kcal, proteinG: protein });
    event.target.reset();
    scannedBarcode = null;
    showNotice(null);
    $('#kcal').focus();
  });

  root.querySelectorAll('[data-meal]').forEach((chip) => {
    chip.addEventListener('click', async () => {
      meal = chip.dataset.meal;
      syncChips();
      if (!editing) await refreshLists();
    });
  });

  if (editing) return;

  // --- Portion panel, for foods stored per 100 g or per serving ---
  const closePortion = () => {
    portionFood = null;
    $('#portion').hidden = true;
  };

  const openPortion = (food, { offerSave }) => {
    portionFood = food;
    const per100 = food.basis === '100g';
    const panel = $('#portion');
    panel.hidden = false;
    panel.innerHTML = `
      <div class="card-head"><h2>${esc(food.name)}</h2><button class="icon-btn" type="button" id="portion-close" aria-label="Close">✕</button></div>
      <p class="small muted">${foodLine(food.kcal, food.proteinG, per100 ? ' per 100 g' : ' per serving')}</p>
      <label class="field" style="margin-top:10px">${per100 ? 'Quantity in grams' : 'Servings'}
        <input id="portion-qty" inputmode="decimal" autocomplete="off" value="${per100 ? food.servingG ?? 100 : 1}">
      </label>
      <p class="small" id="portion-total" style="margin-top:8px"></p>
      ${offerSave ? '<label class="check"><input type="checkbox" id="portion-save" checked> Save to my foods</label>' : ''}
      <button class="btn btn-primary btn-wide" type="button" id="portion-add" style="margin-top:8px">Add</button>`;

    const compute = () => {
      const qty = parseNum($('#portion-qty').value);
      if (!qty) return null; // empty, zero or invalid
      const factor = per100 ? qty / 100 : qty;
      return {
        kcal: Math.round(food.kcal * factor),
        proteinG: food.proteinG === null || food.proteinG === undefined ? null : round1(food.proteinG * factor),
      };
    };
    const update = () => {
      const total = compute();
      $('#portion-total').textContent = total ? `Total: ${foodLine(total.kcal, total.proteinG)}` : 'Enter a quantity.';
      $('#portion-add').disabled = !total;
    };
    update();
    $('#portion-qty').addEventListener('input', update);
    $('#portion-close').addEventListener('click', closePortion);
    $('#portion-add').addEventListener('click', async () => {
      const total = compute();
      if (!total) return;
      if (food.id) await markUsed(food);
      else if ($('#portion-save')?.checked) await db.saveFood({ ...food, lastUsed: date, useCount: 1 });
      closePortion();
      showNotice(null);
      await logEntry({ name: food.name, foodId: food.id, ...total });
    });
    panel.scrollIntoView({ block: 'nearest' });
    $('#portion-qty').select();
  };

  // --- Barcode ---
  $('#scan').addEventListener('click', async () => {
    const barcode = await scanBarcode();
    if (!barcode) return;
    closePortion();

    const known = await db.findFoodByBarcode(barcode);
    if (known) {
      showNotice(null);
      openPortion(known, { offerSave: false });
      return;
    }

    showNotice(`Looking up ${barcode}...`);
    const product = await lookupBarcode(barcode);
    if (product.status === 'found') {
      showNotice(null);
      openPortion({
        name: product.name, basis: '100g', kcal: product.kcalPer100g, proteinG: product.proteinPer100g,
        servingG: product.servingG ?? undefined, barcode,
      }, { offerSave: true });
      return;
    }

    // Keep the barcode, so saving this food makes the next scan work.
    scannedBarcode = barcode;
    $('#save-food').checked = true;
    if (product.status === 'incomplete') {
      $('#name').value = product.name ?? '';
      const known100 = [
        product.kcalPer100g === null ? null : `${fmtKcal(product.kcalPer100g)} per 100 g`,
        product.proteinPer100g === null ? null : `${fmtG(product.proteinPer100g)} protein per 100 g`,
      ].filter(Boolean).join(', ');
      showNotice(`The database has incomplete values for this product${known100 ? ` (${known100})` : ''}. Enter this portion from the label.`);
    } else if (product.status === 'offline') {
      showNotice(`Couldn't reach the food database, which needs internet. Enter barcode ${barcode}'s values from the label.`);
    } else {
      showNotice(`Barcode ${barcode} isn't in the database. Enter the values from the label.`);
    }
    $('#kcal').focus();
  });

  // --- Lists ---
  let foods = [];
  let templates = [];
  let mealEntries = [];

  const renderFoods = () => {
    const query = $('#food-search').value.trim().toLowerCase();
    const shown = foods.filter((f) => f.name.toLowerCase().includes(query)).slice(0, FOOD_LIMIT);
    $('#foods').innerHTML = shown.length
      ? shown.map((f) => `
        <button class="pick" type="button" data-food="${esc(f.id)}">
          <span class="entry-name">${esc(f.name)}</span>
          <span class="entry-values">${foodLine(f.kcal, f.proteinG, f.basis === '100g' ? ' /100 g' : '')}</span>
        </button>`).join('')
      : `<p class="small muted">${foods.length ? 'No match.' : 'Foods you save or scan appear here.'}</p>`;
  };

  const refreshLists = async () => {
    const [recentEntries, allFoods, allTemplates] = await Promise.all([
      db.getEntries(addDays(date, -60), date), db.getFoods(), db.getTemplates(),
    ]);
    foods = allFoods.sort((a, b) => (b.useCount ?? 0) - (a.useCount ?? 0) || a.name.localeCompare(b.name));
    templates = allTemplates.sort((a, b) => a.name.localeCompare(b.name));
    mealEntries = recentEntries.filter((e) => e.date === date && e.meal === meal);

    const seen = new Set();
    const recent = recentEntries
      .filter((e) => e.meal === meal && e.name !== QUICK_ENTRY_NAME)
      .sort((a, b) => b.date.localeCompare(a.date))
      .filter((e) => {
        const key = e.name.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, RECENT_LIMIT);

    $('#recent-card').hidden = recent.length === 0;
    $('#recent').innerHTML = recent.map((e) => `
      <button class="pick" type="button" data-recent="${esc(e.id)}">
        <span class="entry-name">${esc(e.name)}</span>
        <span class="entry-values">${foodLine(e.kcal, e.proteinG)}</span>
      </button>`).join('');
    $('#recent').onclick = async (event) => {
      const button = event.target.closest('[data-recent]');
      if (!button) return;
      const source = recent.find((e) => e.id === button.dataset.recent);
      await logEntry({ name: source.name, kcal: source.kcal, proteinG: source.proteinG ?? null, foodId: source.foodId });
    };

    renderFoods();

    $('#templates').innerHTML = templates.length
      ? templates.map((t) => `
        <button class="pick" type="button" data-template="${esc(t.id)}">
          <span class="entry-name">${esc(t.name)}</span>
          <span class="entry-values">${fmtNum(t.items.reduce((s, i) => s + i.kcal, 0))} kcal</span>
        </button>`).join('')
      : '<p class="small muted">No saved meals yet.</p>';

    $('#template-form').hidden = mealEntries.length === 0;
    $('#template-hint').textContent = mealEntries.length
      ? `Save the ${mealEntries.length} item${mealEntries.length === 1 ? '' : 's'} in this ${MEAL_LABELS[meal].toLowerCase()} to re-add them in one tap.`
      : 'Log a meal, then save it here to re-add it in one tap.';
  };

  $('#food-search').addEventListener('input', renderFoods);

  $('#foods').addEventListener('click', (event) => {
    const button = event.target.closest('[data-food]');
    if (button) openPortion(foods.find((f) => f.id === button.dataset.food), { offerSave: false });
  });

  $('#templates').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-template]');
    if (!button) return;
    const template = templates.find((t) => t.id === button.dataset.template);
    const added = await Promise.all(template.items.map((item) => db.saveEntry({ date, meal, ...item })));
    toast(`Added ${template.name}`, {
      label: 'Undo',
      run: async () => {
        await Promise.all(added.map((e) => db.deleteEntry(e.id)));
        await refreshLists();
      },
    });
    await refreshLists();
  });

  $('#template-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = $('#template-name').value.trim();
    if (!name) {
      $('#template-name').setAttribute('aria-invalid', 'true');
      return;
    }
    await db.saveTemplate({
      name,
      items: mealEntries.map((e) => ({ name: e.name, kcal: e.kcal, proteinG: e.proteinG ?? null, foodId: e.foodId })),
    });
    $('#template-name').value = '';
    toast(`Saved ${name}`);
    await refreshLists();
  });

  await refreshLists();
}

import { addDays, buildDays, summarizePeriod, todayISO } from '../calc.js';
import * as db from '../db.js';
import { buildSuggestions } from '../rules.js';
import { esc } from '../ui.js';

const LOOKBACK_DAYS = 56;

// Each level pairs a status colour with its own icon shape and a label, so colour never works alone.
const LEVELS = {
  safety: { label: 'Important', color: 'var(--critical)', icon: '<path d="M12 3 2 20h20Z"/><path d="M12 10v5M12 17.5v.5"/>' },
  warn: { label: 'Needs attention', color: 'var(--warning)', icon: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16v.5"/>' },
  tip: { label: 'Tip', color: 'var(--muted)', icon: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0 0 12 3Z"/>' },
  good: { label: 'On track', color: 'var(--good)', icon: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>' },
};

function card(item) {
  const level = LEVELS[item.level];
  return `
    <section class="card advice">
      <svg class="advice-icon" viewBox="0 0 24 24" fill="none" stroke="${level.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${level.icon}</svg>
      <div class="grow">
        <div class="advice-level">${level.label}</div>
        <h2 class="advice-title">${esc(item.title)}</h2>
        <p class="small">${esc(item.detail)}</p>
        <ul class="num">${item.evidence.map((line) => `<li>${esc(line)}</li>`).join('')}</ul>
      </div>
    </section>`;
}

export async function renderCoach(root) {
  const today = todayISO();
  const start = addDays(today, -(LOOKBACK_DAYS - 1));
  const [records, entries, settings] = await Promise.all([
    db.getDays(start, today), db.getEntries(start, today), db.getSettings(),
  ]);
  const days = buildDays(start, today, records, entries);
  const suggestions = buildSuggestions({ days, entries, settings, today });
  const logged = summarizePeriod(days).loggedDays;

  let body;
  if (suggestions.length) {
    body = suggestions.map(card).join('');
  } else if (logged < 5) {
    body = `
      <section class="card">
        <h2>Not enough data yet</h2>
        <p class="small muted" style="margin-top:4px">You have ${logged} complete day${logged === 1 ? '' : 's'}. Most suggestions start after 5 complete days, so one unusual day can't trigger them.</p>
      </section>`;
  } else {
    body = `
      <section class="card">
        <h2>Nothing to change right now</h2>
        <p class="small muted" style="margin-top:4px">Your recent numbers don't trigger any suggestions. Keep logging.</p>
      </section>`;
  }

  root.innerHTML = `
    <h1>Coach</h1>
    ${body}
    <p class="hint">Based on your logged data and general nutrition guidance. This is not medical advice.</p>`;
}

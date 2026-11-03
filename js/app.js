import * as db from './db.js';
import { renderAddFood } from './views/addFood.js';
import { renderCoach } from './views/coach.js';
import { renderSettings } from './views/settings.js';
import { renderStats } from './views/stats.js';
import { renderToday } from './views/today.js';

const ROUTES = {
  today: { render: renderToday, tab: 'today' },
  add: { render: renderAddFood, tab: 'today' },
  stats: { render: renderStats, tab: 'stats' },
  coach: { render: renderCoach, tab: 'coach' },
  settings: { render: renderSettings, tab: 'settings' },
};

const view = document.getElementById('view');

async function route({ keepScroll = false } = {}) {
  const [path, query] = location.hash.replace(/^#\/?/, '').split('?');
  const current = ROUTES[path] ?? ROUTES.today;
  document.querySelectorAll('.tabs a').forEach((link) => {
    if (link.dataset.tab === current.tab) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  // Each visit gets a fresh element, so listeners from the previous visit go with it.
  const container = document.createElement('div');
  const scrollY = window.scrollY;
  view.replaceChildren(container);
  try {
    await current.render(container, new URLSearchParams(query));
    window.scrollTo(0, keepScroll ? scrollY : 0);
  } catch (error) {
    console.error(error);
    if (container.isConnected) {
      container.innerHTML = '<section class="card"><h2>Something went wrong</h2><p class="small muted" style="margin-top:4px">Your data has not been changed. Try reopening the app.</p></section>';
    }
  }
}

async function start() {
  addEventListener('hashchange', () => route());
  addEventListener('refresh-view', () => route({ keepScroll: true }));
  const settings = await db.getSettings();
  if (!settings.firstUseAt) await db.updateSettings({ firstUseAt: new Date().toISOString() });
  navigator.storage?.persist?.();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
  await route();
}

start();

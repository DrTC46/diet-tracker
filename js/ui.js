// Shared view helpers.

import { fromISO, todayISO, addDays } from './calc.js';

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ESCAPES[ch]);

// Phone keyboards in French locales type a comma as the decimal separator.
export function parseNum(text) {
  const clean = String(text ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (clean === '') return null;
  const n = Number(clean);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

export function parseSigned(text) {
  const clean = String(text ?? '').trim().replace(/\s/g, '').replace(',', '.').replace('−', '-');
  if (clean === '') return null;
  const n = Number(clean);
  return Number.isFinite(n) ? n : NaN;
}

export const fmtNum = (n) => Math.round(n).toLocaleString('en-US');
export const fmtKcal = (n) => (n === null || n === undefined ? '-' : `${fmtNum(n)} kcal`);
export const fmtG = (n) => (n === null || n === undefined ? '-' : `${Math.round(n)} g`);

export function fmtSigned(n, unit = 'kcal') {
  if (n === null || n === undefined) return '-';
  const rounded = Math.round(n);
  const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : '';
  return `${sign}${fmtNum(Math.abs(rounded))}${unit ? ` ${unit}` : ''}`;
}

export function fmtKgSigned(n) {
  if (n === null || n === undefined) return '-';
  const rounded = Math.round(n * 100) / 100;
  const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : '';
  return `${sign}${Math.abs(rounded).toFixed(2)} kg`;
}

export const balanceWord = (n) => (n > 0 ? 'surplus' : n < 0 ? 'deficit' : 'even');

export function dateLabel(iso) {
  const today = todayISO();
  if (iso === today) return 'Today';
  if (iso === addDays(today, -1)) return 'Yesterday';
  return fromISO(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

export const shortDate = (iso) => fromISO(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
export const longDate = (iso) => fromISO(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

let toastTimer;

// One toast at a time. `action` adds a button such as Undo.
export function toast(message, action) {
  document.querySelector('.toast')?.remove();
  clearTimeout(toastTimer);
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  const text = document.createElement('span');
  text.textContent = message;
  el.append(text);
  if (action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = action.label;
    button.addEventListener('click', async () => {
      el.remove();
      await action.run();
    });
    el.append(button);
  }
  document.body.append(el);
  toastTimer = setTimeout(() => el.remove(), action ? 6000 : 2500);
}

// Saves a file. Home-screen apps on phones can't always download, so touch devices use the share sheet.
// Returns false when the user cancels.
export async function saveFile(filename, content, type) {
  const file = new File([content], filename, { type });
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return true;
    } catch (error) {
      if (error.name === 'AbortError') return false;
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

export const navigate = (hash) => {
  location.hash = hash;
};

// Redraws whichever screen is showing and keeps the scroll position.
export const refreshView = () => window.dispatchEvent(new Event('refresh-view'));

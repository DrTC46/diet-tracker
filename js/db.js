// IndexedDB storage. Everything stays on the device; export/import is the backup path.

const DB_NAME = 'diet-tracker';
const DB_VERSION = 1;
const STORES = ['days', 'entries', 'foods', 'mealTemplates', 'settings'];
const SETTINGS_KEY = 'settings';
const BACKUP_APP_ID = 'diet-tracker-backup';
const BACKUP_VERSION = 1;

export const DEFAULT_SETTINGS = {
  targetBalanceKcal: -500,
  proteinTargetG: null,
  goalWeightKg: null,
  startWeightKg: null,
  lastBackupAt: null,
  firstUseAt: null,
};

let dbPromise;

function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('days', { keyPath: 'date' });
      db.createObjectStore('entries', { keyPath: 'id' }).createIndex('date', 'date');
      db.createObjectStore('foods', { keyPath: 'id' }).createIndex('barcode', 'barcode');
      db.createObjectStore('mealTemplates', { keyPath: 'id' });
      db.createObjectStore('settings', { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

const result = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const done = (tx) =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
  });

async function store(name, mode = 'readonly') {
  return (await open()).transaction(name, mode).objectStore(name);
}

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

async function put(name, value) {
  await result((await store(name, 'readwrite')).put(value));
  return value;
}

const remove = async (name, key) => result((await store(name, 'readwrite')).delete(key));
const all = async (name) => result((await store(name)).getAll());

export const getDay = async (date) => result((await store('days')).get(date));

export const getDays = async (start, end) =>
  result((await store('days')).getAll(IDBKeyRange.bound(start, end)));

// Saves only the given fields, so burned and weight can be entered independently.
export async function updateDay(date, fields) {
  const existing = await getDay(date);
  return put('days', { date, burnedKcal: null, weightKg: null, ...existing, ...fields });
}

export const getEntry = async (id) => result((await store('entries')).get(id));

export const getEntries = async (start, end) =>
  result((await store('entries')).index('date').getAll(IDBKeyRange.bound(start, end)));

export const saveEntry = (entry) => put('entries', { id: newId(), ...entry });
export const deleteEntry = (id) => remove('entries', id);

export const getFoods = () => all('foods');
export const saveFood = (food) => put('foods', { id: newId(), lastUsed: null, useCount: 0, ...food });
export const deleteFood = (id) => remove('foods', id);

export const findFoodByBarcode = async (barcode) =>
  result((await store('foods')).index('barcode').get(barcode));

export const getTemplates = () => all('mealTemplates');
export const saveTemplate = (template) => put('mealTemplates', { id: newId(), ...template });
export const deleteTemplate = (id) => remove('mealTemplates', id);

export async function getSettings() {
  const record = await result((await store('settings')).get(SETTINGS_KEY));
  return { ...DEFAULT_SETTINGS, ...record };
}

export async function updateSettings(fields) {
  const settings = { ...(await getSettings()), ...fields, key: SETTINGS_KEY };
  return put('settings', settings);
}

export async function exportAll() {
  const [days, entries, foods, mealTemplates, settings] = await Promise.all([
    all('days'), all('entries'), all('foods'), all('mealTemplates'), getSettings(),
  ]);
  return { app: BACKUP_APP_ID, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), days, entries, foods, mealTemplates, settings };
}

const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);

// Returns a problem description, or null when the backup is safe to restore.
export function validateBackup(data) {
  if (!data || data.app !== BACKUP_APP_ID) return 'This file is not a diet tracker backup.';
  if (data.version !== BACKUP_VERSION) return `Unsupported backup version: ${data.version}.`;
  for (const name of ['days', 'entries', 'foods', 'mealTemplates']) {
    if (!Array.isArray(data[name])) return `The backup is missing "${name}".`;
  }
  if (!data.days.every((d) => isDate(d.date))) return 'The backup has a day with an invalid date.';
  const validEntry = (e) => e.id && isDate(e.date) && typeof e.meal === 'string' && typeof e.name === 'string' && isNumber(e.kcal);
  if (!data.entries.every(validEntry)) return 'The backup has an invalid food entry.';
  if (!data.foods.every((f) => f.id && typeof f.name === 'string' && isNumber(f.kcal))) return 'The backup has an invalid saved food.';
  if (!data.mealTemplates.every((t) => t.id && Array.isArray(t.items))) return 'The backup has an invalid saved meal.';
  return null;
}

// Replaces all data in one transaction, so a failed restore leaves existing data untouched.
export async function importAll(data) {
  const problem = validateBackup(data);
  if (problem) throw new Error(problem);
  const tx = (await open()).transaction(STORES, 'readwrite');
  const finished = done(tx);
  for (const name of STORES) tx.objectStore(name).clear();
  for (const name of ['days', 'entries', 'foods', 'mealTemplates']) {
    for (const item of data[name]) tx.objectStore(name).put(item);
  }
  tx.objectStore('settings').put({ ...DEFAULT_SETTINGS, ...data.settings, key: SETTINGS_KEY });
  await finished;
}

export async function clearAll() {
  const tx = (await open()).transaction(STORES, 'readwrite');
  const finished = done(tx);
  for (const name of STORES) tx.objectStore(name).clear();
  await finished;
}

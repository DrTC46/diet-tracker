// Open Food Facts lookup. Only the barcode is sent.

const API = 'https://world.openfoodfacts.org/api/v2/product';
const FIELDS = 'product_name,brands,nutriments,serving_quantity';
const KJ_PER_KCAL = 4.184;

const number = (v) => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

// status: 'found' (name, kcal and protein per 100 g), 'incomplete' (some values missing), 'notfound'
export function parseProduct(response, barcode) {
  if (!response || response.status !== 1 || !response.product) return { status: 'notfound', barcode };
  const { product } = response;
  const nutriments = product.nutriments ?? {};
  const kj = number(nutriments.energy_100g);
  const kcalPer100g = number(nutriments['energy-kcal_100g']) ?? (kj === null ? null : Math.round(kj / KJ_PER_KCAL));
  const proteinPer100g = number(nutriments.proteins_100g);
  const brand = (product.brands ?? '').split(',')[0].trim();
  const name = [product.product_name?.trim(), brand].filter(Boolean).join(' - ');
  return {
    status: name && kcalPer100g !== null && proteinPer100g !== null ? 'found' : 'incomplete',
    barcode,
    name,
    kcalPer100g,
    proteinPer100g,
    servingG: number(product.serving_quantity),
  };
}

// Adds status 'offline' when the lookup itself fails.
export async function lookupBarcode(barcode) {
  try {
    const response = await fetch(`${API}/${encodeURIComponent(barcode)}.json?fields=${FIELDS}`);
    if (response.status === 404) return { status: 'notfound', barcode };
    if (!response.ok) return { status: 'offline', barcode };
    return parseProduct(await response.json(), barcode);
  } catch {
    return { status: 'offline', barcode };
  }
}

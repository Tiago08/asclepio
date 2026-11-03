import { supabase } from './supabaseClient.js';
import { USDA_API_KEY } from './config.js';

// Campos nutricionales que manejamos en toda la app, en el orden
// en que se muestran. Un solo lugar para no desincronizar listas.
export const NUTRIENT_FIELDS = [
  { key: 'kcal', label: 'Energía', unit: 'kcal' },
  { key: 'carbs_g', label: 'Carbohidratos', unit: 'g' },
  { key: 'sugars_g', label: 'Azúcares', unit: 'g' },
  { key: 'protein_g', label: 'Proteína', unit: 'g' },
  { key: 'fat_g', label: 'Grasa total', unit: 'g' },
  { key: 'sat_fat_g', label: 'Grasa saturada', unit: 'g' },
  { key: 'fiber_g', label: 'Fibra', unit: 'g' },
  { key: 'sodium_mg', label: 'Sodio', unit: 'mg' },
  { key: 'potassium_mg', label: 'Potasio', unit: 'mg' },
  { key: 'calcium_mg', label: 'Calcio', unit: 'mg' },
  { key: 'iron_mg', label: 'Hierro', unit: 'mg' },
  { key: 'vit_a_mcg', label: 'Vitamina A', unit: 'mcg' },
  { key: 'vit_c_mg', label: 'Vitamina C', unit: 'mg' },
  { key: 'vit_d_mcg', label: 'Vitamina D', unit: 'mcg' },
  { key: 'vit_b12_mcg', label: 'Vitamina B12', unit: 'mcg' }
];

// nutrientNumber (USDA, estable entre bases) -> nuestro campo
const USDA_NUTRIENT_MAP = {
  '208': 'kcal', '1008': 'kcal',
  '205': 'carbs_g', '1005': 'carbs_g',
  '269': 'sugars_g', '1063': 'sugars_g',
  '203': 'protein_g', '1003': 'protein_g',
  '204': 'fat_g', '1004': 'fat_g',
  '606': 'sat_fat_g', '1258': 'sat_fat_g',
  '291': 'fiber_g', '1079': 'fiber_g',
  '307': 'sodium_mg', '1093': 'sodium_mg',
  '306': 'potassium_mg', '1092': 'potassium_mg',
  '301': 'calcium_mg', '1087': 'calcium_mg',
  '303': 'iron_mg', '1089': 'iron_mg',
  '320': 'vit_a_mcg', '1106': 'vit_a_mcg',
  '401': 'vit_c_mg', '1162': 'vit_c_mg',
  '328': 'vit_d_mcg', '1114': 'vit_d_mcg',
  '418': 'vit_b12_mcg', '1178': 'vit_b12_mcg'
};

function emptyNutrients() {
  const o = {};
  NUTRIENT_FIELDS.forEach(f => { o[f.key] = null; });
  return o;
}

function usdaFoodToRow(food) {
  const row = emptyNutrients();
  (food.foodNutrients || []).forEach(n => {
    const num = String(n.nutrientNumber ?? n.number ?? '');
    const field = USDA_NUTRIENT_MAP[num];
    if (field && row[field] == null) {
      row[field] = typeof n.value === 'number' ? n.value : (n.amount ?? null);
    }
  });
  return {
    source: 'usda',
    usda_fdc_id: String(food.fdcId),
    name: food.description,
    brand: food.brandOwner || food.brandName || null,
    category: food.foodCategory || null,
    serving_label: '100 g',
    serving_grams: 100,
    ...row
  };
}

export async function searchUsda(query) {
  if (!query || query.trim().length < 2) return [];
  const url = new URL('https://api.nal.usda.gov/fdc/v1/foods/search');
  url.searchParams.set('api_key', USDA_API_KEY);
  url.searchParams.set('query', query);
  url.searchParams.set('pageSize', '12');
  url.searchParams.set('dataType', 'Branded,Foundation,SR Legacy');

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error('USDA search failed: ' + res.status);
  const json = await res.json();
  return (json.foods || []).map(usdaFoodToRow);
}

export async function searchLocalFoods(query) {
  if (!query || query.trim().length < 2) return [];
  const { data, error } = await supabase
    .from('foods')
    .select('*')
    .ilike('name', `%${query.trim()}%`)
    .order('name', { ascending: true })
    .limit(15);
  if (error) throw error;
  return data || [];
}

export async function searchFavorites(userId, limit = 6) {
  // "más frecuentes" = alimentos más logueados por este usuario en food_logs
  const { data, error } = await supabase
    .from('food_logs')
    .select('food_id, food_name_snapshot')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;

  const counts = new Map();
  (data || []).forEach(r => {
    if (!r.food_id) return;
    const prev = counts.get(r.food_id) || { count: 0, name: r.food_name_snapshot, food_id: r.food_id };
    prev.count += 1;
    counts.set(r.food_id, prev);
  });
  const topIds = [...counts.values()].sort((a, b) => b.count - a.count).slice(0, limit).map(x => x.food_id);
  if (topIds.length === 0) return [];

  const { data: foods, error: err2 } = await supabase.from('foods').select('*').in('id', topIds);
  if (err2) throw err2;
  // mantener el orden de frecuencia
  const byId = new Map(foods.map(f => [f.id, f]));
  return topIds.map(id => byId.get(id)).filter(Boolean);
}

/** Inserta (si hace falta) una copia local de un resultado de USDA y devuelve la fila de foods. */
export async function cacheUsdaFood(usdaRow, userId) {
  const { data: existing } = await supabase
    .from('foods')
    .select('*')
    .eq('source', 'usda')
    .eq('usda_fdc_id', usdaRow.usda_fdc_id)
    .maybeSingle();
  if (existing) return existing;

  const { data, error } = await supabase
    .from('foods')
    .insert({ ...usdaRow, created_by: userId })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function addCustomFood(fields, userId) {
  const { data, error } = await supabase
    .from('foods')
    .insert({ ...fields, source: 'custom', created_by: userId })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateFood(id, fields) {
  const { data, error } = await supabase
    .from('foods')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function logFood({ userId, foodRow, quantity, momento, date, time }) {
  const payload = {
    user_id: userId,
    food_id: foodRow.id,
    food_name_snapshot: foodRow.name,
    momento,
    quantity,
    log_date: date,
    log_time: time
  };
  NUTRIENT_FIELDS.forEach(f => {
    const base = foodRow[f.key];
    payload[f.key] = (base === null || base === undefined) ? null : Number(base) * Number(quantity);
  });
  const { data, error } = await supabase.from('food_logs').insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function deleteFoodLog(id) {
  const { error } = await supabase.from('food_logs').delete().eq('id', id);
  if (error) throw error;
}

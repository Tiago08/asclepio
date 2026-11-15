// Fase 3: metas de micronutrientes. Valores de referencia de adultos
// (Ingestas Dietéticas de Referencia del NIH/Academias Nacionales de EE. UU.):
//   min  = requerimiento promedio (EAR): referencia poblacional, no diagnóstico
//   goal = la recomendación (RDA, o AI si no hay RDA): lo que conviene cubrir
//   max  = límite de referencia según el nutriente; no diagnostica toxicidad
// Azúcares totales se muestran sin confundirlos con azúcares añadidos.
// Como una ventana de tolerancia de un componente: mínimo, nominal y máximo.
import { NUTRIENT_FIELDS, MICRO_FIELDS } from './foods.js?v=30';

// [hombre, mujer] para cada valor; null = sin ese límite
const REF = {
  fiber_g:      { min: null,         goal: [38, 25],     max: null },
  sugars_g:     { informational: true }, // Se registra azúcar total; el límite es de azúcares añadidos.
  sat_fat_g:    { limit: 'satfat' },
  sodium_mg:    { min: null,         goal: [1500, 1500], max: [2300, 2300] },
  potassium_mg: { min: null,         goal: [3400, 2600], max: null },
  calcium_mg:   { min: [800, 800],   goal: [1000, 1000], max: [2500, 2500] },
  iron_mg:      { min: [6, 8.1],     goal: [8, 18],      max: [45, 45] },
  vit_a_mcg:    { min: [625, 500],   goal: [900, 700],   max: null }, // UL solo de vitamina A preformada, no del total RAE.
  vit_c_mg:     { min: [75, 60],     goal: [90, 75],     max: [2000, 2000] },
  vit_d_mcg:    { min: [10, 10],     goal: [15, 15],     max: [100, 100] },
  vit_b12_mcg:  { min: [2, 2],       goal: [2.4, 2.4],   max: null },
  magnesium_mg: { min: [330, 255],   goal: [400, 310],   max: null },   // el máximo (350) es solo para suplementos
  zinc_mg:      { min: [9.4, 6.8],   goal: [11, 8],      max: [40, 40] },
  vit_b6_mg:    { min: [1.1, 1.1],   goal: [1.3, 1.3],   max: [100, 100] },
  folate_mcg:   { min: [320, 320],   goal: [400, 400],   max: null },   // el máximo (1000) es solo para ácido fólico añadido
  omega3_mg:    { min: null,         goal: [500, 500],   max: null }    // objetivo orientativo de la app, no DRI ni EAR de EPA+DHA
};

// en orden: primero lo que suele faltar, al final lo que hay que limitar
const ORDER = ['fiber_g', 'potassium_mg', 'magnesium_mg', 'calcium_mg', 'vit_d_mcg', 'iron_mg', 'zinc_mg',
  'vit_a_mcg', 'vit_c_mg', 'vit_b6_mg', 'vit_b12_mcg', 'folate_mcg', 'omega3_mg', 'sodium_mg', 'sugars_g', 'sat_fat_g'];

const FIELD = Object.fromEntries([...NUTRIENT_FIELDS, ...MICRO_FIELDS].map(f => [f.key, f]));

/** Metas de cada micronutriente para esa persona. sex: 'hombre' | 'mujer' | null; age en años o null. */
export function microTargets(sex, age, goalKcal) {
  const i = sex === 'mujer' ? 1 : 0;
  const out = [];
  for (const key of ORDER) {
    const r = REF[key], f = FIELD[key];
    if (!f) continue;
    if(r.informational){out.push({key,label:f.label,unit:f.unit,min:null,goal:null,max:null,informational:true});continue;}
    if (r.limit) {
      // Grasa saturada: referencia de menos del 10 % de las calorías.
      const kcal = goalKcal || 2000;
      const max = Math.round(kcal * 0.1 / 9);
      out.push({ key, label: f.label, unit: f.unit, min: null, goal: null, max, limitOnly: true });
      continue;
    }
    let min = r.min ? r.min[i] : null, goal = r.goal[i], max = r.max ? r.max[i] : null;
    if (age != null) {
      if (key === 'magnesium_mg' && age >= 31) { min = i ? 265 : 350; goal = i ? 320 : 420; }
      if (key === 'iron_mg' && i === 1 && age >= 51) { min = 5; goal = 8; }
      if (key === 'calcium_mg' && ((i === 1 && age >= 51) || age >= 71)) { min = 1000; goal = 1200; max = 2000; }
      if (key === 'vit_b6_mg' && age >= 51) { min = i ? 1.3 : 1.4; goal = i ? 1.5 : 1.7; }
      if (key === 'fiber_g' && age >= 51) { goal = i ? 21 : 30; }
      if (key === 'calcium_mg' && age >= 51) max = 2000;
      if (key === 'vit_d_mcg' && age >= 71) goal = 20;
    }
    out.push({ key, label: f.label, unit: f.unit, min, goal, max, limitOnly: false });
  }
  return out;
}

/** Suma de cada nutriente en los food_logs del día (y sodio, potasio y magnesio de las bebidas). */
export function microTotals(foodRows, waterRows = []) {
  const t = {}, has = {}, coverage = {};
  const add = (k, v) => {
    if (v == null || typeof v==='boolean' || String(v).trim()==='' || !Number.isFinite(Number(v)) || Number(v)<0) return false;
    t[k] = (t[k] || 0) + Number(v);
    has[k] = true;
    return true;
  };
  for (const r of foodRows) {
    for (const k of ORDER) {
      coverage[k] ||= {known:0,total:foodRows.length};
      const v=r[k] != null && r[k] !== '' ? r[k] : r.micros?.[k];
      if(add(k,v)) coverage[k].known++;
    }
  }
  for (const w of waterRows) {
    for(const k of ['sodium_mg','potassium_mg','magnesium_mg']){
      coverage[k] ||= {known:0,total:foodRows.length};
      coverage[k].total++;
      if(add(k,w[k])) coverage[k].known++;
    }
  }
  return { totals: t, has, coverage };
}

/**
 * Estado de un nutriente:
 *  'over' (pasaste el máximo), 'ok' (llegaste a la meta), 'near' (pasaste el mínimo),
 *  'low' (por debajo del mínimo) o 'none' (ningún alimento de hoy trae el dato).
 */
export function microStatus(target, value, hasData, complete = true) {
  if (!hasData) return 'none';
  if (target.max != null && value > target.max) return 'over';
  if (target.informational) return 'info';
  if (!complete) return 'partial';
  if (target.limitOnly) return 'ok';
  if (value >= target.goal) return 'ok';
  if (target.min != null && value >= target.min) return 'near';
  return 'low';
}

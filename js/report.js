import { NUTRIENT_FIELDS, MICRO_FIELDS, foodLogLabel } from './foods.js?v=9';

function fmtNum(v){
  if(v === null || v === undefined) return '—';
  return Math.round(v * 10) / 10;
}

/**
 * goalsFor(date) da las metas que valían ese día.
 * water, suppLogs y weights son filas del rango; suppNames: id -> nombre.
 */
export function buildReportText({ displayName, fromDate, toDate, entries, goalsFor, water = [], suppLogs = [], suppNames = new Map(), weights = [] }){
  const lines = [];
  lines.push(`ASCLEPIO — reporte de ${displayName}`);
  lines.push(fromDate === toDate ? `Fecha: ${fromDate}` : `Rango: ${fromDate} a ${toDate}`);
  lines.push('');

  const byDate = {};
  entries.forEach(e => { (byDate[e.date] = byDate[e.date] || []).push(e); });
  // también cuentan los días que solo tienen agua, suplementos o peso
  [...water, ...suppLogs, ...weights].forEach(r => { byDate[r.log_date] = byDate[r.log_date] || []; });
  const dates = Object.keys(byDate).sort();

  dates.forEach(date => {
    lines.push(`## ${date}`);
    const dayEntries = byDate[date].sort((a,b) => a.time.localeCompare(b.time));

    const totals = {};
    NUTRIENT_FIELDS.forEach(f => totals[f.key] = 0);
    const micros = {};
    MICRO_FIELDS.forEach(f => micros[f.key] = 0);
    let hadFood = false;

    dayEntries.forEach(e => {
      if(e.kind === 'food'){
        hadFood = true;
        const d = e.data;
        lines.push(`- [${e.time}] Comida (${d.momento}): ${foodLogLabel(d)}`);
        NUTRIENT_FIELDS.forEach(f => { if(d[f.key] != null) totals[f.key] += Number(d[f.key]); });
        MICRO_FIELDS.forEach(f => { const v = d.micros && d.micros[f.key]; if(v != null) micros[f.key] += Number(v); });
      } else if(e.type === 'gym'){
        const d = e.data;
        const tipos = Array.isArray(d.tipos) && d.tipos.length ? d.tipos.join(' + ') : (d.entreno || 'entrenamiento');
        lines.push(`- [${e.time}] Gym: ${d.fue === false ? 'día de descanso' : `${tipos}${d.duracion ? ' (' + d.duracion + ' min)' : ''}${d.rpe ? ', RPE ' + d.rpe + '/10' : ''}`}`);
      } else if(e.type === 'bano'){
        const d = e.data;
        const extras = Array.isArray(d.extras) && d.extras.length ? d.extras.join(', ') : '';
        const detalle = [d.tipo, extras, d.nota].filter(Boolean).join(' · ');
        lines.push(`- [${e.time}] Baño${detalle ? ': ' + detalle : ''}`);
      } else if(e.type === 'sueno'){
        const d = e.data;
        const dur = d.duracion_h != null ? `, duración ${d.duracion_h} h` : '';
        const lat = d.latencia_min != null ? `, latencia ${d.latencia_min} min` : '';
        lines.push(`- [${e.time}] Sueño: dejó el teléfono ${d.dejoTelefono || '?'}, durmió ${d.horaDormir || '?'} → ${d.horaDespertar || '?'}${dur}${lat}, calidad ${d.calidad || '?'}/5`);
      } else if(e.type === 'energia'){
        const d = e.data;
        lines.push(`- [${e.time}] Energía (${d.momento}): ${d.nivel}/5${d.nota ? ' · ' + d.nota : ''}`);
      } else if(e.type === 'nota'){
        lines.push(`- [${e.time}] Nota: ${e.data.texto}`);
      }
    });

    const g = goalsFor ? goalsFor(date) : null;
    const dayWater = water.filter(w => w.log_date === date);
    const ml = dayWater.reduce((s, w) => s + Number(w.ml), 0);
    if(dayWater.length){
      const drinks = dayWater.filter(w => w.label || w.sodium_mg || w.potassium_mg || w.magnesium_mg)
        .map(w => `${Math.round(w.ml)} ml ${w.label || 'bebida'}${w.sodium_mg ? `, Na ${w.sodium_mg} mg` : ''}${w.potassium_mg ? `, K ${w.potassium_mg} mg` : ''}${w.magnesium_mg ? `, Mg ${w.magnesium_mg} mg` : ''}`);
      lines.push(`- Agua: ${Math.round(ml)} ml${g ? ` / meta ${Math.round(g.goal_water_ml)} ml` : ''}${drinks.length ? ' (incluye: ' + drinks.join('; ') + ')' : ''}`);
      dayWater.forEach(w => {
        if(w.sodium_mg) totals.sodium_mg += Number(w.sodium_mg);
        if(w.potassium_mg) totals.potassium_mg += Number(w.potassium_mg);
        if(w.magnesium_mg) micros.magnesium_mg += Number(w.magnesium_mg);
      });
    }
    const supps = suppLogs.filter(s => s.log_date === date).map(s => suppNames.get(s.supplement_id) || 'suplemento');
    if(supps.length) lines.push(`- Suplementos: ${supps.join(', ')}`);
    const w = weights.find(x => x.log_date === date);
    if(w) lines.push(`- Peso: ${w.weight_kg} kg`);

    if(hadFood){
      lines.push('');
      lines.push('  Totales del día (comida' + (dayWater.length ? ' + bebidas' : '') + '):');
      NUTRIENT_FIELDS.forEach(f => {
        lines.push(`  - ${f.label}: ${fmtNum(totals[f.key])} ${f.unit}`);
      });
      MICRO_FIELDS.forEach(f => {
        lines.push(`  - ${f.label}: ${fmtNum(micros[f.key])} ${f.unit}`);
      });
      if(g){
        lines.push(`  - vs. meta del día: ${fmtNum(totals.kcal)}/${g.goal_kcal} kcal · ${fmtNum(totals.protein_g)}/${g.goal_protein_g} g prot · ${fmtNum(totals.carbs_g)}/${g.goal_carbs_g} g carb · ${fmtNum(totals.fat_g)}/${g.goal_fat_g} g grasa`);
      }
    }
    lines.push('');
  });

  if(dates.length === 0){
    lines.push('(sin registros en este rango)');
  }

  return lines.join('\n');
}

export function downloadText(filename, text){
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

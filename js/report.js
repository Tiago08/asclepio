import { NUTRIENT_FIELDS } from './foods.js?v=5';

function fmtNum(v){
  if(v === null || v === undefined) return '—';
  return Math.round(v * 10) / 10;
}

export function buildReportText({ displayName, fromDate, toDate, entries, profile }){
  const lines = [];
  lines.push(`ASCLEPIO — reporte de ${displayName}`);
  lines.push(fromDate === toDate ? `Fecha: ${fromDate}` : `Rango: ${fromDate} a ${toDate}`);
  lines.push('');

  const byDate = {};
  entries.forEach(e => { (byDate[e.date] = byDate[e.date] || []).push(e); });
  const dates = Object.keys(byDate).sort();

  dates.forEach(date => {
    lines.push(`## ${date}`);
    const dayEntries = byDate[date].sort((a,b) => a.time.localeCompare(b.time));

    const totals = {};
    NUTRIENT_FIELDS.forEach(f => totals[f.key] = 0);
    let hadFood = false;

    dayEntries.forEach(e => {
      if(e.kind === 'food'){
        hadFood = true;
        const d = e.data;
        lines.push(`- [${e.time}] Comida (${d.momento}): ${d.food_name_snapshot} x${d.quantity}`);
        NUTRIENT_FIELDS.forEach(f => { if(d[f.key] != null) totals[f.key] += Number(d[f.key]); });
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

    if(hadFood){
      lines.push('');
      lines.push('  Totales del día:');
      NUTRIENT_FIELDS.forEach(f => {
        lines.push(`  - ${f.label}: ${fmtNum(totals[f.key])} ${f.unit}`);
      });
      if(profile){
        lines.push(`  - vs. meta: ${fmtNum(totals.kcal)}/${profile.goal_kcal} kcal · ${fmtNum(totals.protein_g)}/${profile.goal_protein_g} g prot · ${fmtNum(totals.carbs_g)}/${profile.goal_carbs_g} g carb · ${fmtNum(totals.fat_g)}/${profile.goal_fat_g} g grasa`);
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

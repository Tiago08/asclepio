// Indicadores descriptivos del diario; no representan fases ni un diagnóstico.
export function sleepMetrics(data){
  const minutes = value => {
    if(!/^\d{2}:\d{2}$/.test(value || '')) return null;
    const [h, m] = value.split(':').map(Number);
    return h < 24 && m < 60 ? h * 60 + m : null;
  };
  const bed = minutes(data.horaDormir), wake = minutes(data.horaDespertar);
  const phone = minutes(data.dejoTelefono);
  const span = bed != null && wake != null ? (wake - bed + 1440) % 1440 : null;
  const awake = data.despierto_min === '' || data.despierto_min == null ? 0 : Number(data.despierto_min);
  const valid = span > 0 && span <= 960 && Number.isInteger(awake) && awake >= 0 && awake < span;
  const gap = phone != null && bed != null ? (bed - phone + 1440) % 1440 : null;
  return { dur: valid ? span - awake : null, lat: gap != null && gap <= 360 ? gap : null };
}

export function sleepReference(birthYear, year = new Date().getFullYear()){
  const age = birthYear ? year - birthYear : null;
  if(age != null && age < 18) return { min: 480, target: 540, label: '8–10 h para adolescentes' };
  if(age != null && age >= 65) return { min: 420, target: 450, label: '7–8 h a partir de 65 años' };
  return { min: 420, target: 480, label: 'Al menos 7 h para adultos; 8 h como referencia visual' };
}

export function sleepScore(entries, minimum){
  const rows = entries.filter(e => sleepMetrics(e.data).dur != null && Number(e.data.calidad) >= 1 && Number(e.data.calidad) <= 5);
  if(rows.length < 3) return null;
  const mean = xs => xs.reduce((a,b) => a+b, 0) / xs.length;
  const clock = text => { const [h,m] = text.split(':').map(Number); return h*60+m; };
  // Diferencias circulares: 23:30 y 00:30 están a una hora, incluso para turnos diurnos.
  const difference = (a,b) => Math.min(Math.abs(a-b), 1440-Math.abs(a-b));
  const variability = key => {
    const xs = rows.map(e => clock(e.data[key]));
    const center = xs.reduce((best, x) => mean(xs.map(v => difference(v,x))) < mean(xs.map(v => difference(v,best))) ? x : best);
    return mean(xs.map(x => difference(x,center)));
  };
  const duration = Math.round(50 * mean(rows.map(e => Math.min(1, sleepMetrics(e.data).dur / minimum))));
  const variation = (variability('horaDormir') + variability('horaDespertar')) / 2;
  const regularity = Math.round(30 * Math.max(0, 1 - variation / 120));
  const quality = Math.round(20 * mean(rows.map(e => Number(e.data.calidad) / 5)));
  return { total: duration + regularity + quality, duration, regularity, quality, nights: rows.length };
}

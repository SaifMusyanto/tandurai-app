export const PHASES = Object.freeze([
  { id: 'inoculation', number: 1, title: 'Masukkan bibit', short: 'Bibit dimasukkan', description: 'Bibit jamur baru dimasukkan ke baglog. Pastikan alat dan tangan bersih.' },
  { id: 'incubation', number: 2, title: 'Tunggu miselium tumbuh', short: 'Masa pertumbuhan', description: 'Simpan baglog dan pantau sampai miselium putih tumbuh merata.' },
  { id: 'fruiting', number: 3, title: 'Mulai pembentukan jamur', short: 'Jamur mulai tumbuh', description: 'Buka baglog sesuai prosedur dan jaga suhu serta kelembapan kumbung.' },
  { id: 'harvesting', number: 4, title: 'Masa panen', short: 'Siap dipanen', description: 'Periksa jamur setiap hari dan catat setiap hasil panen.' },
  { id: 'completed', number: 5, title: 'Siklus selesai', short: 'Selesai', description: 'Siklus baglog selesai. Bersihkan kumbung sebelum memulai batch baru.' },
]);

export const STATUS_LABELS = Object.freeze({
  active: 'Aktif', maintenance: 'Perawatan', inactive: 'Tidak aktif',
  completed: 'Selesai', cancelled: 'Dibatalkan',
});

export const SUBSTRATE_LABELS = Object.freeze({
  'serbuk-kayu': 'Serbuk kayu', jerami: 'Jerami', 'tandan-kosong': 'Tandan kosong',
  campuran: 'Campuran', lainnya: 'Lainnya',
});

export const GRADE_LABELS = Object.freeze({ A: 'A — kualitas terbaik', B: 'B — kualitas baik', C: 'C — kualitas rendah', mixed: 'Campuran' });

export const phaseInfo = stage => PHASES.find(phase => phase.id === stage) || PHASES[0];

export function nextPhase(stage) {
  const index = PHASES.findIndex(phase => phase.id === stage);
  return PHASES[Math.min(Math.max(index, 0) + 1, PHASES.length - 1)];
}

export function resolveHarvestLedger(rawEvents = []) {
  const corrections = new Map();
  rawEvents.filter(event => event.correctsEventId).forEach(event => {
    const current = corrections.get(event.correctsEventId);
    if (!current || Number(event.createdAt) > Number(current.createdAt)) corrections.set(event.correctsEventId, event);
  });
  return rawEvents
    .filter(event => !event.correctsEventId)
    .map(event => {
      const correction = corrections.get(event.id);
      return correction
        ? { ...correction, id: event.id, correctionEventId: correction.id, corrected: true, original: event }
        : event;
    })
    .sort((a, b) => Number(b.harvestedAt) - Number(a.harvestedAt));
}

export const dateInputJakarta = timestamp => {
  if (!timestamp) return '';
  const date = new Date(Number(timestamp) + 7 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
};

export const datetimeInputJakarta = timestamp => {
  if (!timestamp) return '';
  const date = new Date(Number(timestamp) + 7 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 16);
};


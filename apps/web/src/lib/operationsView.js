// Tahap budidaya dengan istilah petani; `next` = label tombol untuk pindah ke tahap berikutnya.
export const PHASES = Object.freeze([
  { id: 'inoculation', number: 1, title: 'Inokulasi', short: 'Inokulasi (bibit masuk)', description: 'Bibit jamur baru dimasukkan ke baglog. Jaga alat dan tangan tetap bersih.', next: 'Bibit sudah masuk, mulai inkubasi' },
  { id: 'incubation', number: 2, title: 'Inkubasi', short: 'Miselium tumbuh', description: 'Simpan baglog di tempat gelap dan pantau sampai miselium putih tumbuh merata.', next: 'Miselium sudah penuh, buka baglog' },
  { id: 'fruiting', number: 3, title: 'Buka baglog', short: 'Jamur mulai tumbuh', description: 'Baglog dibuka. Jaga kelembapan dengan pengkabutan dan sirkulasi udara.', next: 'Jamur sudah muncul, mulai masa panen' },
  { id: 'harvesting', number: 4, title: 'Masa panen', short: 'Siap dipanen', description: 'Periksa jamur setiap hari dan catat setiap hasil panen.', next: 'Panen sudah habis, siklus selesai' },
  { id: 'completed', number: 5, title: 'Selesai', short: 'Selesai', description: 'Siklus baglog selesai. Bersihkan kumbung sebelum memulai batch baru.', next: null },
]);

export const STATUS_LABELS = Object.freeze({
  active: 'Aktif', maintenance: 'Perawatan', inactive: 'Tidak aktif',
  completed: 'Selesai', cancelled: 'Dibatalkan',
});

export const SUBSTRATE_LABELS = Object.freeze({
  'serbuk-kayu': 'Serbuk kayu', jerami: 'Jerami', 'tandan-kosong': 'Tandan kosong',
  campuran: 'Campuran', lainnya: 'Lainnya',
});

export const GRADE_LABELS = Object.freeze({ A: 'Bagus (A)', B: 'Sedang (B)', C: 'Rendah (C)', mixed: 'Campur' });

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


// ───────────────────────────── kegiatan kumbung & rekap (kode sama dengan backend)

export const CARE_OPTIONS = Object.freeze([
  { id: 'misting', label: 'Pengkabutan / siram' },
  { id: 'cleaning', label: 'Bersihkan kumbung' },
  { id: 'ventilation', label: 'Buka / tutup ventilasi' },
  { id: 'pest_check', label: 'Cek hama' },
  { id: 'other', label: 'Lainnya' },
]);

export const PROBLEM_OPTIONS = Object.freeze([
  { id: 'contamination', label: 'Baglog kontaminasi / dibuang' },
  { id: 'pest', label: 'Ada hama' },
  { id: 'no_growth', label: 'Jamur tidak tumbuh' },
  { id: 'other', label: 'Lainnya' },
]);

export const ITEM_LABELS = Object.freeze({
  ...Object.fromEntries([...CARE_OPTIONS, ...PROBLEM_OPTIONS].map(option => [option.id, option.label])),
  other: 'Lainnya',
  ...Object.fromEntries(PHASES.map(phase => [phase.id, phase.title])),
  cancelled: 'Afkir',
});

/** Jenis baris rekap (filter) dan label jenis catatan. */
export const RECAP_KINDS = Object.freeze([
  { id: 'harvest', label: 'Panen' },
  { id: 'care', label: 'Kegiatan harian' },
  { id: 'problem', label: 'Masalah' },
  { id: 'batch', label: 'Batch' },
]);
export const TYPE_LABELS = Object.freeze({
  harvest: 'Panen', care: 'Kegiatan', note: 'Catatan', problem: 'Masalah',
  batch_start: 'Batch dimulai', phase_change: 'Ganti tahap', batch_end: 'Batch ditutup',
});

/** Nomor urut batch dari ID backend (`…-B03` → 3). */
export const batchNumber = batch => Number(/-B(\d+)$/.exec(batch?.id || '')?.[1]) || null;

const shortDate = timestamp => new Date(Number(timestamp)).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', timeZone: 'Asia/Jakarta' });

/** "Batch 3 · masuk 12 Okt" */
export const batchLabel = batch => (batch ? `Batch ${batchNumber(batch) ?? batch.id} · masuk ${shortDate(batch.startedAt)}` : '');

/** Hari ke-N sejak baglog masuk (hari masuk = hari ke-1, hitungan tanggal WIB). */
export function batchDay(batch, now = Date.now()) {
  const day = value => Math.floor((Number(value) + 7 * 3600 * 1000) / 86_400_000);
  return day(now) - day(batch.startedAt) + 1;
}

/** Tanggal hari ini (WIB) sebagai YYYY-MM-DD, digeser `offsetDays`. */
export const todayJakarta = (offsetDays = 0, now = Date.now()) => new Date(now + 7 * 3600 * 1000 + offsetDays * 86_400_000).toISOString().slice(0, 10);

export const formatKg = value => `${Number(value || 0).toLocaleString('id-ID', { maximumFractionDigits: 2 })} kg`;
export const formatTime = timestamp => new Date(Number(timestamp)).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' });
export const formatDateTime = timestamp => new Date(Number(timestamp)).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' });

/** Kalimat ringkas satu baris rekap untuk ditampilkan ke petani. */
export function describeRecapRow(row) {
  if (row.kind === 'harvest') return `${formatKg(row.weightKg)} · ${GRADE_LABELS[row.grade] || row.grade}`;
  if (row.type === 'phase_change') return row.items.map(item => ITEM_LABELS[item] || item).join(' → ');
  if (row.type === 'batch_start') return `${Number(row.quantity || 0).toLocaleString('id-ID')} baglog masuk`;
  if (row.type === 'batch_end') return `${ITEM_LABELS[row.items[0]] || 'Selesai'} · ${Number(row.quantity || 0).toLocaleString('id-ID')} baglog tersisa`;
  const text = row.items.map(item => ITEM_LABELS[item] || item).join(', ');
  return row.quantity ? `${text} · ${row.quantity} baglog` : text || row.notes;
}

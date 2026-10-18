// Pilihan & label laporan farm (kode sama dengan apps/api/src/reports.js).

export const SECTIONS = [
  { id: 'parameters', label: 'Parameter kumbung', hint: 'suhu, kelembapan, CO₂ + % waktu optimal' },
  { id: 'harvest', label: 'Panen', hint: 'berat, jumlah panen, mutu' },
  { id: 'activities', label: 'Kegiatan', hint: 'kegiatan harian, masalah, baglog dibuang' },
  { id: 'alerts', label: 'Peringatan', hint: 'jumlah alert kritis & peringatan' },
];
export const FREQUENCIES = [
  { id: 'daily', label: 'Harian', period: 'data kemarin' },
  { id: 'weekly', label: 'Mingguan', period: '7 hari terakhir' },
  { id: 'monthly', label: 'Bulanan', period: 'bulan lalu' },
];
export const WEEKDAYS = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];
export const hourLabel = hour => `${String(hour).padStart(2, '0')}.00`;

/** "Setiap Senin pukul 07.00 WIB" */
export function describeSchedule(schedule) {
  const time = `pukul ${hourLabel(schedule.sendHour)} WIB`;
  if (schedule.frequency === 'daily') return `Setiap hari ${time}`;
  if (schedule.frequency === 'weekly') return `Setiap ${WEEKDAYS[(schedule.weekday || 1) - 1]} ${time}`;
  return `Setiap tanggal ${schedule.monthDay} ${time}`;
}

export const formatDateTime = timestamp => (timestamp
  ? new Date(timestamp).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' })
  : '—');

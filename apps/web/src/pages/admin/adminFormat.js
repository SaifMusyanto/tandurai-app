/** "5 menit lalu" / "3 hari lalu" untuk waktu terakhir di konsol admin. */
export function timeAgo(timestamp) {
  if (!timestamp) return '—';
  const minutes = Math.max(0, Math.floor((Date.now() - Number(timestamp)) / 60000));
  if (minutes < 1) return 'baru saja';
  if (minutes < 60) return `${minutes} menit lalu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;
  const days = Math.floor(hours / 24);
  return days < 60 ? `${days} hari lalu` : new Date(Number(timestamp)).toLocaleDateString('id-ID', { dateStyle: 'medium' });
}

export const formatDate = timestamp => (timestamp ? new Date(Number(timestamp)).toLocaleDateString('id-ID', { dateStyle: 'medium' }) : '—');

export const ROLE_LABELS = { owner: 'Owner', operator: 'Operator' };
export const STAGE_LABELS = { inoculation: 'Inokulasi', incubation: 'Inkubasi', fruiting: 'Buka baglog', harvesting: 'Masa panen', completed: 'Selesai' };

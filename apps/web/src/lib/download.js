/** Simpan file hasil unduhan backend ({ blob, filename } dari apiDownload) di perangkat pengguna. */
export function saveBlob({ blob, filename }) {
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

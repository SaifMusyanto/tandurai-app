/**
 * Role user pada satu farm menurut model akses farm (`users/{uid}/access`).
 * Hanya `farmRoles/{farmId}` (`owner` | `operator`) yang berlaku, sama seperti database.rules.json;
 * field lama `access.role` (mis. `manager`) tidak lagi memberi hak.
 */
export function farmRoleOf(access = {}, farmId) {
  if (!farmId || access?.farms?.[farmId] !== true) return null;
  const role = access.farmRoles?.[farmId];
  return role === 'owner' || role === 'operator' ? role : null;
}

/** Peta `{ farmId: role }` untuk semua farm yang dapat diakses. */
export function farmRolesOf(access = {}) {
  return Object.fromEntries(Object.keys(access?.farms || {})
    .map(farmId => [farmId, farmRoleOf(access, farmId)])
    .filter(([, role]) => role));
}

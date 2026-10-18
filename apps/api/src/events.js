/**
 * Hub SSE: event dikirim ke semua anggota aktif farm terkait.
 * Peta di memori (gateway → farm, farm → anggota) dimuat saat start dan diperbarui setiap
 * klaim/lepas gateway dan perubahan anggota, sehingga pengiriman tidak perlu query database.
 */
export function createEventHub() {
  const clients = new Map();      // uid → Set<res>
  const gatewayFarm = new Map();  // gatewayId → farmId
  const farmMembers = new Map();  // farmId → Set<uid>
  const adminClients = new Map(); // uid admin → jumlah koneksi; admin menerima event semua farm

  function addClient(uid, res, { admin = false } = {}) {
    if (!clients.has(uid)) clients.set(uid, new Set());
    clients.get(uid).add(res);
    if (admin) adminClients.set(uid, (adminClients.get(uid) || 0) + 1);
    return () => {
      const set = clients.get(uid);
      set?.delete(res);
      if (set && !set.size) clients.delete(uid);
      if (admin) {
        const left = (adminClients.get(uid) || 1) - 1;
        if (left > 0) adminClients.set(uid, left); else adminClients.delete(uid);
      }
    };
  }

  function sendToUser(uid, event, data) {
    const set = clients.get(uid);
    if (!set) return;
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of set) res.write(frame);
  }

  function emitFarm(farmId, event, data) {
    const members = farmMembers.get(farmId) || new Set();
    for (const uid of members) sendToUser(uid, event, data);
    for (const uid of adminClients.keys()) if (!members.has(uid)) sendToUser(uid, event, data);
  }

  function emitGateway(gatewayId, event, data) {
    const farmId = gatewayFarm.get(gatewayId);
    if (farmId) emitFarm(farmId, event, { gatewayId, ...data });
  }

  // Komentar SSE setiap 25 dtk menjaga koneksi melewati proxy.
  const keepAlive = setInterval(() => {
    for (const set of clients.values()) for (const res of set) res.write(': ping\n\n');
  }, 25000);
  keepAlive.unref();

  return {
    addClient,
    sendToUser,
    emitFarm,
    emitGateway,
    setGatewayFarm: (gatewayId, farmId) => (farmId ? gatewayFarm.set(gatewayId, farmId) : gatewayFarm.delete(gatewayId)),
    farmOf: gatewayId => gatewayFarm.get(gatewayId) || null,
    setFarmMembers: (farmId, uids) => (uids.length ? farmMembers.set(farmId, new Set(uids)) : farmMembers.delete(farmId)),
    addFarmMember: (farmId, uid) => {
      if (!farmMembers.has(farmId)) farmMembers.set(farmId, new Set());
      farmMembers.get(farmId).add(uid);
    },
    removeFarmMember: (farmId, uid) => farmMembers.get(farmId)?.delete(uid),
    clientCount: () => [...clients.values()].reduce((sum, set) => sum + set.size, 0),
    close: () => {
      clearInterval(keepAlive);
      for (const set of clients.values()) for (const res of set) res.end();
      clients.clear();
    },
  };
}

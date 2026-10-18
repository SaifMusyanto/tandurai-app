// Registry pabrik: daftarkan perangkat (hwUid + device secret + kode klaim) ke PostgreSQL.
// Hanya hash yang disimpan di database; secret ditulis ke firmware/NVS, kode klaim dicetak di label.
//
//   npm run factory -w apps/api -- --count 5 --out-dir ../../provisioning --host mqtt.tandurai.id [--port 1883] [--tls]
//     → per perangkat: <hwUid>.json (isi halaman setup gateway: hwUid, secret, broker) + labels.csv (UID + kode klaim)
//     Firmware sama untuk semua unit; kredensial diisi lewat halaman setup (tidak dikompilasi per unit).
//   npm run factory -w apps/api -- --out device.json          # satu perangkat (simulator)
//
// Broker Tandurai (npm run broker) membaca tabel devices langsung: perangkat bisa tersambung segera.
// Bila memakai Mosquitto: mosquitto_passwd -b deploy/mosquitto/passwd <hwUid> <deviceSecret>
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadEnvFile, readConfig } from '../src/config.js';
import { createPool } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { provisionDevice } from '../src/devices.js';

export { provisionDevice };

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i].replace(/^--/, '');
    options[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return options;
}

async function main() {
  loadEnvFile();
  const options = parseArgs(process.argv.slice(2));
  const config = readConfig();
  const pool = createPool(config.databaseUrl);
  const count = Math.min(Math.max(Number(options.count) || 1, 1), 500);
  // Default dari MQTT_PUBLIC_HOST/PORT/TLS (apps/api/.env); --host/--port/--tls menimpa.
  const broker = {
    host: options.host || config.mqttPublicHost,
    port: Number(options.port || (options.tls ? 8883 : config.mqttPublicPort)),
    tls: Boolean(options.tls) || config.mqttPublicTls,
  };
  try {
    await migrate(pool, () => {});
    if (options['out-dir']) mkdirSync(options['out-dir'], { recursive: true });
    const labels = options['out-dir'] ? join(options['out-dir'], 'labels.csv') : null;
    if (labels && !existsSync(labels)) writeFileSync(labels, 'hwUid,claimCode,model\n');
    for (let index = 0; index < count; index += 1) {
      const device = await provisionDevice(pool, { hwUid: count === 1 ? options['hw-uid'] : undefined, model: options.model });
      const firmwareConfig = { hwUid: device.hwUid, deviceSecret: device.deviceSecret, model: device.model, mqtt: broker };
      if (options.out && count === 1) {
        // File untuk simulator: berisi secret — jangan di-commit atau dibagikan.
        writeFileSync(options.out, JSON.stringify({ hwUid: device.hwUid, deviceSecret: device.deviceSecret, model: device.model, mqtt: broker }, null, 2));
      }
      if (options['out-dir']) {
        writeFileSync(join(options['out-dir'], `${device.hwUid}.json`), JSON.stringify(firmwareConfig, null, 2));
        appendFileSync(labels, `${device.hwUid},${device.claimCode},${device.model}\n`);
      }
      console.log(`✔ ${device.hwUid}  kode klaim ${device.claimCode}${options['out-dir'] || options.out ? '' : `  secret ${device.deviceSecret}`}`);
    }
    if (options['out-dir']) {
      console.log(`\nFile di ${options['out-dir']}: <hwUid>.json (isi ke halaman setup gateway), labels.csv (cetak label/QR).`);
      console.log('Folder ini berisi device secret: simpan aman, jangan di-commit.');
    }
    console.log(`Broker untuk perangkat: ${broker.tls ? 'mqtts' : 'mqtt'}://${broker.host}:${broker.port}`);
  } finally {
    await pool.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

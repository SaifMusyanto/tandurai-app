import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  throw new Error('Pemakaian: node tools/summarize-telemetry-export.mjs <raw-day.json> <summary.json>');
}

const rows = Object.values(JSON.parse(readFileSync(inputPath, 'utf8')) || {})
  .filter(row => row && Number.isFinite(Number(row.timestamp)))
  .sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
if (!rows.length) throw new Error('Export tidak memiliki telemetry valid');

const metrics = ['temperature', 'humidity', 'co2', 'pressure', 'airflow', 'substrateMoisture', 'light'];
const aggregates = {};
for (const metric of metrics) {
  const values = rows.map(row => Number(row[metric])).filter(Number.isFinite);
  aggregates[metric] = values.length ? {
    count: values.length,
    mean: Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3)),
    min: Math.min(...values),
    max: Math.max(...values),
  } : null;
}

const first = rows[0];
const dateMatch = basename(inputPath).match(/\d{4}-\d{2}-\d{2}/);
const summary = {
  date: dateMatch?.[0] || null,
  kumbungId: first.kumbungId,
  sampleCount: rows.length,
  sourceWindowStart: Number(first.timestamp),
  sourceWindowEnd: Number(rows.at(-1).timestamp),
  invalidSampleCount: rows.filter(row => row.quality?.status === 'invalid').length,
  degradedSampleCount: rows.filter(row => row.quality?.status === 'degraded').length,
  aggregates,
  schemaVersion: 'telemetry-daily-v1',
};
writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, inputPath, outputPath, sampleCount: rows.length }));

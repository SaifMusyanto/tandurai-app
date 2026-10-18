"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { selectMonitoredSensors } = require("../sensor-targets");

const catalog = {
  "SNS-02": { farmId: "FARM-01", kumbungId: "K2", status: "active" },
  "SNS-01": { farmId: "FARM-01", kumbungId: "K1", status: "active" },
  "SNS-03": { farmId: "FARM-01", kumbungId: "K1", status: "pending" },
  "SNS-04": { farmId: "FARM-01", kumbungId: "K1", status: "inactive" },
  "SNS-99": { farmId: "FARM-02", kumbungId: "K9", status: "active" },
};
const fallback = { sensorId: "SNS-0101", kumbungId: "FARM-01-K01" };

test("memantau semua sensor aktif di farm terpilih, terurut", () => {
  assert.deepEqual(selectMonitoredSensors(catalog, "FARM-01", fallback), [
    { sensorId: "SNS-01", kumbungId: "K1" },
    { sensorId: "SNS-02", kumbungId: "K2" },
  ]);
});

test("fallback sensor default hanya bila farm belum punya sensor aktif", () => {
  assert.deepEqual(selectMonitoredSensors(catalog, "FARM-03", fallback), [{ ...fallback, legacy: true }]);
  assert.deepEqual(selectMonitoredSensors({}, "FARM-01", fallback), [{ ...fallback, legacy: true }]);
  assert.deepEqual(selectMonitoredSensors(null, "FARM-01", null), []);
});

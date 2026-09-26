// Regression tests for protocol behaviour verified against the official
// Eaton xComfort Bridge app 2.4.1 (see docs/official-app-2.4.1/).
const assert = require('node:assert');
const { test } = require('node:test');

const {
  buildEnergyControlModePayload,
  normalizeLoadMode,
  resolveEnergyControlMode,
  resolvePriorityType,
  ENERGY_PRIORITY_TYPE,
} = require('../.homeybuild/lib/utils/energyFields');
const { MessageHandler } = require('../.homeybuild/lib/messaging/MessageHandler');
const { DeviceStateManager } = require('../.homeybuild/lib/state/DeviceStateManager');
const { MESSAGE_TYPES } = require('../.homeybuild/lib/XComfortProtocol');

function setup() {
  const stateManager = new DeviceStateManager(() => {});
  const handler = new MessageHandler(stateManager, () => {});
  return { stateManager, handler };
}

test('energy control mode payloads match the official ENERGY_CONTROL_SET_MODE (392)', () => {
  assert.deepStrictEqual(buildEnergyControlModePayload('inactive'), { mode: 0, prio: false });
  assert.deepStrictEqual(buildEnergyControlModePayload('normal'), { mode: 1, prio: false });
  assert.deepStrictEqual(buildEnergyControlModePayload('energy_saving'), { mode: 2, prio: false });
  assert.deepStrictEqual(
    buildEnergyControlModePayload('priority', { prioType: ENERGY_PRIORITY_TYPE.EV_CHARGING }),
    { mode: 1, prio: true, prioType: 2, prioDuration: 60 },
  );
  assert.deepStrictEqual(
    buildEnergyControlModePayload('priority', { prioType: 1, currentMode: 'energy_saving', prioDuration: 120 }),
    { mode: 2, prio: true, prioType: 1, prioDuration: 120 },
    'priority keeps the underlying energy-saving mode',
  );
  assert.throws(() => buildEnergyControlModePayload('priority'), /load type/);
});

test('energy control mode numbers normalize to the official meaning', () => {
  assert.strictEqual(normalizeLoadMode(0), 'inactive');
  assert.strictEqual(normalizeLoadMode(1), 'normal');
  assert.strictEqual(normalizeLoadMode(2), 'energy_saving');
  assert.strictEqual(resolveEnergyControlMode({ eControl: { mode: 2, prio: false } }), 'energy_saving');
  assert.strictEqual(resolveEnergyControlMode({ mode: 1, prio: true }), 'priority');
  assert.strictEqual(resolveEnergyControlMode({ power: 5 }), undefined);
});

test('priority load type is derived from actuator or meter usage', () => {
  assert.strictEqual(resolvePriorityType({ deviceUsage: 6 }), ENERGY_PRIORITY_TYPE.WATER_HEATING);
  assert.strictEqual(resolvePriorityType({ deviceUsage: 7 }), ENERGY_PRIORITY_TYPE.EV_CHARGING);
  assert.strictEqual(resolvePriorityType({ deviceUsage: 8 }), ENERGY_PRIORITY_TYPE.HIGH_LOAD_APPLIANCE);
  assert.strictEqual(resolvePriorityType({ deviceUsage: 23 }), ENERGY_PRIORITY_TYPE.CLIMATE);
  assert.strictEqual(resolvePriorityType({ meterUsage: 2 }), ENERGY_PRIORITY_TYPE.EV_CHARGING);
  assert.strictEqual(resolvePriorityType({ meterUsage: 4 }), ENERGY_PRIORITY_TYPE.CLIMATE);
  assert.strictEqual(resolvePriorityType({ meterUsage: 6 }), ENERGY_PRIORITY_TYPE.WATER_HEATING);
  assert.strictEqual(resolvePriorityType({ deviceUsage: 0, meterUsage: 0 }), undefined, 'lights/main meter have no priority group');
});

test('SET_ALL_DATA energy block (meters, eControl) is forwarded as a bridge status', async () => {
  const { handler } = setup();
  const statuses = [];
  handler.setOnBridgeStatusUpdate((status) => statuses.push(status));

  await handler.processMessage({
    type_int: MESSAGE_TYPES.SET_ALL_DATA,
    payload: {
      devices: [],
      eControl: { configured: true, mode: 2, prio: false },
      meters: [
        { meterId: 1100, meterType: 1, name: 'Home', usage: 0, connectionState: 1, power: 713 },
        { meterId: 1101, meterType: 1, name: 'PV', usage: 3, connectionState: 1, power: -2430 },
      ],
    },
  });

  assert.strictEqual(statuses.length, 1);
  assert.strictEqual(statuses[0].loadMode, 'energy_saving');
  assert.strictEqual(statuses[0].energyMeters.length, 2);
  assert.strictEqual(statuses[0].energyMeters[1].usage, 3);

  // A SET_ALL_DATA part without energy content emits nothing.
  await handler.processMessage({ type_int: MESSAGE_TYPES.SET_ALL_DATA, payload: { devices: [] } });
  assert.strictEqual(statuses.length, 1);

  handler.cleanup();
});

const { XComfortBridge } = require('../.homeybuild/lib/connection/XComfortBridge');
const {
  buildMonthHistoryRequest,
  buildTariffInfoRequest,
  buildTodayHistoryRequest,
  extractOfficialHistoryPeriods,
} = require('../.homeybuild/lib/utils/energyHistory');
const { startOfLocalDay, startOfLocalMonth } = require('../.homeybuild/lib/utils/timeZone');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function captureBridge() {
  const bridge = new XComfortBridge('127.0.0.1', 'auth-key', () => {});
  const sent = [];
  bridge.connectionManager.sendAndWaitForAck = (msg) => {
    sent.push(msg);
    return Promise.resolve(true);
  };
  bridge.connectionManager.isConnected = () => true;
  return { bridge, sent };
}

test('local day/month boundaries follow the Homey time zone', () => {
  // 2026-03-15 10:00 UTC; Amsterdam is UTC+1 in March before DST.
  const now = Date.UTC(2026, 2, 15, 10, 0, 0);
  assert.strictEqual(startOfLocalDay(now, 'Europe/Amsterdam'), Date.UTC(2026, 2, 14, 23, 0, 0));
  assert.strictEqual(startOfLocalMonth(now, 'Europe/Amsterdam'), Date.UTC(2026, 1, 28, 23, 0, 0));
  assert.strictEqual(startOfLocalDay(now), Date.UTC(2026, 2, 15), 'without a zone, UTC is used');
});

test('energy refresh only sends the official read requests (388/395), never 390/397', async () => {
  const { bridge, sent } = captureBridge();
  bridge.ENERGY_HISTORY_REQUEST_GAP_MS = 10;
  const now = Date.UTC(2026, 2, 15, 10, 30, 0);

  await bridge.requestEnergyData(1100, { timeZone: 'Europe/Amsterdam', nowMs: now });
  await sleep(40);

  const types = sent.map((msg) => msg.type_int);
  assert.deepStrictEqual(types, [
    MESSAGE_TYPES.REQUEST_TARIFF_INFO,
    MESSAGE_TYPES.REQUEST_ENERGY_HISTORY,
    MESSAGE_TYPES.REQUEST_ENERGY_HISTORY,
  ]);
  assert.ok(!types.includes(MESSAGE_TYPES.SET_ENERGY_MONITORING), 'must not edit monitored loads');
  assert.ok(!types.includes(MESSAGE_TYPES.SET_ENERGY_METER), 'must not create/update a meter');

  const midnight = Date.UTC(2026, 2, 14, 23, 0, 0) / 1000;
  assert.deepStrictEqual(sent[0].payload, { from: midnight - 86400, to: midnight + 172800 });
  assert.deepStrictEqual(sent[1].payload, {
    from: midnight, iType: 0, interval: 60, iValues: 12, vType: 0, items: [1100],
  });
  assert.strictEqual(sent[2].payload.interval, 1440);
  assert.strictEqual(sent[2].payload.iValues, 15);
  bridge.cleanup();
});

test('energy refresh without a numeric item id only requests tariff info', async () => {
  const { bridge, sent } = captureBridge();
  bridge.ENERGY_HISTORY_REQUEST_GAP_MS = 10;
  await bridge.requestEnergyData('main_1');
  await sleep(30);
  assert.deepStrictEqual(sent.map((msg) => msg.type_int), [MESSAGE_TYPES.REQUEST_TARIFF_INFO]);
  bridge.cleanup();
});

test('official ENERGY_HISTORY (396) yields today and month kWh for the item', () => {
  const now = Date.UTC(2026, 2, 15, 10, 30, 0);
  const zone = 'Europe/Amsterdam';
  const midnight = Date.UTC(2026, 2, 14, 23, 0, 0) / 1000;

  const hourly = {
    iType: 0, interval: 60, vType: 0, final: true,
    items: [
      { id: 1100, start: midnight - 3600, values: [9999, 500, 250, 250] }, // first slot is yesterday
      { id: 1101, start: midnight, values: [1, 1] },
    ],
  };
  assert.deepStrictEqual(extractOfficialHistoryPeriods(hourly, 1100, now, zone), { todayKwh: 1 });

  const monthStart = Date.UTC(2026, 1, 28, 23, 0, 0) / 1000;
  const daily = {
    iType: 0, interval: 1440, vType: 0,
    items: [{ id: 1100, start: monthStart, factor: 10, values: [100, 200, 300] }],
  };
  assert.deepStrictEqual(extractOfficialHistoryPeriods(daily, '1100', now, zone), { monthKwh: 6 });

  assert.deepStrictEqual(extractOfficialHistoryPeriods({ ...daily, vType: 1 }, 1100, now, zone), {}, 'costs are ignored');
  assert.deepStrictEqual(extractOfficialHistoryPeriods(daily, 42, now, zone), {}, 'other items are ignored');
});

test('history/tariff request builders are exported for reuse', () => {
  const now = Date.UTC(2026, 0, 1, 0, 30, 0);
  assert.strictEqual(buildTodayHistoryRequest({ itemId: 5, nowMs: now }).iValues, 1);
  assert.strictEqual(buildMonthHistoryRequest({ itemId: 5, nowMs: now }).from, Date.UTC(2026, 0, 1) / 1000);
  assert.strictEqual(buildTariffInfoRequest(now).from, Date.UTC(2025, 11, 31) / 1000);
});

test('TARIFF_INFO (389) yields the current price in main currency units and its rating', async () => {
  const { handler } = setup();
  const statuses = [];
  handler.setOnBridgeStatusUpdate((status) => statuses.push(status));
  const hourStart = Math.floor(Date.now() / 3_600_000) * 3600;

  await handler.processMessage({
    type_int: MESSAGE_TYPES.TARIFF_INFO,
    payload: {
      start: hourStart - 3600,
      interval: 60,
      factor: 10000,
      unit: 7,
      tariff: [[74000, 1], [258900, 3], [100000, 2]],
    },
  });

  assert.strictEqual(statuses.length, 1);
  assert.strictEqual(statuses[0].tariff, 0.2589, '25.89 ct/kWh = 0.2589 per kWh');
  assert.strictEqual(statuses[0].tariffLabel, 'Expensive');
  assert.strictEqual(statuses[0].tariffRating, 3);
  handler.cleanup();
});

test('eTariff currency code is mapped to an ISO currency', async () => {
  const { handler } = setup();
  const statuses = [];
  handler.setOnBridgeStatusUpdate((status) => statuses.push(status));
  await handler.processMessage({
    type_int: MESSAGE_TYPES.SET_ENERGY_DATA,
    payload: { eTariff: { configured: true, tariffType: 1, currency: 2 } },
  });
  assert.strictEqual(statuses[0].currency, 'NOK');
  handler.cleanup();
});

const {
  isShadingSafetyActive,
  shadingMotionFromCurstate,
  bridgePositionToHomey,
  homeyPositionToBridge,
} = require('../.homeybuild/lib/utils/shadingState');

test('shading curstate uses the reported-state enum, not the command enum', () => {
  assert.strictEqual(shadingMotionFromCurstate(1), 'idle', '1 = STOPPED');
  assert.strictEqual(shadingMotionFromCurstate(2), 'up', '2 = MOVING_UP');
  assert.strictEqual(shadingMotionFromCurstate(3), 'down', '3 = MOVING_DOWN');
  assert.strictEqual(shadingMotionFromCurstate(5), 'idle', '5 = SAFETY_DOWN (locked)');
  assert.strictEqual(shadingMotionFromCurstate(0), undefined, '0 = UNDEFINED');
});

test('shading safety lock comes from curstate 4/5 or locked info codes, not shSafety', () => {
  assert.strictEqual(isShadingSafetyActive(4), true);
  assert.strictEqual(isShadingSafetyActive(5), true);
  assert.strictEqual(isShadingSafetyActive(1), false, 'stopped = not locked even if safety is configured');
  assert.strictEqual(isShadingSafetyActive(undefined, [{ text: '1127', type: 203 }]), true);
  assert.strictEqual(isShadingSafetyActive(undefined, [{ text: '1111', value: '1' }]), false);
  assert.strictEqual(isShadingSafetyActive(undefined), undefined);
});

test('shading commands use the official payload without an extra action key', async () => {
  const { bridge, sent } = captureBridge();
  await bridge.controlShading('321', 2);
  await bridge.controlShading('321', 5, 42.4);
  assert.deepStrictEqual(sent[0].payload, { deviceId: 321, state: 2 });
  assert.deepStrictEqual(sent[1].payload, { deviceId: 321, state: 5, value: 42 });
  bridge.cleanup();
});

test('blind position is inverted between bridge (0 open) and Homey (0 closed)', () => {
  assert.strictEqual(bridgePositionToHomey(0), 1, 'shPos 0 = fully open');
  assert.strictEqual(bridgePositionToHomey(100), 0, 'shPos 100 = fully closed');
  assert.strictEqual(bridgePositionToHomey(95), 0.05);
  assert.strictEqual(bridgePositionToHomey(255), undefined, 'out of range = position unknown');
  assert.strictEqual(bridgePositionToHomey(-1), undefined);
  assert.strictEqual(bridgePositionToHomey('50'), undefined);
  assert.strictEqual(homeyPositionToBridge(1), 0);
  assert.strictEqual(homeyPositionToBridge(0), 100);
  assert.strictEqual(homeyPositionToBridge(0.25), 75);
  assert.strictEqual(homeyPositionToBridge(1.5), 0, 'clamped');
  assert.strictEqual(homeyPositionToBridge(Number.NaN), 100);
});

test('slat tilt uses the official STEP_UP (4) / STEP_DOWN (3) commands', async () => {
  const { bridge, sent } = captureBridge();
  await bridge.controlShading('321', 4);
  await bridge.controlShading('321', 3);
  assert.deepStrictEqual(sent[0].payload, { deviceId: 321, state: 4 });
  assert.deepStrictEqual(sent[1].payload, { deviceId: 321, state: 3 });
  bridge.cleanup();
});

const { resolveContactOpen, resolveWaterGuardLeak } = require('../.homeybuild/lib/utils/sensorState');

test('door/window open state follows the sensor mode', () => {
  // 1308/1310 = "ON when closed" (the historic default)
  assert.strictEqual(resolveContactOpen({ curstate: 1, mode: '1308' }), false);
  assert.strictEqual(resolveContactOpen({ curstate: 0, mode: '1310' }), true);
  // 1309/1311 = "ON when opened" — previously reported inverted
  assert.strictEqual(resolveContactOpen({ curstate: 1, mode: '1309' }), true);
  assert.strictEqual(resolveContactOpen({ curstate: 0, mode: '1311' }), false);
  // Unknown mode: component info codes 1121/1123 open, 1122/1124 closed
  assert.strictEqual(resolveContactOpen({ curstate: 1, componentInfo: [{ text: '1123', value: '14:45' }] }), true);
  assert.strictEqual(resolveContactOpen({ componentInfo: [{ text: '1122' }] }), false);
  // Nothing known: historic default
  assert.strictEqual(resolveContactOpen({ curstate: 0 }), true);
  assert.strictEqual(resolveContactOpen({}), undefined);
});

test('official demo sample: mode 1308 + curstate 0 + info 1121 all say "open"', () => {
  const demo = require('../docs/official-app-2.4.1/samples/demo-home.json').homeData;
  const comp = demo.comps.find((c) => c.compType === 76);
  const device = demo.devices.find((d) => d.compId === comp.compId);
  assert.strictEqual(resolveContactOpen({ curstate: device.curstate, mode: comp.mode }), true);
  assert.strictEqual(resolveContactOpen({ componentInfo: comp.info }), true);
});

test('water guard leak alarm comes from curstate 3/4 only', () => {
  assert.strictEqual(resolveWaterGuardLeak(3), true, 'leak alarm');
  assert.strictEqual(resolveWaterGuardLeak(4), true, 'leak alarm muted');
  for (const state of [0, 1, 2, 5, 7]) {
    assert.strictEqual(resolveWaterGuardLeak(state), false, `state ${state} is not a leak`);
  }
  assert.strictEqual(resolveWaterGuardLeak(undefined), undefined);
});

test('STATE_UPDATE passes direct temp/humidity sensor fields through', async () => {
  const { stateManager, handler } = setup();
  stateManager.setDevice({ deviceId: '406', name: 'Temp', devType: 410 });
  const updates = [];
  stateManager.addListener('406', (_id, update) => updates.push(update));

  await handler.processMessage({
    type_int: MESSAGE_TYPES.STATE_UPDATE,
    payload: { item: [{ deviceId: 406, temp: 21.5, humidity: 48 }] },
  });
  await sleep(250);

  assert.strictEqual(updates.length, 1);
  assert.strictEqual(updates[0].temp, 21.5);
  assert.strictEqual(updates[0].humidity, 48);
  handler.cleanup();
});

const { toBridgeFloat, describeConnectionDecline } = require('../.homeybuild/lib/utils/bridgeProtocol');
const { verifyBridgeIdentity } = require('../.homeybuild/lib/crypto/BridgeIdentity');
const { isBridgeControlledUsage } = require('../.homeybuild/lib/utils/deviceClassification');

test('float fields always carry a fraction like the official app', () => {
  assert.strictEqual(toBridgeFloat(21), 21.001);
  assert.strictEqual(JSON.stringify({ setpoint: toBridgeFloat(21) }), '{"setpoint":21.001}');
  assert.strictEqual(toBridgeFloat(21.5), 21.501);
  assert.strictEqual(toBridgeFloat(-2), -2.001);
});

test('room heating setpoint is sent as a bridge float', async () => {
  const { bridge, sent } = captureBridge();
  await bridge.setRoomHeatingState('501', 3, 1, 21);
  assert.strictEqual(sent[0].type_int, MESSAGE_TYPES.SET_HEATING_STATE);
  assert.strictEqual(sent[0].payload.setpoint, 21.001);
  bridge.cleanup();
});

test('CONNECTION_DECLINED error ids are decoded', () => {
  assert.deepStrictEqual(describeConnectionDecline({ error_id: 802 }), {
    errorId: 802, meaning: 'client version declined by the bridge', permanent: true,
  });
  assert.strictEqual(describeConnectionDecline({ error_id: '806' }).permanent, false);
  assert.strictEqual(describeConnectionDecline({}).permanent, false);
});

test('bridge identity check matches the official algorithm (app self-test vector)', () => {
  // Vector from the official app's ATBSecureChannel self-test (signed by a
  // test root, so it is verified against that key here).
  const deviceId = "0x0061853d";
  const publicKey = "-----BEGIN PUBLIC KEY-----MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA3cVFDmvqaGx2/m6vKys15aKVGHroKQ44aZuq/VF3XnUYqWSyLT8uavkm1dqS/jcMKAnOe1DQNb5xUVM6GIkylrxEfKC/ljhqDDLwPvCormvjA4cSfvhRWmv3YaMmx0r6oUcDKZikwX4DOyHzywv+RySCpq29M/KcbTZkluHSBaH96OOh1WhRZNdbMsY0f3Dq14kBC91Uz/A3YBdysY7HxE/i5Sdy192qhyJWR8weX485yKO73OlU0Rbiwu7zJEKr3+B1UvT9gTOPzGAGPQZNdcGqN+B+nZHv8o3iU2U8Fga8vUA4l5x0c6nAgRDbHUFB3uylKfZLPVB2wLv9vX1N8QIDAQAB-----END PUBLIC KEY-----";
  const signature = "3e93f81465656f163ff36dc42c2edde52246a6ee7ae0fe0bc5eb8de4a64d84895c478b6b69c5b68b1827ff633cd2e627ed3bbbb2f6be4e68ab10f96f3b830eebd2a9ea69cd476e9994bc6f181b137ba9f68070ac2eb432670857c0c1aa8cf345f5eda575c3254e5e5c8e8dabe53c35da368f30947c9e6fc04d3270726c4b8f6e9613c75ab759fb19af96dba00e7fa6eb6d8d453cdb263614386b9114193fdcf80935b1cf21ecf327bb497a039494219763a1b58fd6afe57bc3ce707f783122f72e7e44663b5f1c94f7ae89caaf30aeaafcb43efb9c2f4db098502de1bdbb670de7040baf84d714af34253878f8cf9d25a51e48e4b037c257e0a3dd6d6c3a91f5";
  const testRoot = "-----BEGIN PUBLIC KEY-----MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAs+RW6X5qI311g8FL/ygkxywZ7JzJjBYJsy3sROfsqvRmt5+MULmqFxMMQQufNxCCNo9gsC4Z7Qfuj+R5V2WXuK+mKyftqyFQrytzpxfjeq3plajyLMxx8A6y05cmablocl4puBvLQ5izIDnYdFGaYuXaDCepqMj5XN2JtZTcQ/TOyF7ES7cuNjjUF7Lxvd9a8ApjMsnURJ/xA0IBNI/bbT7klzY/nJMvcYsj9eGcccyc2gbuYJWVF+ze86UStumFsZE/nkInJUyZPo32basEVO/5MkAZVf0NsBqZtZja7yNx0GrHMPbOhrS7RvsnWGhS75jkBNCDxbhcGBP7YXy7bwIDAQAB-----END PUBLIC KEY-----";
  assert.strictEqual(verifyBridgeIdentity(deviceId, publicKey, signature, testRoot), 'verified');
  assert.strictEqual(verifyBridgeIdentity(deviceId + 'x', publicKey, signature, testRoot), 'mismatch');
  assert.strictEqual(verifyBridgeIdentity(deviceId, publicKey, undefined, testRoot), 'unavailable');
});

test('bridge-controlled heating/cooling usages are not offered as appliances', () => {
  for (const usage of [2, 21, 22, 23, 24, 25, 26, 27, 28]) {
    assert.strictEqual(isBridgeControlledUsage(usage), true, `usage ${usage}`);
  }
  for (const usage of [0, 1, 6, 7, 8]) {
    assert.strictEqual(isBridgeControlledUsage(usage), false, `usage ${usage}`);
  }
});

// --- Per-device audit (seventh pass) ---------------------------------------

const { resolveMotionDetected } = require('../.homeybuild/lib/utils/sensorState');
const { parseInfoMetadata, selectMainBrightness } = require('../.homeybuild/lib/utils/parseInfoMetadata');
const { shadingSupportsSteps } = require('../.homeybuild/lib/utils/shadingState');

test('actuator curstate is not read as on/off, sensor channel curstate is', async () => {
  const { stateManager, handler } = setup();
  stateManager.setDevice({ deviceId: '301', name: 'Light', devType: 101, switch: false });
  stateManager.setDevice({ deviceId: '401', name: 'Input', devType: 200 });
  const updates = { 301: [], 401: [] };
  stateManager.addListener('301', (_id, update) => updates[301].push(update));
  stateManager.addListener('401', (_id, update) => updates[401].push(update));

  await handler.processMessage({
    type_int: MESSAGE_TYPES.STATE_UPDATE,
    payload: { item: [{ deviceId: 301, curstate: 1 }, { deviceId: 401, curstate: 1 }] },
  });
  await sleep(250);

  assert.strictEqual(updates[301][0].switch, undefined, 'light stays as reported by `switch`');
  assert.strictEqual(updates[301][0].curstate, 1);
  assert.strictEqual(updates[401][0].switch, true);
  handler.cleanup();
});

test('component info updates reach the sensor channels of that component', async () => {
  const { stateManager, handler } = setup();
  stateManager.setComponent({ compId: '1004', compType: 29, raw: { compId: 1004, info: [] } });
  stateManager.setDevice({ deviceId: '404', name: 'Motion', devType: 200, compId: 1004 });
  stateManager.setDevice({ deviceId: '409', name: 'Rocker', devType: 220, compId: 1004 });
  const updates = { 404: [], 409: [] };
  stateManager.addListener('404', (_id, update) => updates[404].push(update));
  stateManager.addListener('409', (_id, update) => updates[409].push(update));

  const info = [{ text: '1125', type: 2, value: '11:17' }];
  await handler.processMessage({
    type_int: MESSAGE_TYPES.STATE_UPDATE,
    payload: { item: [{ compId: 1004, info }] },
  });
  await sleep(250);

  assert.deepStrictEqual(updates[404][0].componentInfo, info);
  assert.strictEqual(updates[409].length, 0, 'rocker channels are event based and not re-evaluated');
  assert.deepStrictEqual(stateManager.getComponent('1004').raw.info, info);
  handler.cleanup();
});

test('motion sensor state falls back to component info 1125/1126 (official demo)', () => {
  const demo = require('../docs/official-app-2.4.1/samples/demo-home.json').homeData;
  const device = demo.devices.find((d) => d.deviceId === 404);
  const comp = demo.comps.find((c) => c.compId === device.compId);
  assert.strictEqual(comp.compType, 29, 'motion sensor component');
  assert.strictEqual(device.curstate, undefined);
  assert.strictEqual(resolveMotionDetected({ curstate: device.curstate, componentInfo: comp.info }), false);
  assert.strictEqual(resolveMotionDetected({ componentInfo: [{ text: '1125', value: '11:20' }] }), true);
  assert.strictEqual(resolveMotionDetected({ curstate: 1, componentInfo: comp.info }), true, 'channel state wins');
  assert.strictEqual(resolveMotionDetected({}), undefined);
});

test('weather-station brightness uses thousands separators and three sensors', () => {
  const metadata = parseInfoMetadata([{ text: '1243', value: '12,500 8,200 950' }]);
  assert.strictEqual(metadata.brightness, 12500, 'not 12.5');
  assert.deepStrictEqual(metadata.brightnessValues, [12500, 8200, 950]);
  assert.strictEqual(selectMainBrightness(metadata.brightnessValues, 2), 8200, 'bType 2 = middle');
  assert.strictEqual(selectMainBrightness(metadata.brightnessValues, 3), 950, 'bType 3 = right');
  assert.strictEqual(selectMainBrightness(metadata.brightnessValues, undefined), 12500);
  assert.strictEqual(parseInfoMetadata([{ text: '1243', value: '1,234' }]).brightness, 1234);
  assert.strictEqual(parseInfoMetadata([{ text: '1243', value: 870 }]).brightnessValues, undefined);
});

test('shading step buttons follow slats and the step control options', () => {
  assert.strictEqual(shadingSupportsSteps({ shHasSlats: true, shControl: 1 }), true);
  for (const shControl of [3, 5, 6]) {
    assert.strictEqual(shadingSupportsSteps({ shHasSlats: false, shControl }), true, `shControl ${shControl}`);
  }
  for (const shControl of [1, 2, 4, 7]) {
    assert.strictEqual(shadingSupportsSteps({ shHasSlats: false, shControl }), false, `shControl ${shControl}`);
  }
  assert.strictEqual(shadingSupportsSteps({}), undefined);
});

test('room state carries loads on, closed shades and presence', async () => {
  const { stateManager, handler } = setup();
  stateManager.setRoom({ roomId: '502', name: 'Kitchen' });
  const updates = [];
  stateManager.addRoomListener('502', (_id, update) => updates.push(update));

  await handler.processMessage({
    type_int: MESSAGE_TYPES.STATE_UPDATE,
    payload: { item: [{ roomId: 502, lightsOn: 2, loadsOn: 1, shadsClosed: 2, presence: 1 }] },
  });
  await sleep(250);

  assert.strictEqual(updates.length, 1);
  assert.strictEqual(updates[0].loadsOn, 1);
  assert.strictEqual(updates[0].shadsClosed, 2);
  assert.strictEqual(updates[0].presence, 1);
  assert.strictEqual(stateManager.getRoom('502').loadsOn, 1);
  handler.cleanup();
});

test('preset change without a setpoint matches the official "set manual mode"', async () => {
  const { bridge, sent } = captureBridge();
  await bridge.setRoomHeatingState('501', 2, 2);
  assert.deepStrictEqual(sent[0].payload, { roomId: 501, mode: 2, state: 2, confirmed: false });
  bridge.cleanup();
});

test('water guard mute uses SET_DEVICE_ALARM_STATE (356) state 3', async () => {
  const { bridge, sent } = captureBridge();
  await bridge.setDeviceAlarmState('411', 3);
  assert.strictEqual(sent[0].type_int, MESSAGE_TYPES.SET_DEVICE_ALARM_STATE);
  assert.deepStrictEqual(sent[0].payload, { deviceId: 411, state: 3 });
  bridge.cleanup();
});

// --- Room climate model (eighth pass) --------------------------------------

const { normalizeRoomRecord } = require('../.homeybuild/lib/messaging/MessageHandler');

test('room total power and heating power are kept apart (demo room 501)', async () => {
  const demo = require('../docs/official-app-2.4.1/samples/demo-home.json').homeData;
  const { stateManager, handler } = setup();
  const updates = [];
  stateManager.addRoomListener('501', (_id, update) => updates.push(update));

  await handler.processMessage({
    type_int: MESSAGE_TYPES.SET_ALL_DATA,
    payload: { rooms: demo.rooms, roomHeating: demo.roomHeating, devices: [] },
  });
  const room = stateManager.getRoom('501');
  assert.strictEqual(room.power, 245, 'rooms[] total, not overwritten by roomHeating[]');
  assert.strictEqual(room.heatingPower, 220);
  assert.strictEqual(room.valve, 0, 'currentValve → valve');
  assert.strictEqual(stateManager.getRoom('502').valve, 20);
  assert.strictEqual(room.tempAlt, 25.3);
  assert.strictEqual(room.floorMin, 8);

  await handler.processMessage({
    type_int: MESSAGE_TYPES.SET_ROOM_STATE,
    payload: { roomId: 501, lightsOn: 1, power: 250 },
  });
  await handler.processMessage({
    type_int: MESSAGE_TYPES.SET_ROOM_HEATING_STATE,
    payload: { roomId: 501, mode: 2, setpoint: 15, valve: 30, temp: 21.5, power: 225 },
  });
  await sleep(250);

  assert.strictEqual(stateManager.getRoom('501').power, 250, 'heating update does not touch the room total');
  assert.strictEqual(stateManager.getRoom('501').heatingPower, 225);
  assert.strictEqual(stateManager.getRoom('501').valve, 30);
  const totals = updates.map((u) => u.power).filter((p) => p !== undefined);
  assert.deepStrictEqual(totals, [245, 250], 'room total never jumps to the heating power');
  handler.cleanup();
});

test('310 room items: power follows lightsOn (total) or mode (heating)', () => {
  assert.deepStrictEqual(normalizeRoomRecord({ roomId: 1, lightsOn: 2, power: 90 }), { roomId: 1, lightsOn: 2, power: 90 });
  assert.deepStrictEqual(normalizeRoomRecord({ roomId: 1, mode: 3, power: 60 }), { roomId: 1, mode: 3, heatingPower: 60 });
  assert.deepStrictEqual(
    normalizeRoomRecord({ roomId: 1, lightsOn: 0, mode: 3, power: 60 }),
    { roomId: 1, lightsOn: 0, mode: 3, power: 60, heatingPower: 60 },
  );
  assert.deepStrictEqual(normalizeRoomRecord({ roomId: 1, currentMode: 2, power: 40 }, 'climate'), {
    roomId: 1, currentMode: 2, heatingPower: 40,
  });
});

test('temperatures of -100 (no sensor) are dropped', async () => {
  assert.deepStrictEqual(normalizeRoomRecord({ roomId: 1, temp: -100, tempAlt: -100, humidity: 40 }), { roomId: 1, humidity: 40 });

  const { stateManager, handler } = setup();
  stateManager.setRoom({ roomId: '503', name: 'Hall', temp: 20 });
  const updates = [];
  stateManager.addRoomListener('503', (_id, update) => updates.push(update));
  await handler.processMessage({
    type_int: MESSAGE_TYPES.SET_ROOM_HEATING_STATE,
    payload: { roomId: 503, mode: 1, setpoint: 10, valve: 0, temp: -100, power: 0 },
  });
  await sleep(250);
  assert.strictEqual(updates[0].temp, undefined);
  assert.strictEqual(stateManager.getRoom('503').temp, 20, 'stored value is not replaced by -100');
  handler.cleanup();
});

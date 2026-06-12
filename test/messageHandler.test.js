const assert = require('node:assert');
const { test } = require('node:test');

const { MessageHandler } = require('../.homeybuild/lib/messaging/MessageHandler');
const { DeviceStateManager } = require('../.homeybuild/lib/state/DeviceStateManager');
const { MESSAGE_TYPES, INFO_TEXT_CODES } = require('../.homeybuild/lib/XComfortProtocol');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// The handler coalesces listener updates for 150ms; wait safely past that.
const COALESCE_WAIT_MS = 250;

function setup() {
  const stateManager = new DeviceStateManager(() => {});
  const handler = new MessageHandler(stateManager, () => {});
  return { stateManager, handler };
}

test('STATE_UPDATE delivers coalesced device state and patches the stored snapshot', async () => {
  const { stateManager, handler } = setup();
  stateManager.setDevice({ deviceId: '5', name: 'Lamp' });
  const updates = [];
  stateManager.addListener('5', (_id, data) => updates.push(data));

  await handler.processMessage({
    type_int: MESSAGE_TYPES.STATE_UPDATE,
    payload: {
      item: [{
        deviceId: '5',
        switch: 1,
        dimmvalue: 40,
        info: [{ text: INFO_TEXT_CODES.TEMPERATURE_STANDARD, value: '21.5' }],
      }],
    },
  });

  await sleep(COALESCE_WAIT_MS);
  assert.strictEqual(updates.length, 1, 'one coalesced update should be delivered');
  assert.strictEqual(updates[0].switch, true, 'switch: 1 should normalize to boolean');
  assert.strictEqual(updates[0].dimmvalue, 40);
  assert.strictEqual(updates[0].metadata.temperature, 21.5, 'state fields and info metadata must both survive');

  // Stored device snapshot (used on reconnect) must reflect the update.
  const stored = stateManager.getDevice('5');
  assert.strictEqual(stored.switch, true);
  assert.strictEqual(stored.dimmvalue, 40);
  assert.deepStrictEqual(stored.info, [{ text: INFO_TEXT_CODES.TEMPERATURE_STANDARD, value: '21.5' }]);

  handler.cleanup();
});

test('STATE_UPDATE maps curstate 0/1 to switch when switch is absent', async () => {
  const { stateManager, handler } = setup();
  const updates = [];
  stateManager.addListener('6', (_id, data) => updates.push(data));

  await handler.processMessage({
    type_int: MESSAGE_TYPES.STATE_UPDATE,
    payload: { item: [{ deviceId: '6', curstate: 1 }] },
  });

  await sleep(COALESCE_WAIT_MS);
  assert.strictEqual(updates.length, 1);
  assert.strictEqual(updates[0].switch, true, 'curstate: 1 should imply switch on');
  assert.strictEqual(updates[0].curstate, 1, 'raw curstate should still be forwarded');

  handler.cleanup();
});

test('STATE_UPDATE items with only heating fields are delivered', async () => {
  const { stateManager, handler } = setup();
  const updates = [];
  stateManager.addListener('7', (_id, data) => updates.push(data));

  await handler.processMessage({
    type_int: MESSAGE_TYPES.STATE_UPDATE,
    payload: { item: [{ deviceId: '7', operationMode: 3, tempState: 2 }] },
  });

  await sleep(COALESCE_WAIT_MS);
  assert.strictEqual(updates.length, 1, 'an item with only operationMode/tempState must not be dropped');
  assert.strictEqual(updates[0].operationMode, 3);
  assert.strictEqual(updates[0].tempState, 2);

  handler.cleanup();
});

test('multiple STATE_UPDATE items for the same device coalesce into one update', async () => {
  const { stateManager, handler } = setup();
  const updates = [];
  stateManager.addListener('9', (_id, data) => updates.push(data));

  await handler.processMessage({
    type_int: MESSAGE_TYPES.STATE_UPDATE,
    payload: { item: [{ deviceId: '9', switch: 1 }] },
  });
  await handler.processMessage({
    type_int: MESSAGE_TYPES.STATE_UPDATE,
    payload: { item: [{ deviceId: '9', dimmvalue: 75 }] },
  });

  await sleep(COALESCE_WAIT_MS);
  assert.strictEqual(updates.length, 1, 'updates within the coalesce window should merge');
  assert.strictEqual(updates[0].switch, true);
  assert.strictEqual(updates[0].dimmvalue, 75);

  handler.cleanup();
});

test('room STATE_UPDATE delivers typed fields plus the raw item', async () => {
  const { stateManager, handler } = setup();
  const updates = [];
  stateManager.addRoomListener('3', (_id, data) => updates.push(data));

  await handler.processMessage({
    type_int: MESSAGE_TYPES.STATE_UPDATE,
    payload: {
      item: [{
        roomId: '3',
        temp: 20.5,
        setpoint: 21,
        mode: 2,
        modes: [{ mode: 2, value: 18 }, { bogus: true }],
        vendorExtra: 'kept-in-raw',
      }],
    },
  });

  await sleep(COALESCE_WAIT_MS);
  assert.strictEqual(updates.length, 1);
  assert.strictEqual(updates[0].temp, 20.5);
  assert.strictEqual(updates[0].setpoint, 21);
  assert.strictEqual(updates[0].mode, 2);
  assert.deepStrictEqual(updates[0].modes, [{ mode: 2, value: 18 }], 'malformed mode entries should be filtered');
  assert.strictEqual(updates[0].raw.vendorExtra, 'kept-in-raw', 'unknown fields should be available via raw');

  // The room is created on the fly and persisted.
  const room = stateManager.getRoom('3');
  assert.strictEqual(room.temp, 20.5);
  assert.strictEqual(room.name, 'Room 3', 'unknown rooms get a fallback name');

  handler.cleanup();
});

test('SET_ALL_DATA discovery triggers listeners with type-validated initial state', async () => {
  const { stateManager, handler } = setup();
  const updates = [];
  stateManager.addListener('12', (_id, data) => updates.push(data));
  let devicesLoaded = false;
  handler.setOnDeviceListComplete(() => {
    devicesLoaded = true;
  });

  await handler.processMessage({
    type_int: MESSAGE_TYPES.SET_ALL_DATA,
    payload: {
      devices: [{
        deviceId: '12',
        name: 'Dimmer',
        switch: true,
        dimmvalue: 55,
        power: 'bogus',
        tariffLabel: 'Day rate',
      }],
      lastItem: true,
    },
  });

  await sleep(50); // discovery updates fire on setImmediate, no coalescing
  assert.strictEqual(updates.length, 1);
  assert.strictEqual(updates[0].switch, true);
  assert.strictEqual(updates[0].dimmvalue, 55);
  assert.strictEqual(updates[0].power, undefined, 'non-numeric power in a discovery record should be dropped');
  assert.strictEqual(updates[0].tariffLabel, 'Day rate');
  assert.strictEqual(devicesLoaded, true, 'lastItem should complete device discovery');

  handler.cleanup();
});

test('energy messages emit a normalized bridge status', async () => {
  const { handler } = setup();
  const statuses = [];
  handler.setOnBridgeStatusUpdate((status) => statuses.push(status));

  await handler.processMessage({
    type_int: MESSAGE_TYPES.SET_ENERGY_DATA,
    payload: {
      energy: {
        power: '1,5',
        kwh: 12.5,
        currency: 'eur',
        mode: 1,
      },
    },
  });

  assert.strictEqual(statuses.length, 1);
  assert.strictEqual(statuses[0].power, 1.5, 'comma-decimal power strings should parse');
  assert.strictEqual(statuses[0].energyKwh, 12.5);
  assert.strictEqual(statuses[0].currency, 'EUR');
  assert.strictEqual(statuses[0].loadMode, 'energy_saving', 'numeric load mode should normalize');

  handler.cleanup();
});

test('incoming TARIFF_INFO (389) and SET_ENERGY_STATE (393) responses are handled', async () => {
  // These are the bridge's responses to REQUEST_TARIFF_INFO / load-mode control.
  // They were previously dropped as "unhandled" — verify they now parse.
  const { handler } = setup();
  const statuses = [];
  handler.setOnBridgeStatusUpdate((status) => statuses.push(status));

  assert.strictEqual(
    await handler.processMessage({ type_int: MESSAGE_TYPES.TARIFF_INFO, payload: { currency: 'nok' } }),
    true,
    'TARIFF_INFO (389) should be handled',
  );
  assert.strictEqual(
    await handler.processMessage({ type_int: MESSAGE_TYPES.SET_ENERGY_STATE, payload: { loadMode: 2 } }),
    true,
    'SET_ENERGY_STATE (393) should be handled',
  );

  assert.strictEqual(statuses.length, 2);
  assert.strictEqual(statuses[0].currency, 'NOK');
  assert.strictEqual(statuses[1].loadMode, 'priority');

  handler.cleanup();
});

test('ENERGY_HISTORY response type is 396', () => {
  // Regression guard: the bridge sends history on 396, not 394 (which is the
  // outgoing SET_ENERGY_MONITORING_VIEW request).
  assert.strictEqual(MESSAGE_TYPES.ENERGY_HISTORY, 396);
  assert.strictEqual(MESSAGE_TYPES.TARIFF_INFO, 389);
  assert.strictEqual(MESSAGE_TYPES.SET_ENERGY_STATE, 393);
  assert.strictEqual(MESSAGE_TYPES.ENERGY_CONTROL_SET_MODE, 392);
});

test('a real meter SET_ENERGY_METER_STATE (401) populates power and energy', async () => {
  // Real CEMx meters report `power` and `energyDemand` (not `energy`/`kwh`).
  const { handler } = setup();
  const statuses = [];
  handler.setOnBridgeStatusUpdate((status) => statuses.push(status));

  await handler.processMessage({
    type_int: MESSAGE_TYPES.SET_ENERGY_METER_STATE,
    payload: { meterId: 1, power: 230, energyDemand: 1234.5, connectionState: 1 },
  });

  assert.strictEqual(statuses.length, 1);
  assert.strictEqual(statuses[0].power, 230);
  assert.strictEqual(statuses[0].energy, 1234.5, 'energyDemand should be picked up as cumulative energy');
  assert.strictEqual(statuses[0].connectionState, 1);

  handler.cleanup();
});

test('app-info code 1100 (sensor overflow) and 1033 type placeholder format', async () => {
  const { handler } = setup();
  const statuses = [];
  handler.setOnBridgeStatusUpdate((status) => statuses.push(status));

  await handler.processMessage({ type_int: MESSAGE_TYPES.ERROR_INFO, payload: { info: '1100' } });
  await handler.processMessage({
    type_int: MESSAGE_TYPES.ERROR_INFO,
    payload: { info: '1033', type: 'dimming actuator', value: 'AB12' },
  });

  assert.strictEqual(statuses[0].appInfoMessage, 'Sensor overflow');
  assert.strictEqual(statuses[1].appInfoMessage, 'New dimming actuator added to bridge, serial AB12');

  handler.cleanup();
});

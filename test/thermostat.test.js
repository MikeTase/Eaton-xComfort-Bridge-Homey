'use strict';

const assert = require('node:assert');
const Module = require('node:module');
const { after, test } = require('node:test');

// Minimal stand-in for the Homey runtime module so the real driver class can
// be exercised without a Homey.
class FakeDevice {
  constructor() {
    this.capabilities = new Map();
    this.capabilityOptions = new Map();
    this.store = new Map();
    this.settings = {};
    this.homey = {
      app: {},
      flow: { getDeviceTriggerCard: () => ({ trigger: async () => {} }) },
      setTimeout, clearTimeout,
    };
  }
  hasCapability(id) { return this.capabilities.has(id); }
  getCapabilities() { return [...this.capabilities.keys()]; }
  async addCapability(id) { if (!this.capabilities.has(id)) this.capabilities.set(id, null); }
  async removeCapability(id) { this.capabilities.delete(id); }
  getCapabilityValue(id) { return this.capabilities.has(id) ? this.capabilities.get(id) : null; }
  async setCapabilityValue(id, value) { this.capabilities.set(id, value); }
  async setCapabilityOptions(id, options) { this.capabilityOptions.set(id, options); }
  getSettings() { return this.settings; }
  async setSettings(settings) { Object.assign(this.settings, settings); }
  getData() { return { deviceId: '900' }; }
  getStoreValue(key) { return this.store.get(key); }
  async setStoreValue(key, value) { this.store.set(key, value); }
  getName() { return 'Thermostat'; }
  log() {}
  error() {}
}

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'homey') {
    return { Device: FakeDevice, Driver: class {}, App: class {} };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const ThermostatDevice = require('../.homeybuild/drivers/thermostat/device');
Module._load = originalLoad;

const demo = require('../docs/official-app-2.4.1/samples/demo-home.json').homeData;

const createdDevices = [];

// Stop the energy trackers' integration timers, as onUninit() does.
after(async () => {
  await Promise.all(createdDevices.map((device) => device.energy.flush()));
});

function createThermostat(room) {
  const device = new ThermostatDevice();
  createdDevices.push(device);
  for (const cap of ['measure_temperature', 'target_temperature', 'thermostat_mode', 'xcomfort_preset_mode', 'measure_power']) {
    device.capabilities.set(cap, null);
  }
  device.bridge = {
    getRoom: () => room,
    getDevice: () => undefined,
    getDevices: () => [],
    addDeviceStateListener: () => {},
    removeDeviceStateListener: () => {},
    isConnected: true,
  };
  device.roomId = String(room.roomId);
  device.roomStateBound = true;
  return device;
}

test('cooling rooms use the cooling setpoints and ranges (valueCool, m?Cool)', async () => {
  const room = {
    roomId: '601',
    regulation: 0,
    state: 4, // cooling manual
    currentMode: 1, // protection
    setpoint: 35,
    modes: [{ mode: 1, value: 10, valueCool: 35 }, { mode: 2, value: 18, valueCool: 29 }, { mode: 3, value: 21, valueCool: 26 }],
    raw: {},
  };
  const device = createThermostat(room);
  await device.applyRoomSnapshot(room);

  assert.strictEqual(device.getCapabilityValue('target_temperature'), 35, 'not clamped to the heating max of 20');
  assert.deepStrictEqual(device.capabilityOptions.get('target_temperature'), { min: 20, max: 50, step: 0.5 });
  assert.strictEqual(device.getModeSetpoint(2), 29, 'cooling eco');

  // Switching to heating uses the heating values and ranges again.
  await device.applyClimateState(2);
  await device.applyPreset(3);
  assert.strictEqual(device.getModeSetpoint(3), 21);
  assert.deepStrictEqual(device.capabilityOptions.get('target_temperature'), { min: 18, max: 40, step: 0.5 });
});

test('effect regulation setpoints are percentages', async () => {
  const room = { roomId: '602', regulation: 2, state: 2, currentMode: 3, setpoint: 70, raw: {} };
  const device = createThermostat(room);
  await device.applyRoomSnapshot(room);

  assert.strictEqual(device.getCapabilityValue('target_temperature'), 70, 'not clamped to 40 °C');
  assert.deepStrictEqual(device.capabilityOptions.get('target_temperature'), { min: 0, max: 100, step: 5 });
});

test('default preset setpoints follow the official defaults per regulation', () => {
  const device = createThermostat({ roomId: '603', raw: {} });
  device.regulation = 0;
  assert.strictEqual(device.getModeSetpoint(1), 10, 'room protection 10 °C');
  device.regulation = 1;
  assert.strictEqual(device.getModeSetpoint(3), 25, 'floor comfort 25 °C');
  device.regulation = 2;
  assert.strictEqual(device.getModeSetpoint(2), 50, 'effect eco 50 %');
});

test('floor temperature and limits come from tempAlt / floorMin / floorMax (demo room 501)', async () => {
  const heating = demo.roomHeating.find((r) => r.roomId === 501);
  const room = { ...heating, roomId: '501', raw: heating };
  const device = createThermostat(room);
  await device.applyRoomSnapshot(room);

  assert.strictEqual(device.getCapabilityValue('measure_temperature'), 21.5, 'room regulation: temp is the room');
  assert.strictEqual(device.getCapabilityValue('xcomfort_floor_temperature'), 25.3, 'tempAlt is the floor');
  assert.strictEqual(device.getCapabilityValue('xcomfort_floor_min_limit'), 8);
  assert.strictEqual(device.getCapabilityValue('xcomfort_floor_max_limit'), 38);
});

test('floor regulation swaps the room and floor temperatures', async () => {
  const room = { roomId: '604', regulation: 1, temp: 26, tempAlt: 21.4, floorMin: 10, floorMax: 29, raw: { floorSensorId: 0 } };
  const device = createThermostat(room);
  await device.applyRoomSnapshot(room);

  assert.strictEqual(device.getCapabilityValue('measure_temperature'), 21.4);
  assert.strictEqual(device.getCapabilityValue('xcomfort_floor_temperature'), 26);
  assert.strictEqual(device.getCapabilityValue('xcomfort_floor_max_limit'), 29);
});

test('floor limits are not shown for rooms without a floor sensor (demo room 502)', async () => {
  const heating = demo.roomHeating.find((r) => r.roomId === 502);
  const room = { ...heating, roomId: '502', raw: heating };
  const device = createThermostat(room);
  await device.applyRoomSnapshot(room);

  assert.strictEqual(device.hasCapability('xcomfort_floor_min_limit'), false);
  assert.strictEqual(device.hasCapability('xcomfort_floor_temperature'), false);
});

test('thermostat power is the heating power, not the room total', async () => {
  const room = { roomId: '605', regulation: 0, power: 245, heatingPower: 220, raw: {} };
  const device = createThermostat(room);
  await device.updateRoomState({ power: 245, heatingPower: 220 });
  assert.strictEqual(device.getCapabilityValue('measure_power'), 220);

  await device.updateRoomState({ power: 300 });
  assert.strictEqual(device.getCapabilityValue('measure_power'), 220, 'a room-total update does not change it');
});

test('external climate control follows climateInfoId; eSaving shows energy control', async () => {
  const room = { roomId: '606', regulation: 0, climateInfoId: 1, eSaving: 1, raw: { modeSwitchHeating: 0, modeSwitchCooling: 0 } };
  const device = createThermostat(room);
  await device.applyRoomSnapshot(room);
  assert.strictEqual(device.getCapabilityValue('xcomfort_external_climate_control'), true);
  assert.strictEqual(device.getCapabilityValue('xcomfort_energy_control_active'), true);

  await device.updateRoomState({ climateInfoId: 0, eSaving: 0 });
  assert.strictEqual(device.getCapabilityValue('xcomfort_external_climate_control'), false);
  assert.strictEqual(device.getCapabilityValue('xcomfort_energy_control_active'), false);
});

test('without climateInfoId, any configured mode switch counts as external', () => {
  const device = createThermostat({ roomId: '607', raw: {} });
  assert.strictEqual(device.getExternalClimateControlState({}, { modeSwitchHeating: 0, modeSwitchCooling: 325 }), true);
  assert.strictEqual(device.getExternalClimateControlState({}, { modeSwitchHeating: 0, modeSwitchCooling: 0 }), false);
  assert.strictEqual(device.getExternalClimateControlState({}, {}), undefined);
});

test('a stored -100 °C (no sensor) is cleared', async () => {
  const room = { roomId: '608', regulation: 0, raw: {} };
  const device = createThermostat(room);
  device.capabilities.set('measure_temperature', -100);
  await device.updateRoomState({});
  assert.strictEqual(device.getCapabilityValue('measure_temperature'), null);
});

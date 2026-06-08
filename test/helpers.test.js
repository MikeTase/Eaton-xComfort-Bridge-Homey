const assert = require('assert');

const { parseInfoMetadata } = require('../.homeybuild/lib/utils/parseInfoMetadata');
const {
  getClassificationSettings,
  isGenericBinaryInputDevice,
  isMotionSensorDevice,
  isTemperatureSensorDevice,
} = require('../.homeybuild/lib/utils/deviceClassification');
const { EnergyTracker } = require('../.homeybuild/lib/utils/EnergyTracker');
const { DeviceStateManager } = require('../.homeybuild/lib/state/DeviceStateManager');
const { resolveThermostatRoomId } = require('../.homeybuild/lib/utils/resolveThermostatRoomId');
const { ConnectionManager } = require('../.homeybuild/lib/connection/ConnectionManager');
const { COMPONENT_TYPES, DEVICE_TYPES, INFO_TEXT_CODES } = require('../.homeybuild/lib/XComfortProtocol');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  const metadata = parseInfoMetadata([
    { text: INFO_TEXT_CODES.TEMPERATURE_STANDARD, value: '21.5' },
    { text: INFO_TEXT_CODES.HUMIDITY_STANDARD, value: '44' },
    { text: INFO_TEXT_CODES.SIGNAL_STRENGTH, value: '3' },
    { text: INFO_TEXT_CODES.BATTERY_LEVEL_75 },
  ]);
  assert.deepStrictEqual(metadata, {
    temperature: 21.5,
    humidity: 44,
    signalStrength: 3,
    batteryLevel: 75,
    batteryPowered: true,
  });

  const valveMetadata = parseInfoMetadata([
    { text: INFO_TEXT_CODES.DEVICE_TEMPERATURE, value: '31.2' },
    { text: INFO_TEXT_CODES.DIMM_VALUE, value: '62' },
  ]);
  assert.strictEqual(valveMetadata.deviceTemperature, 31.2);
  assert.strictEqual(valveMetadata.temperature, 31.2);
  assert.strictEqual(valveMetadata.heatingDemand, 62);
  assert.strictEqual(valveMetadata.valvePosition, 62);

  const mainsMetadata = parseInfoMetadata([
    { text: INFO_TEXT_CODES.MAINS_POWERED },
  ]);
  assert.deepStrictEqual(mainsMetadata, { batteryPowered: false });

	  const motionDevice = {
	    deviceId: '7',
	    name: 'Hall CBMD 02/01',
	    devType: DEVICE_TYPES.MOTION_SENSOR,
	  };
	  assert.strictEqual(isMotionSensorDevice(motionDevice), true);

	  const binaryDevice = {
	    deviceId: '8',
	    name: 'Binary input',
	    devType: DEVICE_TYPES.ROCKER_BINARY_INPUT,
	    compType: COMPONENT_TYPES.BINARY_INPUT_230V,
	  };
	  assert.strictEqual(isGenericBinaryInputDevice(binaryDevice), true);

  const doorDevice = {
    deviceId: '9',
    name: 'Front door',
    devType: DEVICE_TYPES.DOOR_WINDOW_SENSOR,
    compType: COMPONENT_TYPES.DOOR_WINDOW_SENSOR,
  };
  assert.strictEqual(isGenericBinaryInputDevice(doorDevice), false);

  const tempDevice = {
    deviceId: '10',
    name: 'Temp input',
    info: [{ text: INFO_TEXT_CODES.TEMPERATURE_STANDARD, value: '19.2' }],
  };
  assert.strictEqual(isTemperatureSensorDevice(tempDevice), true);

  const settings = getClassificationSettings(binaryDevice, {
    compId: '4',
    name: 'CBEU component',
    compType: 123,
    raw: { mode: 'input', model: 'CBEU 02/02' },
  });
  assert.strictEqual(settings.deviceType, DEVICE_TYPES.ROCKER_BINARY_INPUT);
  assert.strictEqual(settings.componentType, COMPONENT_TYPES.BINARY_INPUT_230V);
  assert.strictEqual(settings.componentName, 'CBEU component');
  assert.strictEqual(settings.componentMode, 'input');
	  assert.strictEqual(settings.componentModel, 'CBEU 02/02');

  const stateManager = new DeviceStateManager(() => {});
  stateManager.setScene({ sceneId: '3', name: 'Evening', order: 2, raw: { show: true } });
  stateManager.setScene({ sceneId: '3', name: 'Evening Updated', raw: { icon: 'home' } });
  assert.strictEqual(stateManager.getScene('3').name, 'Evening Updated');
  assert.strictEqual(stateManager.getScene('3').raw.show, true);
  assert.strictEqual(stateManager.getScene('3').raw.icon, 'home');

  const rooms = [
    { roomId: '1', name: 'Living Room', roomSensorId: '99', temperatureOnly: false },
    { roomId: '2', name: 'Office' },
  ];
  assert.strictEqual(
    resolveThermostatRoomId({ deviceId: '99', name: 'RcTouch' }, rooms),
    '1',
  );
  assert.strictEqual(
    resolveThermostatRoomId({ deviceId: '42', roomName: 'living room' }, rooms),
    '1',
  );

  const ticks = [];
  const tracker = new EnergyTracker((kwh) => ticks.push(kwh), 20);
  await tracker.applyPower(1000);
  await sleep(35);
  await tracker.applyPower(0);
  assert.ok(tracker.getKwh() > 0, 'Energy should increase while power is applied');
  assert.ok(ticks[ticks.length - 1] > 0, 'Energy tick should publish a positive kWh value');

  // Throttled persistence: onTick fires every sample, onPersist is throttled but
  // always fires on the first emit and on reset().
  const persists = [];
  const throttled = new EnergyTracker(
    () => {},
    { persistMs: 10000, onPersist: (kwh) => persists.push(kwh) },
  );
  await throttled.applyPower(1000); // first emit always persists
  await throttled.applyPower(1000); // within throttle window — should NOT persist again
  assert.strictEqual(persists.length, 1, 'onPersist should be throttled after the first sample');

  await throttled.reset();
  assert.strictEqual(throttled.getKwh(), 0, 'reset() should zero the meter');
  assert.strictEqual(persists[persists.length - 1], 0, 'reset() should force-persist zero');
  throttled.flush();

  // sendWithRetry should serialize ACK-waiting bridge commands. The real bridge
  // NACKs and drops the WebSocket when bursts leave many DEVICE_SWITCH commands
  // pending at once.
  const cm = new ConnectionManager('127.0.0.1', () => {});
  cm.MIN_SEND_GAP_MS = 20;
  const sends = [];
  cm.isConnected = () => true;
  cm.sendEncrypted = async (message) => {
    sends.push(message.mc);
    return true;
  };
  const p1 = cm.sendWithRetry({ mc: 1, type_int: 281 });
  const p2 = cm.sendWithRetry({ mc: 2, type_int: 281 });
  await sleep(400);
  assert.deepStrictEqual(sends, [1], 'second command should wait for first ACK');
  cm.handleAck(1);
  await sleep(50);
  assert.deepStrictEqual(sends, [1, 2], 'second command should transmit after first ACK');
  cm.handleAck(2);
  assert.strictEqual(await p1, true, 'first command should resolve on ACK');
  assert.strictEqual(await p2, true, 'second command should resolve on ACK');

  const cmNack = new ConnectionManager('127.0.0.1', () => {});
  cmNack.NACK_BACKOFF_MS = 20;
  const nackSends = [];
  cmNack.isConnected = () => true;
  cmNack.sendEncrypted = async (message) => {
    nackSends.push(message.mc);
    return true;
  };
  const rejected = cmNack.sendWithRetry({ mc: 10, type_int: 281 });
  await sleep(50);
  cmNack.handleNack(10);
  await assert.rejects(rejected, /Bridge rejected command/, 'NACK should reject the command');
  await sleep(800);
  assert.deepStrictEqual(nackSends, [10], 'NACK should not trigger retries');

  console.log('helper tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

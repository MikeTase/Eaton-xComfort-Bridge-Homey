const assert = require('node:assert');
const { test } = require('node:test');

const { parseInfoMetadata } = require('../.homeybuild/lib/utils/parseInfoMetadata');
const {
  getClassificationSettings,
  isGenericBinaryInputDevice,
  isEnergyMeterDevice,
  isMotionSensorDevice,
  isTemperatureSensorDevice,
  isWeatherStationDevice,
} = require('../.homeybuild/lib/utils/deviceClassification');
const { EnergyTracker } = require('../.homeybuild/lib/utils/EnergyTracker');
const { DeviceStateManager } = require('../.homeybuild/lib/state/DeviceStateManager');
const { resolveThermostatRoomId } = require('../.homeybuild/lib/utils/resolveThermostatRoomId');
const { ConnectionManager } = require('../.homeybuild/lib/connection/ConnectionManager');
const { Authenticator } = require('../.homeybuild/lib/connection/Authenticator');
const { MessageHandler } = require('../.homeybuild/lib/messaging/MessageHandler');
const { Encryption } = require('../.homeybuild/lib/crypto/Encryption');
const { COMPONENT_TYPES, DEVICE_TYPES, INFO_TEXT_CODES, MESSAGE_TYPES } = require('../.homeybuild/lib/XComfortProtocol');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('parseInfoMetadata parses temperature, humidity, signal, and battery codes', () => {
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
});

test('parseInfoMetadata accepts numeric codes and locale decimal values', () => {
  const numericCodeMetadata = parseInfoMetadata([
    { text: Number(INFO_TEXT_CODES.TEMPERATURE_STANDARD), value: '20,5 C' },
    { text: Number(INFO_TEXT_CODES.SIGNAL_STRENGTH_DBM), value: '-72 dBm' },
    { text: Number(INFO_TEXT_CODES.BATTERY_LEVEL_50) },
  ]);
  assert.deepStrictEqual(numericCodeMetadata, {
    temperature: 20.5,
    signalStrengthDbm: -72,
    batteryLevel: 50,
    batteryPowered: true,
  });
});

test('parseInfoMetadata maps device temperature and valve codes', () => {
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
});

test('parseInfoMetadata parses weather station codes', () => {
  const weatherMetadata = parseInfoMetadata([
    { text: INFO_TEXT_CODES.WIND_SPEED, value: '4.2' },
    { text: INFO_TEXT_CODES.RAIN },
    { text: INFO_TEXT_CODES.BRIGHTNESS, value: '950' },
    { text: INFO_TEXT_CODES.SIGNAL_STRENGTH_DBM, value: '-73' },
    { text: INFO_TEXT_CODES.POWER, value: '18.5' },
  ]);
  assert.strictEqual(weatherMetadata.windSpeed, 4.2);
  assert.strictEqual(weatherMetadata.rain, true);
  assert.strictEqual(weatherMetadata.brightness, 950);
  assert.strictEqual(weatherMetadata.signalStrengthDbm, -73);
  assert.strictEqual(weatherMetadata.power, 18.5);
});

test('device classification helpers recognize device types', () => {
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

  const weatherDevice = {
    deviceId: '11',
    name: 'Weather station',
    devType: DEVICE_TYPES.WEATHER_STATION,
  };
  assert.strictEqual(isWeatherStationDevice(weatherDevice), true);

  const energyDevice = {
    deviceId: '12',
    name: 'Main CEMx',
    compType: COMPONENT_TYPES.ENERGY_METER,
  };
  assert.strictEqual(isEnergyMeterDevice(energyDevice), true);

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
  assert.strictEqual(settings.componentModelName, 'Binary Input 230V');

  const energySettings = getClassificationSettings(energyDevice, {
    compId: '12',
    name: 'CEMx component',
    compType: COMPONENT_TYPES.ENERGY_METER,
    raw: {},
  });
  assert.strictEqual(energySettings.componentModelName, 'Energy Meter CEMx');
  assert.strictEqual(energySettings.channelCount, 4);
});

test('DeviceStateManager merges scenes and dedupes listeners', async () => {
  const stateManager = new DeviceStateManager(() => {});
  stateManager.setScene({ sceneId: '3', name: 'Evening', order: 2, raw: { show: true } });
  stateManager.setScene({ sceneId: '3', name: 'Evening Updated', raw: { icon: 'home' } });
  assert.strictEqual(stateManager.getScene('3').name, 'Evening Updated');
  assert.strictEqual(stateManager.getScene('3').raw.show, true);
  assert.strictEqual(stateManager.getScene('3').raw.icon, 'home');

  let deviceListenerCalls = 0;
  const duplicateDeviceListener = () => {
    deviceListenerCalls++;
  };
  stateManager.addListener('44', duplicateDeviceListener);
  stateManager.addListener('44', duplicateDeviceListener);
  stateManager.triggerListeners('44', { switchState: true });
  await sleep(20);
  assert.strictEqual(deviceListenerCalls, 1, 'duplicate device listeners should only fire once');

  let roomListenerCalls = 0;
  const duplicateRoomListener = () => {
    roomListenerCalls++;
  };
  stateManager.addRoomListener('45', duplicateRoomListener);
  stateManager.addRoomListener('45', duplicateRoomListener);
  stateManager.triggerRoomListeners('45', { lightsOn: 2 });
  await sleep(20);
  assert.strictEqual(roomListenerCalls, 1, 'duplicate room listeners should only fire once');
});

test('resolveThermostatRoomId resolves by room sensor and room name', () => {
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
});

test('EnergyTracker integrates power into kWh', async () => {
  const ticks = [];
  const tracker = new EnergyTracker((kwh) => ticks.push(kwh), 20);
  await tracker.applyPower(1000);
  await sleep(35);
  await tracker.applyPower(0);
  assert.ok(tracker.getKwh() > 0, 'Energy should increase while power is applied');
  assert.ok(ticks[ticks.length - 1] > 0, 'Energy tick should publish a positive kWh value');
});

test('EnergyTracker throttles persistence but force-persists on reset', async () => {
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
  await throttled.flush();
});

test('sendAndWaitForAck serializes ACK-waiting bridge commands', async () => {
  // The real bridge NACKs and drops the WebSocket when bursts leave many
  // DEVICE_SWITCH commands pending at once.
  const cm = new ConnectionManager('127.0.0.1', () => {});
  cm.MIN_SEND_GAP_MS = 20;
  const sends = [];
  cm.isConnected = () => true;
  cm.sendEncrypted = async (message) => {
    sends.push(message.mc);
    return true;
  };
  const p1 = cm.sendAndWaitForAck({ mc: 1, type_int: 281 });
  const p2 = cm.sendAndWaitForAck({ mc: 2, type_int: 281 });
  await sleep(400);
  assert.deepStrictEqual(sends, [1], 'second command should wait for first ACK');
  cm.handleAck(1);
  await sleep(50);
  assert.deepStrictEqual(sends, [1, 2], 'second command should transmit after first ACK');
  cm.handleAck(2);
  assert.strictEqual(await p1, true, 'first command should resolve on ACK');
  assert.strictEqual(await p2, true, 'second command should resolve on ACK');
});

test('NACK rejects the command without retrying', async () => {
  const cmNack = new ConnectionManager('127.0.0.1', () => {});
  cmNack.NACK_BACKOFF_MS = 20;
  const nackSends = [];
  cmNack.isConnected = () => true;
  cmNack.sendEncrypted = async (message) => {
    nackSends.push(message.mc);
    return true;
  };
  const rejected = cmNack.sendAndWaitForAck({ mc: 10, type_int: 281 });
  await sleep(50);
  cmNack.handleNack(10);
  await assert.rejects(rejected, /Bridge rejected command/, 'NACK should reject the command');
  await sleep(800);
  assert.deepStrictEqual(nackSends, [10], 'NACK should not trigger retries');
});

test('WAIT4ACK extends an in-flight command deadline instead of timing out', async () => {
  const cm = new ConnectionManager('127.0.0.1', () => {});
  cm.ACK_TIMEOUT_MS = 80;
  cm.WAIT4ACK_EXTEND_MS = 300;
  cm.MIN_SEND_GAP_MS = 0;
  const sends = [];
  cm.isConnected = () => true;
  cm.sendEncrypted = async (message) => {
    sends.push(message.mc);
    return true;
  };

  let settled = null;
  const p = cm.sendAndWaitForAck({ mc: 1, type_int: 281 }).then(
    (value) => { settled = { ok: value }; return value; },
    (err) => { settled = { err: err.message }; throw err; },
  );
  p.catch(() => {}); // avoid unhandled rejection if it were to reject

  await sleep(30); // in-flight, before the 80ms deadline
  assert.deepStrictEqual(sends, [1]);
  cm.handleWait4Ack(); // bridge says "busy" → extend the deadline

  await sleep(120); // past the original 80ms deadline
  assert.strictEqual(settled, null, 'command must not time out after a WAIT4ACK extension');

  cm.handleAck(1);
  assert.strictEqual(await p, true, 'command resolves once the delayed ACK arrives');
});

test('command times out at ACK_TIMEOUT_MS when no WAIT4ACK arrives', async () => {
  const cm = new ConnectionManager('127.0.0.1', () => {});
  cm.ACK_TIMEOUT_MS = 50;
  cm.NACK_BACKOFF_MS = 0;
  cm.MIN_SEND_GAP_MS = 0;
  cm.isConnected = () => true;
  cm.sendEncrypted = async () => true;

  await assert.rejects(
    cm.sendAndWaitForAck({ mc: 2, type_int: 281 }),
    /No ACK before timeout/,
  );
});

test('Authenticator sends a hashed user login and honors LOGIN_DENIED', () => {
  const loginMessages = [];
  let authMc = 1;
  const authenticator = new Authenticator(
    'user pass-word',
    () => {},
    (message) => {
      loginMessages.push(message);
      return true;
    },
    () => authMc++,
    () => {},
    { username: 'alice' },
  );
  authenticator.handleUnencryptedMessage({
    type_int: MESSAGE_TYPES.CONNECTION_START,
    payload: {
      device_id: 'bridge-device',
      connection_id: 'connection-1',
    },
  });
  authenticator.handleEncryptedMessage({ type_int: MESSAGE_TYPES.SECRET_EXCHANGE_ACK, payload: {} });
  assert.strictEqual(loginMessages.length, 1, 'secret ACK should send one login request');
  const loginPayload = loginMessages[0].payload;
  assert.strictEqual(loginMessages[0].type_int, MESSAGE_TYPES.LOGIN_REQUEST);
  assert.strictEqual(loginPayload.username, 'alice');
  assert.strictEqual(
    loginPayload.password,
    Encryption.calculateAuthHash('bridge-device', 'user pass-word', loginPayload.salt),
    'user password login should use the bridge auth hash with the configured username',
  );
  authenticator.handleEncryptedMessage({ type_int: MESSAGE_TYPES.LOGIN_DENIED, payload: {} });
  assert.strictEqual(authenticator.getState(), 'failed', 'LOGIN_DENIED should fail authentication immediately');
});

test('MessageHandler maps bridge app info codes', async () => {
  const appInfoUpdates = [];
  const messageHandler = new MessageHandler(new DeviceStateManager(() => {}), () => {});
  messageHandler.setOnBridgeStatusUpdate((status) => appInfoUpdates.push(status));
  assert.strictEqual(
    await messageHandler.processMessage({
      type_int: MESSAGE_TYPES.ERROR_INFO,
      payload: { info: '1010', value: '42' },
    }),
    true,
    'ERROR_INFO should be handled',
  );
  assert.strictEqual(appInfoUpdates.length, 1, 'ERROR_INFO should emit a bridge status update');
  assert.strictEqual(appInfoUpdates[0].appInfoCode, '1010');
  assert.strictEqual(appInfoUpdates[0].appInfoMessage, 'Device not dimmable');
  assert.deepStrictEqual(appInfoUpdates[0].rawAppInfo, { info: '1010', value: '42' });
});

test('MessageHandler merges component info and handles COMP_DELETED', async () => {
  const componentStateManager = new DeviceStateManager(() => {});
  componentStateManager.setComponent({
    compId: '22',
    name: 'PBMS component',
    compType: 56,
    raw: { compId: 22, compType: 56, info: [{ text: '1111', value: '2' }] },
  });
  const componentMessageHandler = new MessageHandler(componentStateManager, () => {});
  assert.strictEqual(
    await componentMessageHandler.processMessage({
      type_int: MESSAGE_TYPES.SET_COMP_INFO,
      payload: { compId: 22, info: [{ text: '1116' }] },
    }),
    true,
    'SET_COMP_INFO should be handled',
  );
  assert.deepStrictEqual(
    componentStateManager.getComponent('22').raw.info,
    [{ text: '1116' }],
    'SET_COMP_INFO should merge the latest component info payload',
  );
  assert.strictEqual(componentStateManager.getComponent('22').name, 'PBMS component');

  await componentMessageHandler.processMessage({ type_int: MESSAGE_TYPES.COMP_DELETED, payload: { compId: '22' } });
  assert.strictEqual(componentStateManager.getComponent('22'), undefined);
});

test('MessageHandler handles device/room lifecycle messages', async () => {
  const lifecycleStateManager = new DeviceStateManager(() => {});
  const lifecycleHandler = new MessageHandler(lifecycleStateManager, () => {});
  assert.strictEqual(
    await lifecycleHandler.processMessage({
      type_int: MESSAGE_TYPES.ADD_DEVICE,
      payload: { deviceId: '55', name: 'New actuator', switch: 1 },
    }),
    true,
    'ADD_DEVICE should be handled',
  );
  assert.strictEqual(lifecycleStateManager.getDevice('55').name, 'New actuator');

  await lifecycleHandler.processMessage({
    type_int: MESSAGE_TYPES.SET_DEVICE_INFO,
    payload: { deviceId: '55', info: [{ text: INFO_TEXT_CODES.SIGNAL_STRENGTH, value: '4' }] },
  });
  assert.deepStrictEqual(
    lifecycleStateManager.getDevice('55').info,
    [{ text: INFO_TEXT_CODES.SIGNAL_STRENGTH, value: '4' }],
    'SET_DEVICE_INFO should update stored device info metadata',
  );

  await lifecycleHandler.processMessage({
    type_int: MESSAGE_TYPES.SET_ROOM_INFO,
    payload: { roomId: '8', temp: 19.5, temperatureOnly: false },
  });
  assert.strictEqual(lifecycleStateManager.getRoom('8').temp, 19.5);
  assert.strictEqual(lifecycleStateManager.getRoom('8').temperatureOnly, false);

  await lifecycleHandler.processMessage({ type_int: MESSAGE_TYPES.DEVICE_DELETED, payload: { deviceId: '55' } });
  assert.strictEqual(lifecycleStateManager.getDevice('55'), undefined);
  await lifecycleHandler.processMessage({ type_int: MESSAGE_TYPES.ROOM_DELETED, payload: { roomId: '8' } });
  assert.strictEqual(lifecycleStateManager.getRoom('8'), undefined);

  lifecycleHandler.cleanup();
});

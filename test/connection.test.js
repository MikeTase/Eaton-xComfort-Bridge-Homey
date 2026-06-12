const assert = require('node:assert');
const { test } = require('node:test');

const { Authenticator } = require('../.homeybuild/lib/connection/Authenticator');
const { XComfortBridge } = require('../.homeybuild/lib/connection/XComfortBridge');
const { CLIENT_CONFIG, MESSAGE_TYPES } = require('../.homeybuild/lib/XComfortProtocol');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function startAuthenticator(authOptions) {
  const rawMessages = [];
  const authenticator = new Authenticator(
    'auth-key',
    (msg) => rawMessages.push(JSON.parse(msg)),
    () => true,
    () => 1,
    () => {},
    authOptions,
  );

  authenticator.handleUnencryptedMessage({
    type_int: MESSAGE_TYPES.CONNECTION_START,
    payload: { device_id: 'device-1', connection_id: 'conn-1' },
  });

  return rawMessages.find((msg) => msg.type_int === MESSAGE_TYPES.CONNECTION_CONFIRM);
}

test('CONNECTION_CONFIRM sends the configured per-Homey client_id', () => {
  const confirm = startAuthenticator({ mode: 'device', clientId: 'abcd1234abcd1234' });
  assert.ok(confirm, 'CONNECTION_CONFIRM was sent');
  assert.strictEqual(confirm.payload.client_id, 'abcd1234abcd1234');
  assert.strictEqual(confirm.payload.client_type, CLIENT_CONFIG.TYPE);
});

test('CONNECTION_CONFIRM falls back to the shared client_id when none is configured', () => {
  const confirm = startAuthenticator({ mode: 'device' });
  assert.ok(confirm, 'CONNECTION_CONFIRM was sent');
  assert.strictEqual(confirm.payload.client_id, CLIENT_CONFIG.ID);
});

test('markDisconnected emits disconnected once and updates state', () => {
  const bridge = new XComfortBridge('127.0.0.1', 'auth-key', () => {});
  let disconnects = 0;
  bridge.on('disconnected', () => disconnects++);

  bridge.connectionState = 'connected';
  bridge.markDisconnected();
  bridge.markDisconnected();

  assert.strictEqual(disconnects, 1);
  assert.strictEqual(bridge.state, 'disconnected');
  bridge.cleanup();
});

test('initial data requests are retried once when the device list never arrives', async () => {
  const bridge = new XComfortBridge('127.0.0.1', 'auth-key', () => {});
  const sent = [];
  bridge.connectionManager.sendEncrypted = (msg) => {
    sent.push(msg.type_int);
    return Promise.resolve(true);
  };
  bridge.connectionManager.isConnected = () => true;
  bridge.INITIAL_DATA_RETRY_MS = 20;

  bridge.scheduleInitialDataRetry();
  await sleep(50);

  assert.deepStrictEqual(sent, [MESSAGE_TYPES.REQUEST_DEVICES, MESSAGE_TYPES.REQUEST_HOME_DATA]);

  // The retry is one-shot: nothing further is sent.
  await sleep(50);
  assert.strictEqual(sent.length, 2);
  bridge.cleanup();
});

test('initial data retry is skipped once the device list has been received', async () => {
  const bridge = new XComfortBridge('127.0.0.1', 'auth-key', () => {});
  const sent = [];
  bridge.connectionManager.sendEncrypted = (msg) => {
    sent.push(msg.type_int);
    return Promise.resolve(true);
  };
  bridge.connectionManager.isConnected = () => true;
  bridge.INITIAL_DATA_RETRY_MS = 20;

  bridge.scheduleInitialDataRetry();
  bridge.deviceListReceived = true;
  await sleep(50);

  assert.deepStrictEqual(sent, []);
  bridge.cleanup();
});

const assert = require('node:assert');
const { test } = require('node:test');

const { CommandDebouncer } = require('../.homeybuild/lib/utils/CommandDebouncer');
const { Semaphore } = require('../.homeybuild/lib/utils/Semaphore');
const { extractHistoryKwh, extractHistoryPeriods } = require('../.homeybuild/lib/utils/energyHistory');
const {
  normalizeChoiceIdArgument,
  normalizeOnOffArgument,
  normalizePercentageArgument,
  normalizeRemoteAccessPreference,
  normalizeValveStateArgument,
} = require('../.homeybuild/lib/utils/flowArguments');
const manifest = require('../app.json');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('Flow argument helpers normalize Homey dropdown shapes', () => {
  assert.strictEqual(normalizeChoiceIdArgument({ id: 'eco' }), 'eco');
  assert.strictEqual(normalizeOnOffArgument({ id: 'on' }), true);
  assert.strictEqual(normalizeOnOffArgument({ id: 'off' }), false);
  assert.strictEqual(normalizeValveStateArgument({ id: 'open' }), true);
  assert.strictEqual(normalizeValveStateArgument({ id: 'closed' }), false);
  assert.strictEqual(normalizeRemoteAccessPreference({ id: 'enabled' }), true);
  assert.strictEqual(normalizeRemoteAccessPreference({ id: 'disabled' }), false);
  assert.strictEqual(normalizePercentageArgument({ id: '25,5' }), 25.5);
  assert.strictEqual(normalizePercentageArgument(150), 100);
  assert.strictEqual(normalizePercentageArgument('not-a-number'), null);
});

test('Flow manifest exposes useful wall-switch and bridge tokens', () => {
  const triggerById = new Map(manifest.flow.triggers.map((card) => [card.id, card]));
  const tokenNames = (id) => new Set((triggerById.get(id).tokens || []).map((token) => token.name));

  for (const id of ['wall_switch_up', 'wall_switch_down']) {
    const tokens = tokenNames(id);
    assert.ok(tokens.has('button'), `${id} should expose button token`);
    assert.ok(tokens.has('component_id'), `${id} should expose component_id token`);
    assert.ok(tokens.has('component_model'), `${id} should expose component_model token`);
  }

  for (const id of ['bridge_connected', 'bridge_disconnected']) {
    const tokens = tokenNames(id);
    assert.ok(tokens.has('bridge'), `${id} should expose bridge token`);
    assert.ok(tokens.has('bridge_id'), `${id} should expose bridge_id token`);
  }
});

test('CommandDebouncer fires the first call in an idle period immediately', async () => {
  const debouncer = new CommandDebouncer();
  const calls = [];

  const result = await debouncer.run(async () => {
    calls.push('first');
    return 'first';
  }, 50);
  assert.strictEqual(result, 'first');
  assert.deepStrictEqual(calls, ['first']);
});

test('CommandDebouncer supersedes intermediate calls', async () => {
  const debouncer = new CommandDebouncer();
  const calls = [];
  const run = (label) => debouncer.run(async () => {
    calls.push(label);
    await sleep(30);
    return label;
  }, 50);

  // Fire three rapid calls: the first runs, the middle is superseded by the
  // last, and only the final state is sent.
  const p1 = run('a');
  const p2 = run('b');
  const p3 = run('c');
  const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

  assert.strictEqual(r1, 'a');
  assert.strictEqual(r2, undefined, 'superseded call resolves undefined');
  assert.strictEqual(r3, 'c');
  assert.deepStrictEqual(calls, ['a', 'c']);
});

test('Semaphore serializes acquirers', async () => {
  const semaphore = new Semaphore(1);
  const order = [];

  await semaphore.acquire();
  const waiter = semaphore.acquire().then(() => order.push('second'));
  order.push('first');
  semaphore.release();
  await waiter;
  semaphore.release();

  assert.deepStrictEqual(order, ['first', 'second']);
});

test('Semaphore drain rejects queued waiters', async () => {
  const semaphore = new Semaphore(1);
  await semaphore.acquire();
  const waiter = semaphore.acquire();
  semaphore.drain(new Error('Connection lost'));

  await assert.rejects(() => waiter, /Connection lost/);
});

test('extractHistoryKwh handles numbers, strings, arrays, and objects', () => {
  assert.strictEqual(extractHistoryKwh(12.345), 12.345);
  assert.strictEqual(extractHistoryKwh('3,5'), 3.5);
  assert.strictEqual(extractHistoryKwh([1, 2, 3]), 6);
  assert.strictEqual(extractHistoryKwh({ energyKwh: 7.25 }), 7.25);
  assert.strictEqual(extractHistoryKwh({ consumption: '2.5' }), 2.5);
  assert.strictEqual(extractHistoryKwh([{ kwh: 1 }, { kwh: 2.5 }]), 3.5);
  assert.strictEqual(extractHistoryKwh('not-a-number'), undefined);
  assert.strictEqual(extractHistoryKwh(null), undefined);
  assert.strictEqual(extractHistoryKwh({}), undefined);
});

test('extractHistoryPeriods extracts today/month totals', () => {
  assert.deepStrictEqual(extractHistoryPeriods({ today: 1.2345678, month: 45.6 }), {
    todayKwh: 1.235,
    monthKwh: 45.6,
  });
  assert.deepStrictEqual(extractHistoryPeriods({ daily: [0.5, 0.25], monthly: { energy: 12 } }), {
    todayKwh: 0.75,
    monthKwh: 12,
  });
  assert.deepStrictEqual(extractHistoryPeriods('today: lots'), {});
  assert.deepStrictEqual(extractHistoryPeriods(null), {});
  assert.deepStrictEqual(extractHistoryPeriods({ week: 5 }), {});
});

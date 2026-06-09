const assert = require('assert');

const { CommandDebouncer } = require('../.homeybuild/lib/utils/CommandDebouncer');
const { Semaphore } = require('../.homeybuild/lib/utils/Semaphore');
const { extractHistoryKwh, extractHistoryPeriods } = require('../.homeybuild/lib/utils/energyHistory');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function testCommandDebouncerLeadingEdge() {
  const debouncer = new CommandDebouncer();
  const calls = [];

  // First call in an idle period fires immediately.
  const result = await debouncer.run(async () => {
    calls.push('first');
    return 'first';
  }, 50);
  assert.strictEqual(result, 'first');
  assert.deepStrictEqual(calls, ['first']);
}

async function testCommandDebouncerSupersede() {
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
}

async function testSemaphoreSerializes() {
  const semaphore = new Semaphore(1);
  const order = [];

  await semaphore.acquire();
  const waiter = semaphore.acquire().then(() => order.push('second'));
  order.push('first');
  semaphore.release();
  await waiter;
  semaphore.release();

  assert.deepStrictEqual(order, ['first', 'second']);
}

async function testSemaphoreDrainRejects() {
  const semaphore = new Semaphore(1);
  await semaphore.acquire();
  const waiter = semaphore.acquire();
  semaphore.drain(new Error('Connection lost'));

  await assert.rejects(() => waiter, /Connection lost/);
}

function testExtractHistoryKwh() {
  assert.strictEqual(extractHistoryKwh(12.345), 12.345);
  assert.strictEqual(extractHistoryKwh('3,5'), 3.5);
  assert.strictEqual(extractHistoryKwh([1, 2, 3]), 6);
  assert.strictEqual(extractHistoryKwh({ energyKwh: 7.25 }), 7.25);
  assert.strictEqual(extractHistoryKwh({ consumption: '2.5' }), 2.5);
  assert.strictEqual(extractHistoryKwh([{ kwh: 1 }, { kwh: 2.5 }]), 3.5);
  assert.strictEqual(extractHistoryKwh('not-a-number'), undefined);
  assert.strictEqual(extractHistoryKwh(null), undefined);
  assert.strictEqual(extractHistoryKwh({}), undefined);
}

function testExtractHistoryPeriods() {
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
}

async function run() {
  await testCommandDebouncerLeadingEdge();
  await testCommandDebouncerSupersede();
  await testSemaphoreSerializes();
  await testSemaphoreDrainRejects();
  testExtractHistoryKwh();
  testExtractHistoryPeriods();

  console.log('units.test.js passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
